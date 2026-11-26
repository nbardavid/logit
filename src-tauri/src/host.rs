//! The background host: `logit --host` owns the Claude chats and the terminals so they outlive
//! the window. It serves newline-delimited JSON on a Unix socket in the profile's data dir.

use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::io::{BufRead, BufReader, ErrorKind, Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::Path;
use std::process::{Child, ChildStdin};
use std::sync::{mpsc, Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use portable_pty::{ChildKiller, MasterPty};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::chat::{claude_args, spawn_claude};
use crate::servers::{self, Config};
use crate::{pty, store};

/// Bumped by hand whenever a message or behaviour changes incompatibly. `hello`, `list` and
/// `shutdown` keep their shape in every version, so any app can always talk that much.
pub const HOST_PROTOCOL: u32 = 5;

/// How long an `ask` waits for a window to answer.
const ASK_WAIT: Duration = Duration::from_secs(60);

/// About the 10 000 lines of xterm scrollback.
const TERM_BUFFER_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Request {
    Hello,
    List,
    Shutdown,
    Window,
    ChatOpen {
        id: String,
        start: Option<ChatStart>,
    },
    ChatSend {
        id: String,
        line: String,
    },
    ChatStop {
        id: String,
    },
    TermOpen {
        id: String,
        start: Option<TermStart>,
    },
    TermWrite {
        id: String,
        data: String,
    },
    TermResize {
        id: String,
        cols: u16,
        rows: u16,
    },
    TermKill {
        id: String,
    },
    /// Every chat's state, leaving the unread flags to `list`.
    Peek,
    /// Something only a window can do (create a workspace, send a chat a prompt), for an
    /// agent: handed to a window as `{"ask": ..., "askId": n}`, its `answer` sent back.
    Ask {
        ask: Value,
    },
    Answer {
        ask_id: u64,
        result: Value,
    },
    /// Starts a workspace's dev servers (`apps`, or every app not optional), answering at
    /// once with the slot and the URLs to come.
    ServersStart {
        workspace_id: String,
        project_id: String,
        cwd: String,
        #[serde(default)]
        apps: Option<Vec<String>>,
    },
    /// Stops a workspace's dev servers (`apps`, or all of them), once they are gone.
    ServersStop {
        workspace_id: String,
        #[serde(default)]
        apps: Option<Vec<String>>,
    },
    /// Every workspace's dev servers.
    ServersList,
    /// The end of an app's output (`app` "prepare" for the prepare step).
    ServersLogs {
        workspace_id: String,
        app: String,
        lines: usize,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStart {
    pub cwd: String,
    pub resume: Option<String>,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub history_len: usize,
    /// The Claude account it runs as (`accounts.rs`); none is the default one.
    #[serde(default)]
    pub account: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TermStart {
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
    pub command: Option<String>,
    pub workspace_id: String,
    pub title: String,
    /// Opaque to the host; the app marks its setup script `"setup"`.
    pub tag: Option<String>,
    /// Set on top of the shell's own environment.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub env: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostChat {
    pub id: String,
    pub alive: bool,
    pub working: bool,
    pub waiting: bool,
    pub unread: bool,
    pub history_len: usize,
    /// The Claude account it runs as; none is the default one.
    #[serde(default)]
    pub account: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostTerm {
    pub id: String,
    pub workspace_id: String,
    pub cwd: String,
    pub title: String,
    pub command: Option<String>,
    pub tag: Option<String>,
    pub ended: bool,
    pub code: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostList {
    pub chats: Vec<HostChat>,
    pub terms: Vec<HostTerm>,
}

/// What the host reads of a chat's stream: enough to know whether stopping it loses work, and
/// whether something happened that no window saw.
#[derive(Debug, Default)]
pub struct ChatFlags {
    pub working: bool,
    pub waiting: bool,
    pub unread: bool,
}

impl ChatFlags {
    /// A line Claude printed, with `windows` connected at the time.
    pub fn observe_out(&mut self, line: &str, windows: usize) {
        let Ok(m) = serde_json::from_str::<Value>(line) else {
            return;
        };
        match m["type"].as_str() {
            Some("result") => {
                self.working = false;
                self.waiting = false;
                self.unread |= windows == 0;
            }
            Some("control_request") if m["request"]["subtype"] == "can_use_tool" => {
                self.waiting = true;
                self.unread |= windows == 0;
            }
            Some("stream_event") => self.working = true,
            Some("system") if m["status"] == "requesting" => self.working = true,
            _ => {}
        }
    }

    /// A line the window sent to Claude.
    pub fn observe_in(&mut self, line: &str) {
        let Ok(m) = serde_json::from_str::<Value>(line) else {
            return;
        };
        match m["type"].as_str() {
            Some("user") => self.working = true,
            Some("control_response") => self.waiting = false,
            _ => {}
        }
    }
}

/// A terminal's output since it started, oldest dropped first past `TERM_BUFFER_BYTES`.
#[derive(Default)]
pub struct TermBuffer {
    chunks: VecDeque<String>,
    bytes: usize,
}

impl TermBuffer {
    pub fn push(&mut self, text: &str) {
        if text.len() > TERM_BUFFER_BYTES {
            let mut from = text.len() - TERM_BUFFER_BYTES;
            while !text.is_char_boundary(from) {
                from += 1;
            }
            self.chunks.clear();
            self.bytes = 0;
            return self.push(&text[from..]);
        }
        self.chunks.push_back(text.into());
        self.bytes += text.len();
        while self.bytes > TERM_BUFFER_BYTES {
            let Some(old) = self.chunks.pop_front() else {
                break;
            };
            self.bytes -= old.len();
        }
    }

    pub fn contents(&self) -> String {
        self.chunks.iter().map(String::as_str).collect()
    }
}

/// A line the window sent, wrapped so a replay can show it (`logit_sent`); "" when the line is
/// not JSON, and the caller skips it.
pub fn sent_line(line: &str) -> String {
    match serde_json::from_str::<Value>(line) {
        Ok(message) => serde_json::json!({ "type": "logit_sent", "message": message }).to_string(),
        Err(_) => String::new(),
    }
}

const SWEEP: Duration = Duration::from_secs(5);
/// Idle chats are stopped this long after the last window left; they resume when reopened.
const CHAT_IDLE: Duration = Duration::from_secs(300);
/// A live chat nobody wrote to (Claude nor the user) for this long is compacted, while
/// Claude's prompt cache (one hour) still holds it: the summary is cheap now, and the next
/// message after the pause no longer pays for the whole conversation.
const CHAT_COMPACT: Duration = Duration::from_secs(55 * 60);
const COMPACT_LINE: &str = r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"/compact"}]},"parent_tool_use_id":null,"session_id":""}"#;
/// The host exits this long after the last window left, once nothing runs.
const HOST_IDLE: Duration = Duration::from_secs(60);
/// A window that stops reading loses its stream instead of stalling the whole host.
const WRITE_TIMEOUT: Duration = Duration::from_secs(5);

const EXIT: &str = r#"{"type":"logit_exit"}"#;
const LIVE: &str = r#"{"type":"logit_live"}"#;

struct ChatProc {
    /// Tells this process's reader threads apart from a later one under the same id.
    serial: u64,
    /// Taken by the stdout thread once Claude closes it, to reap it outside the lock.
    child: Option<Child>,
    stdin: ChildStdin,
    // ponytail: a chat's buffer keeps every line for the process's life; compact stream_event lines once onAssistant can rebuild multi-block messages from assistant lines alone.
    lines: Vec<String>,
    subs: Vec<UnixStream>,
    flags: ChatFlags,
    history_len: usize,
    /// The Claude account it was started as; none is the default one.
    account: Option<String>,
    ended: bool,
    /// The last line either way, for the idle compaction.
    last_activity: Instant,
    /// Nothing happened since the last compaction (or since start): no point compacting.
    compacted: bool,
}

impl ChatProc {
    fn due_for_compact(&self) -> bool {
        !self.ended
            && !self.compacted
            && !self.flags.working
            && !self.flags.waiting
            && self.last_activity.elapsed() >= CHAT_COMPACT
    }
}

struct TermProc {
    serial: u64,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    output: TermBuffer,
    subs: Vec<UnixStream>,
    info: HostTerm,
    /// The shell's pid: the root of the process tree a dev server stops.
    pid: Option<u32>,
}

struct State {
    serial: u64,
    chats: HashMap<String, ChatProc>,
    terms: HashMap<String, TermProc>,
    /// Chats stopped while flagged unread, until a `list` hands the flag to a window.
    unread: HashSet<String>,
    windows: usize,
    last_window_left: Instant,
    /// The windows' presence connections, written to for `ask`.
    window_streams: Vec<UnixStream>,
    asks: HashMap<u64, mpsc::Sender<Value>>,
    /// Dev servers, by workspace id.
    servers: HashMap<String, ServerRun>,
}

type Shared = Arc<Mutex<State>>;

fn lock(state: &Shared) -> MutexGuard<'_, State> {
    state.lock().unwrap_or_else(|e| e.into_inner())
}

/// Writes `line` to every subscriber, dropping those that fail; true if one got it.
fn broadcast(subs: &mut Vec<UnixStream>, line: &str) -> bool {
    subs.retain_mut(|s| writeln!(s, "{line}").is_ok());
    !subs.is_empty()
}

/// The host on `data_dir()/host.sock`, until it exits.
pub fn run() {
    let dir = store::data_dir();
    let served = std::fs::create_dir_all(&dir).and_then(|()| serve(&dir.join("host.sock")));
    if let Err(e) = served {
        eprintln!("logit host: {e}");
    }
}

/// Serves `sock` until the host has had nothing to do for a while. Returns at once, `Ok`, when
/// another host already answers there.
pub fn serve(sock: &Path) -> std::io::Result<()> {
    let listener = match UnixListener::bind(sock) {
        Ok(l) => l,
        Err(e) if e.kind() == ErrorKind::AddrInUse => {
            if UnixStream::connect(sock).is_ok() {
                return Ok(());
            }
            // Left by a host that died.
            std::fs::remove_file(sock)?;
            UnixListener::bind(sock)?
        }
        Err(e) => return Err(e),
    };
    std::fs::set_permissions(sock, std::fs::Permissions::from_mode(0o600))?;

    let state: Shared = Arc::new(Mutex::new(State {
        serial: 0,
        chats: HashMap::new(),
        terms: HashMap::new(),
        unread: HashSet::new(),
        windows: 0,
        last_window_left: Instant::now(),
        window_streams: Vec::new(),
        asks: HashMap::new(),
        servers: HashMap::new(),
    }));
    let accepting = state.clone();
    let path = sock.to_path_buf();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let state = accepting.clone();
            let path = path.clone();
            std::thread::spawn(move || {
                let _ = handle(&state, &path, stream);
            });
        }
    });

    loop {
        std::thread::sleep(SWEEP);
        let mut s = lock(&state);
        for chat in s.chats.values_mut().filter(|c| c.due_for_compact()) {
            compact(chat);
        }
        if s.windows > 0 {
            continue;
        }
        let idle = s.last_window_left.elapsed();
        if idle >= CHAT_IDLE {
            let st = &mut *s;
            st.chats.retain(|id, chat| {
                if chat.flags.working || chat.flags.waiting {
                    return true;
                }
                if chat.flags.unread {
                    st.unread.insert(id.clone());
                }
                if let Some(mut child) = chat.child.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                false
            });
        }
        if idle >= HOST_IDLE && s.chats.is_empty() && s.terms.is_empty() && s.unread.is_empty() {
            // Still under the lock: no request slips in between.
            let _ = std::fs::remove_file(sock);
            return Ok(());
        }
    }
}

fn reply(mut out: &UnixStream, result: Result<(), String>) -> std::io::Result<()> {
    let v = match result {
        Ok(()) => serde_json::json!({ "ok": true }),
        Err(e) => serde_json::json!({ "error": e }),
    };
    writeln!(out, "{v}")
}

fn handle(state: &Shared, sock: &Path, stream: UnixStream) -> std::io::Result<()> {
    // macOS refuses it (EINVAL) once the peer has hung up; the request is still worth reading.
    let _ = stream.set_write_timeout(Some(WRITE_TIMEOUT));
    let mut reader = BufReader::new(&stream);
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let request = match serde_json::from_str::<Request>(&line) {
        Ok(r) => r,
        Err(e) => return reply(&stream, Err(e.to_string())),
    };
    match request {
        Request::Hello => writeln!(&stream, r#"{{"protocol":{HOST_PROTOCOL}}}"#),
        Request::List => writeln!(&stream, "{}", serde_json::to_string(&list(state))?),
        Request::Shutdown => {
            let mut s = lock(state);
            for chat in s.chats.values_mut() {
                if let Some(mut child) = chat.child.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
            for term in s.terms.values_mut() {
                let _ = term.killer.kill();
            }
            let _ = std::fs::remove_file(sock);
            let _ = reply(&stream, Ok(()));
            std::process::exit(0)
        }
        Request::Window => {
            {
                let mut s = lock(state);
                s.windows += 1;
                if let Ok(w) = stream.try_clone() {
                    s.window_streams.push(w);
                }
            }
            // Held open by the app for as long as it runs.
            let _ = std::io::copy(&mut reader, &mut std::io::sink());
            let mut s = lock(state);
            s.windows -= 1;
            if s.windows == 0 {
                s.last_window_left = Instant::now();
            }
            Ok(())
        }
        Request::ChatOpen { id, start } => chat_open(state, id, start, stream),
        Request::ChatSend { id, line } => reply(&stream, chat_send(state, &id, &line)),
        Request::ChatStop { id } => {
            let chat = lock(state).chats.remove(&id);
            if let Some(mut child) = chat.and_then(|c| c.child) {
                let _ = child.kill();
                let _ = child.wait();
            }
            reply(&stream, Ok(()))
        }
        Request::TermOpen { id, start } => term_open(state, id, start, stream),
        Request::TermWrite { id, data } => {
            let mut s = lock(state);
            let result = match s.terms.get_mut(&id).filter(|t| !t.info.ended) {
                Some(t) => t
                    .writer
                    .write_all(data.as_bytes())
                    .and_then(|()| t.writer.flush())
                    .map_err(|e| e.to_string()),
                None => Err("terminal is closed".into()),
            };
            reply(&stream, result)
        }
        Request::TermResize { id, cols, rows } => {
            let s = lock(state);
            let result = match s.terms.get(&id) {
                Some(t) => t
                    .master
                    .resize(pty::size(cols, rows))
                    .map_err(|e| e.to_string()),
                None => Err("terminal is closed".into()),
            };
            reply(&stream, result)
        }
        Request::TermKill { id } => {
            if let Some(mut t) = lock(state).terms.remove(&id) {
                let _ = t.killer.kill();
            }
            reply(&stream, Ok(()))
        }
        Request::Peek => writeln!(&stream, "{}", serde_json::json!({ "chats": peek(state) })),
        Request::Ask { ask } => {
            let answer =
                ask_window(state, ask).unwrap_or_else(|e| serde_json::json!({ "error": e }));
            writeln!(&stream, "{answer}")
        }
        Request::Answer { ask_id, result } => {
            let to = lock(state).asks.remove(&ask_id);
            reply(
                &stream,
                to.ok_or_else(|| "nobody waits for that answer".to_string())
                    .and_then(|to| to.send(result).map_err(|e| e.to_string())),
            )
        }
        Request::ServersStart {
            workspace_id,
            project_id,
            cwd,
            apps,
        } => answer_with(
            &stream,
            servers_start(state, &workspace_id, &project_id, &cwd, apps.as_deref()),
        ),
        Request::ServersStop { workspace_id, apps } => {
            servers_stop(state, &workspace_id, apps.as_deref());
            reply(&stream, Ok(()))
        }
        Request::ServersList => writeln!(
            &stream,
            "{}",
            serde_json::json!({ "runs": servers_list(state) })
        ),
        Request::ServersLogs {
            workspace_id,
            app,
            lines,
        } => answer_with(
            &stream,
            servers_logs(state, &workspace_id, &app, lines)
                .map(|text| serde_json::json!({ "text": text })),
        ),
    }
}

fn answer_with(mut out: &UnixStream, result: Result<Value, String>) -> std::io::Result<()> {
    let v = result.unwrap_or_else(|e| serde_json::json!({ "error": e }));
    writeln!(out, "{v}")
}

fn peek(state: &Shared) -> Vec<HostChat> {
    lock(state)
        .chats
        .iter()
        .map(|(id, c)| HostChat {
            id: id.clone(),
            alive: !c.ended,
            working: c.flags.working,
            waiting: c.flags.waiting,
            unread: c.flags.unread,
            history_len: c.history_len,
            account: c.account.clone(),
        })
        .collect()
}

/// Hands `ask` to the windows and waits for the first answer.
fn ask_window(state: &Shared, mut ask: Value) -> Result<Value, String> {
    let (tx, rx) = mpsc::channel();
    let id = {
        let mut s = lock(state);
        s.serial += 1;
        let id = s.serial;
        ask["askId"] = id.into();
        let line = serde_json::json!({ "ask": ask }).to_string();
        if !broadcast(&mut s.window_streams, &line) {
            return Err("logit's window is closed: ask the user to open logit.".into());
        }
        s.asks.insert(id, tx);
        id
    };
    let answer = rx.recv_timeout(ASK_WAIT);
    lock(state).asks.remove(&id);
    answer.map_err(|_| "logit's window did not answer.".to_string())
}

/// What runs, for a window attaching. The window now holds the unread flags, so they are
/// cleared here.
fn list(state: &Shared) -> HostList {
    let mut s = lock(state);
    // A plain shell that ended never comes back as a tab: nobody would collect it.
    s.terms
        .retain(|_, t| !(t.info.ended && t.info.command.is_none()));
    let mut chats: Vec<HostChat> = s
        .chats
        .iter_mut()
        .map(|(id, c)| {
            let chat = HostChat {
                id: id.clone(),
                alive: !c.ended,
                working: c.flags.working,
                waiting: c.flags.waiting,
                unread: c.flags.unread,
                history_len: c.history_len,
                account: c.account.clone(),
            };
            c.flags.unread = false;
            chat
        })
        .collect();
    chats.extend(s.unread.drain().map(|id| HostChat {
        id,
        alive: false,
        working: false,
        waiting: false,
        unread: true,
        history_len: 0,
        account: None,
    }));
    let terms = s.terms.values().map(|t| t.info.clone()).collect();
    HostList { chats, terms }
}

fn chat_open(
    state: &Shared,
    id: String,
    start: Option<ChatStart>,
    mut stream: UnixStream,
) -> std::io::Result<()> {
    let mut s = lock(state);
    let gone = s.chats.get(&id).is_none_or(|c| c.ended);
    if let Some(start) = start.filter(|_| gone) {
        let args = claude_args(
            start.resume.as_deref(),
            start.model.as_deref(),
            start.effort.as_deref(),
        );
        let mut child = match spawn_claude(&start.cwd, args, Some(&id), start.account.as_deref()) {
            Ok(child) => child,
            Err(e) => return writeln!(stream, "{}", serde_json::json!({ "error": e })),
        };
        let (Some(stdin), Some(stdout), Some(stderr)) =
            (child.stdin.take(), child.stdout.take(), child.stderr.take())
        else {
            let _ = child.kill();
            return writeln!(stream, r#"{{"error":"claude: no stdio"}}"#);
        };
        s.serial += 1;
        let serial = s.serial;
        let (st, cid) = (state.clone(), id.clone());
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let line = serde_json::json!({ "type": "logit_stderr", "text": line });
                chat_out(&st, &cid, serial, line.to_string(), false);
            }
        });
        let (st, cid) = (state.clone(), id.clone());
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if !line.trim().is_empty() {
                    chat_out(&st, &cid, serial, line, true);
                }
            }
            chat_exit(&st, &cid, serial);
        });
        s.chats.insert(
            id.clone(),
            ChatProc {
                serial,
                child: Some(child),
                stdin,
                lines: Vec::new(),
                subs: Vec::new(),
                flags: ChatFlags::default(),
                history_len: start.history_len,
                account: start.account.clone(),
                ended: false,
                last_activity: Instant::now(),
                compacted: true,
            },
        );
    }
    // Replay then subscribe under one lock: no line is lost or doubled in between.
    let Some(chat) = s.chats.get_mut(&id) else {
        return writeln!(stream, "{EXIT}");
    };
    for line in &chat.lines {
        writeln!(stream, "{line}")?;
    }
    writeln!(stream, "{LIVE}")?;
    if chat.ended {
        writeln!(stream, "{EXIT}")?;
        s.chats.remove(&id);
    } else {
        chat.subs.push(stream);
    }
    Ok(())
}

fn chat_out(state: &Shared, id: &str, serial: u64, line: String, observe: bool) {
    let mut s = lock(state);
    let windows = s.windows;
    let Some(chat) = s.chats.get_mut(id).filter(|c| c.serial == serial) else {
        return;
    };
    if observe {
        chat.flags.observe_out(&line, windows);
    }
    chat.last_activity = Instant::now();
    broadcast(&mut chat.subs, &line);
    chat.lines.push(line);
}

fn chat_exit(state: &Shared, id: &str, serial: u64) {
    let child = {
        let mut s = lock(state);
        let Some(chat) = s.chats.get_mut(id).filter(|c| c.serial == serial) else {
            return;
        };
        chat.ended = true;
        chat.flags.working = false;
        chat.flags.waiting = false;
        let child = chat.child.take();
        // Kept until a window has seen the exit.
        if broadcast(&mut chat.subs, EXIT) {
            s.chats.remove(id);
        }
        child
    };
    if let Some(mut child) = child {
        let _ = child.wait();
    }
}

/// Sends Claude `/compact` from the host; the windows show it as if one had sent it.
fn compact(chat: &mut ChatProc) {
    chat.compacted = true;
    if writeln!(chat.stdin, "{COMPACT_LINE}")
        .and_then(|()| chat.stdin.flush())
        .is_err()
    {
        return;
    }
    chat.flags.observe_in(COMPACT_LINE);
    chat.last_activity = Instant::now();
    let sent = sent_line(COMPACT_LINE);
    broadcast(&mut chat.subs, &sent);
    chat.lines.push(sent);
}

fn chat_send(state: &Shared, id: &str, line: &str) -> Result<(), String> {
    let mut s = lock(state);
    let chat = s
        .chats
        .get_mut(id)
        .filter(|c| !c.ended)
        .ok_or("chat is closed")?;
    writeln!(chat.stdin, "{line}")
        .and_then(|()| chat.stdin.flush())
        .map_err(|e| e.to_string())?;
    chat.flags.observe_in(line);
    chat.last_activity = Instant::now();
    chat.compacted &= !chat.flags.working;
    // Replay only: the window that sent it already shows it.
    let sent = sent_line(line);
    if !sent.is_empty() {
        chat.lines.push(sent);
    }
    Ok(())
}

fn term_open(
    state: &Shared,
    id: String,
    start: Option<TermStart>,
    mut stream: UnixStream,
) -> std::io::Result<()> {
    let mut s = lock(state);
    if let Some(start) = start {
        if let Err(e) = term_spawn(state, &mut s, &id, start) {
            return writeln!(stream, "{}", serde_json::json!({ "error": e }));
        }
    }
    let Some(term) = s.terms.get_mut(&id) else {
        return writeln!(stream, r#"{{"exit":null}}"#);
    };
    let text = term.output.contents();
    if !text.is_empty() {
        writeln!(stream, "{}", serde_json::json!({ "d": text }))?;
    }
    writeln!(stream, r#"{{"live":true}}"#)?;
    if term.info.ended {
        writeln!(stream, "{}", serde_json::json!({ "exit": term.info.code }))?;
        s.terms.remove(&id);
    } else {
        term.subs.push(stream);
    }
    Ok(())
}

/// Starts terminal `id` unless one runs under that id already.
fn term_spawn(state: &Shared, s: &mut State, id: &str, start: TermStart) -> Result<(), String> {
    if s.terms.get(id).is_some_and(|t| !t.info.ended) {
        return Ok(());
    }
    let (master, mut child, mut reader, writer) = pty::spawn(
        &start.cwd,
        start.cols,
        start.rows,
        start.command.as_deref(),
        &start.env,
    )?;
    let killer = child.clone_killer();
    let pid = child.process_id();
    s.serial += 1;
    let serial = s.serial;
    let (st, tid) = (state.clone(), id.to_string());
    std::thread::spawn(move || {
        let mut buf = vec![0u8; 16 * 1024];
        let mut carry: Vec<u8> = Vec::new();
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            carry.extend_from_slice(&buf[..n]);
            let cut = pty::utf8_cut(&carry);
            let text = String::from_utf8_lossy(&carry[..cut]).into_owned();
            carry.drain(..cut);
            if !text.is_empty() {
                term_out(&st, &tid, serial, &text);
            }
        }
        let code = child.wait().ok().map(|status| status.exit_code());
        term_exit(&st, &tid, serial, code);
    });
    let info = HostTerm {
        id: id.to_string(),
        workspace_id: start.workspace_id,
        cwd: start.cwd,
        title: start.title,
        command: start.command,
        tag: start.tag,
        ended: false,
        code: None,
    };
    s.terms.insert(
        id.to_string(),
        TermProc {
            serial,
            master,
            writer,
            killer,
            output: TermBuffer::default(),
            subs: Vec::new(),
            info,
            pid,
        },
    );
    Ok(())
}

fn term_out(state: &Shared, id: &str, serial: u64, text: &str) {
    let mut s = lock(state);
    let Some(term) = s.terms.get_mut(id).filter(|t| t.serial == serial) else {
        return;
    };
    broadcast(
        &mut term.subs,
        &serde_json::json!({ "d": text }).to_string(),
    );
    term.output.push(text);
}

fn term_exit(state: &Shared, id: &str, serial: u64, code: Option<u32>) {
    let mut s = lock(state);
    let Some(term) = s.terms.get_mut(id).filter(|t| t.serial == serial) else {
        return;
    };
    term.info.ended = true;
    term.info.code = code;
    let tail = servers::tail(&term.output.contents(), LOG_TAIL);
    server_exited(&mut s, id, code, tail);
    let Some(term) = s.terms.get_mut(id) else {
        return;
    };
    // Kept, listed as ended, until a window has seen the exit: a setup script records it so.
    if broadcast(
        &mut term.subs,
        &serde_json::json!({ "exit": code }).to_string(),
    ) {
        s.terms.remove(id);
    }
}

// Dev servers: each workspace's apps on its own slot, run as terminals of the host.

/// How many lines of output a failure quotes.
const LOG_TAIL: usize = 30;
const PORT_POLL: Duration = Duration::from_secs(1);

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AppStatus {
    /// Waiting for `prepare`, or for another workspace of the project to finish booting.
    Queued,
    /// Running, its port not open yet.
    Starting,
    Ready,
    Failed,
    Stopped,
}

struct AppRun {
    status: AppStatus,
    started: Option<Instant>,
    /// Why it failed, with the end of its output.
    detail: Option<String>,
}

struct ServerRun {
    project_id: String,
    cwd: String,
    slot: u16,
    config: Config,
    /// None while `prepare` runs or has not run; its exit code once it ended.
    prepare: Option<Option<u32>>,
    preparing: bool,
    prepare_tail: String,
    /// Bumped by every start and full stop: a boot thread of an older one gives up.
    generation: u64,
    apps: BTreeMap<String, AppRun>,
}

fn term_id(workspace: &str, app: &str) -> String {
    format!("srv-{workspace}-{app}")
}

fn busy(status: AppStatus) -> bool {
    matches!(
        status,
        AppStatus::Queued | AppStatus::Starting | AppStatus::Ready
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub port: Option<u16>,
    pub url: Option<String>,
    pub status: AppStatus,
    pub detail: Option<String>,
    pub term: String,
    pub optional: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunInfo {
    pub workspace_id: String,
    pub project_id: String,
    pub cwd: String,
    pub slot: u16,
    pub preparing: bool,
    pub prepare_term: Option<String>,
    pub apps: Vec<AppInfo>,
}

fn run_info(workspace: &str, run: &ServerRun) -> RunInfo {
    let ports = run.config.ports(run.slot);
    RunInfo {
        workspace_id: workspace.into(),
        project_id: run.project_id.clone(),
        cwd: run.cwd.clone(),
        slot: run.slot,
        preparing: run.preparing,
        prepare_term: run
            .config
            .prepare
            .as_ref()
            .map(|_| term_id(workspace, "prepare")),
        apps: run
            .config
            .apps
            .iter()
            .map(|a| {
                let r = run.apps.get(&a.name);
                let port = ports.get(&a.name).copied();
                AppInfo {
                    name: a.name.clone(),
                    port,
                    url: port.map(servers::url),
                    status: r.map_or(AppStatus::Stopped, |r| r.status),
                    detail: r.and_then(|r| r.detail.clone()),
                    term: term_id(workspace, &a.name),
                    optional: a.optional,
                }
            })
            .collect(),
    }
}

fn servers_list(state: &Shared) -> Vec<RunInfo> {
    let s = lock(state);
    let mut runs: Vec<RunInfo> = s.servers.iter().map(|(w, r)| run_info(w, r)).collect();
    runs.sort_by_key(|r| r.slot);
    runs
}

/// One lock per project: a single workspace prepares and boots at a time.
fn project_gate(project: &str) -> Arc<Mutex<()>> {
    static GATES: Mutex<BTreeMap<String, Arc<Mutex<()>>>> = Mutex::new(BTreeMap::new());
    let mut gates = GATES.lock().unwrap_or_else(|e| e.into_inner());
    gates.entry(project.to_string()).or_default().clone()
}

/// A slot whose ports no other run holds and nothing listens on, reserved under `workspace`.
fn reserve_slot(
    state: &Shared,
    workspace: &str,
    project: &str,
    cwd: &str,
    config: &Config,
) -> Result<u16, String> {
    for slot in servers::SLOTS {
        let ports: HashSet<u16> = config.ports(slot).into_values().collect();
        {
            let mut s = lock(state);
            let held = s.servers.iter().any(|(w, r)| {
                w != workspace
                    && (r.project_id == project && r.slot == slot
                        || r.config.ports(r.slot).values().any(|p| ports.contains(p)))
            });
            if held {
                continue;
            }
            s.servers.insert(
                workspace.to_string(),
                ServerRun {
                    project_id: project.into(),
                    cwd: cwd.into(),
                    slot,
                    config: config.clone(),
                    prepare: None,
                    preparing: false,
                    prepare_tail: String::new(),
                    generation: 0,
                    apps: BTreeMap::new(),
                },
            );
        }
        // Probed outside the lock; the reservation keeps a concurrent start off this slot.
        if !ports.iter().any(|p| servers::port_busy(*p)) {
            return Ok(slot);
        }
        lock(state).servers.remove(workspace);
    }
    Err("no free slot (1..9): stop another workspace's servers first.".into())
}

fn servers_start(
    state: &Shared,
    workspace: &str,
    project: &str,
    cwd: &str,
    apps: Option<&[String]>,
) -> Result<Value, String> {
    if !Path::new(cwd).is_absolute() || !Path::new(cwd).is_dir() {
        return Err(format!("not a worktree folder: {cwd:?}"));
    }
    let (config, _) = servers::load(project, cwd)?
        .ok_or("this project declares no dev servers (Settings, or .logit/servers.json)")?;
    let names = config.pick(apps)?;
    let known = lock(state).servers.contains_key(workspace);
    if !known {
        reserve_slot(state, workspace, project, cwd, &config)?;
    }
    let (generation, todo) = {
        let mut s = lock(state);
        let run = s
            .servers
            .get_mut(workspace)
            .ok_or("the servers were stopped meanwhile")?;
        let nothing_runs = !run.apps.values().any(|a| busy(a.status));
        if nothing_runs {
            // Idle: the config may have changed since; the slot stays.
            run.config = config.clone();
        }
        let todo: Vec<String> = names
            .into_iter()
            .filter(|n| !run.apps.get(n).is_some_and(|a| busy(a.status)))
            .collect();
        for n in &todo {
            run.apps.insert(
                n.clone(),
                AppRun {
                    status: AppStatus::Queued,
                    started: None,
                    detail: None,
                },
            );
        }
        run.generation += 1;
        (run.generation, todo)
    };
    if !todo.is_empty() {
        let (st, w, p) = (state.clone(), workspace.to_string(), project.to_string());
        std::thread::spawn(move || boot(&st, &w, &p, generation, &todo));
    }
    let s = lock(state);
    let run = s.servers.get(workspace).ok_or("stopped meanwhile")?;
    serde_json::to_value(run_info(workspace, run)).map_err(|e| e.to_string())
}

/// What a boot step sees of its run: None once it was stopped or restarted.
fn current<'a>(s: &'a mut State, workspace: &str, generation: u64) -> Option<&'a mut ServerRun> {
    s.servers
        .get_mut(workspace)
        .filter(|r| r.generation == generation)
}

fn fail_queued(state: &Shared, workspace: &str, apps: &[String], detail: &str) {
    let mut s = lock(state);
    if let Some(run) = s.servers.get_mut(workspace) {
        for n in apps {
            if let Some(a) = run
                .apps
                .get_mut(n)
                .filter(|a| a.status == AppStatus::Queued)
            {
                a.status = AppStatus::Failed;
                a.detail = Some(detail.to_string());
            }
        }
    }
}

fn server_start(
    workspace: &str,
    cwd: &str,
    name: &str,
    command: String,
    env: Vec<(String, String)>,
) -> TermStart {
    TermStart {
        cwd: cwd.into(),
        cols: 120,
        rows: 30,
        command: Some(command),
        workspace_id: workspace.into(),
        title: name.into(),
        tag: Some(format!("server:{name}")),
        env,
    }
}

/// Prepares then starts `apps`, then waits for their ports, holding the project's gate.
fn boot(state: &Shared, workspace: &str, project: &str, generation: u64, apps: &[String]) {
    let gate = project_gate(project);
    let _gate = gate.lock().unwrap_or_else(|e| e.into_inner());
    let Some((config, cwd, slot)) = ({
        let mut s = lock(state);
        current(&mut s, workspace, generation).map(|r| (r.config.clone(), r.cwd.clone(), r.slot))
    }) else {
        return;
    };

    if let Some(prepare) = &config.prepare {
        let id = term_id(workspace, "prepare");
        let spawned = servers::fill(prepare, slot, &config.ports(slot), None).and_then(|cmd| {
            let env = servers::env_for(&config, slot, None)?;
            let mut s = lock(state);
            let run = current(&mut s, workspace, generation).ok_or("stopped")?;
            run.prepare = None;
            run.preparing = true;
            term_spawn(
                state,
                &mut s,
                &id,
                server_start(workspace, &cwd, "prepare", cmd, env),
            )
        });
        if let Err(e) = spawned {
            return fail_queued(state, workspace, apps, &format!("prepare: {e}"));
        }
        let code = loop {
            std::thread::sleep(PORT_POLL / 2);
            let mut s = lock(state);
            let Some(run) = current(&mut s, workspace, generation) else {
                return;
            };
            if let Some(code) = run.prepare {
                run.preparing = false;
                break (code, run.prepare_tail.clone());
            }
        };
        if code.0 != Some(0) {
            let detail = format!(
                "prepare failed (exit {}):\n{}",
                code.0.map_or("?".into(), |c| c.to_string()),
                code.1
            );
            return fail_queued(state, workspace, apps, &detail);
        }
    }

    for name in apps {
        let Some(app) = config.app(name) else {
            continue;
        };
        let made = servers::fill(&app.command, slot, &config.ports(slot), Some(name))
            .and_then(|cmd| Ok((cmd, servers::env_for(&config, slot, Some(app))?)));
        let mut s = lock(state);
        let spawned = made.and_then(|(cmd, env)| {
            current(&mut s, workspace, generation).ok_or("stopped")?;
            term_spawn(
                state,
                &mut s,
                &term_id(workspace, name),
                server_start(workspace, &cwd, name, cmd, env),
            )
        });
        let Some(run) = current(&mut s, workspace, generation) else {
            return;
        };
        let Some(a) = run
            .apps
            .get_mut(name)
            .filter(|a| a.status == AppStatus::Queued)
        else {
            continue;
        };
        match spawned {
            Ok(()) if app.port.is_none() => a.status = AppStatus::Ready,
            Ok(()) => {
                a.status = AppStatus::Starting;
                a.started = Some(Instant::now());
            }
            Err(e) => {
                a.status = AppStatus::Failed;
                a.detail = Some(e);
            }
        }
    }

    // Ports, probed outside the lock.
    let ports = config.ports(slot);
    loop {
        let waiting: Vec<(String, u16, Instant)> = {
            let mut s = lock(state);
            let Some(run) = current(&mut s, workspace, generation) else {
                return;
            };
            run.apps
                .iter()
                .filter(|(n, a)| a.status == AppStatus::Starting && apps.contains(n))
                .filter_map(|(n, a)| Some((n.clone(), *ports.get(n)?, a.started?)))
                .collect()
        };
        if waiting.is_empty() {
            return;
        }
        for (name, port, started) in waiting {
            let timeout = config
                .app(&name)
                .and_then(|a| a.timeout)
                .unwrap_or(servers::DEFAULT_TIMEOUT);
            let up = servers::port_busy(port);
            let mut s = lock(state);
            let tail = s
                .terms
                .get(&term_id(workspace, &name))
                .map(|t| servers::tail(&t.output.contents(), LOG_TAIL))
                .unwrap_or_default();
            let Some(run) = current(&mut s, workspace, generation) else {
                return;
            };
            let Some(a) = run
                .apps
                .get_mut(&name)
                .filter(|a| a.status == AppStatus::Starting)
            else {
                continue;
            };
            if up {
                a.status = AppStatus::Ready;
            } else if started.elapsed() > Duration::from_secs(timeout) {
                a.status = AppStatus::Failed;
                a.detail = Some(format!("port {port} not open after {timeout} s:\n{tail}"));
            }
        }
        std::thread::sleep(PORT_POLL);
    }
}

/// A server terminal ended: its app failed unless it was being stopped.
fn server_exited(s: &mut State, term: &str, code: Option<u32>, tail: String) {
    for (w, run) in s.servers.iter_mut() {
        if term == term_id(w, "prepare") {
            run.prepare = Some(code);
            run.prepare_tail = tail;
            return;
        }
        let Some(name) = run
            .config
            .apps
            .iter()
            .map(|a| a.name.clone())
            .find(|n| term == term_id(w, n))
        else {
            continue;
        };
        if let Some(a) = run.apps.get_mut(&name).filter(|a| busy(a.status)) {
            a.status = AppStatus::Failed;
            let code = code.map_or("?".into(), |c| c.to_string());
            a.detail = Some(format!("exited (code {code}):\n{tail}"));
        }
        return;
    }
}

/// Stops `apps` (all when None, and forgets the run): only the process trees the host started.
fn servers_stop(state: &Shared, workspace: &str, apps: Option<&[String]>) {
    let (pids, terms) = {
        let mut s = lock(state);
        let st = &mut *s;
        let Some(run) = st.servers.get_mut(workspace) else {
            return;
        };
        let mut names: Vec<String> = match apps {
            Some(a) if !a.is_empty() => a.to_vec(),
            _ => {
                run.generation += 1;
                let mut all: Vec<String> = run.config.apps.iter().map(|a| a.name.clone()).collect();
                all.push("prepare".into());
                all
            }
        };
        names.dedup();
        for n in &names {
            if let Some(a) = run.apps.get_mut(n) {
                a.status = AppStatus::Stopped;
                a.detail = None;
            }
        }
        let terms: Vec<String> = names.iter().map(|n| term_id(workspace, n)).collect();
        let pids: Vec<u32> = terms
            .iter()
            .filter_map(|t| st.terms.get(t).filter(|t| !t.info.ended)?.pid)
            .collect();
        (pids, terms)
    };
    servers::stop_trees(&pids);
    let mut s = lock(state);
    for t in &terms {
        if let Some(mut term) = s.terms.remove(t) {
            let _ = term.killer.kill();
            broadcast(
                &mut term.subs,
                &serde_json::json!({ "exit": term.info.code }).to_string(),
            );
        }
    }
    if apps.is_none_or(|a| a.is_empty()) {
        s.servers.remove(workspace);
    }
}

fn servers_logs(
    state: &Shared,
    workspace: &str,
    app: &str,
    lines: usize,
) -> Result<String, String> {
    let s = lock(state);
    if let Some(t) = s.terms.get(&term_id(workspace, app)) {
        return Ok(servers::tail(&t.output.contents(), lines.clamp(1, 2000)));
    }
    let run = s
        .servers
        .get(workspace)
        .ok_or("no dev servers run in this workspace")?;
    if app == "prepare" {
        return Ok(run.prepare_tail.clone());
    }
    Ok(run
        .apps
        .get(app)
        .and_then(|a| a.detail.clone())
        .unwrap_or_else(|| format!("{app} has no output (not started)")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_turn_finished_with_no_window_is_unread() {
        let mut f = ChatFlags::default();
        f.observe_in(r#"{"type":"user","message":{}}"#);
        assert!(f.working);
        f.observe_out(r#"{"type":"result","subtype":"success"}"#, 0);
        assert!(!f.working && f.unread);
    }

    #[test]
    fn a_turn_finished_in_front_of_a_window_is_not_unread() {
        let mut f = ChatFlags::default();
        f.observe_out(r#"{"type":"result","subtype":"success"}"#, 1);
        assert!(!f.unread);
    }

    #[test]
    fn an_idle_chat_compacts_once_after_a_turn() {
        let mut child = std::process::Command::new("cat")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let mut out = BufReader::new(child.stdout.take().unwrap());
        let mut chat = ChatProc {
            serial: 1,
            stdin: child.stdin.take().unwrap(),
            child: Some(child),
            lines: Vec::new(),
            subs: Vec::new(),
            flags: ChatFlags::default(),
            history_len: 0,
            account: None,
            ended: false,
            last_activity: Instant::now() - CHAT_COMPACT,
            compacted: true,
        };
        assert!(!chat.due_for_compact(), "nothing ran yet");
        chat.compacted = false;
        chat.flags.working = true;
        assert!(!chat.due_for_compact(), "a turn runs");
        chat.flags.working = false;
        chat.last_activity = Instant::now();
        assert!(!chat.due_for_compact(), "not idle long enough");
        chat.last_activity = Instant::now() - CHAT_COMPACT;
        assert!(chat.due_for_compact());

        compact(&mut chat);
        let mut line = String::new();
        out.read_line(&mut line).unwrap();
        assert!(line.contains("/compact"));
        assert!(chat.lines[0].contains("logit_sent"));
        chat.flags.working = false;
        chat.last_activity = Instant::now() - CHAT_COMPACT;
        assert!(!chat.due_for_compact(), "once per pause");
        let _ = chat.child.take().map(|mut c| c.kill());
    }

    #[test]
    fn a_permission_waits_until_answered() {
        let mut f = ChatFlags::default();
        f.observe_out(
            r#"{"type":"control_request","request":{"subtype":"can_use_tool"}}"#,
            1,
        );
        assert!(f.waiting);
        f.observe_in(r#"{"type":"control_response","response":{}}"#);
        assert!(!f.waiting);
    }

    #[test]
    fn term_buffer_drops_the_oldest_output() {
        let mut b = TermBuffer::default();
        b.push(&"a".repeat(TERM_BUFFER_BYTES));
        b.push("tail");
        assert!(b.contents().ends_with("tail"));
        assert!(b.contents().len() <= TERM_BUFFER_BYTES);
    }

    #[test]
    fn requests_use_snake_case_ops() {
        let r: Request = serde_json::from_str(r#"{"op":"term_kill","id":"t1"}"#).unwrap();
        assert!(matches!(r, Request::TermKill { id } if id == "t1"));
    }

    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::time::Duration;

    /// A socket path removed when the test ends; the test's host thread dies with the binary.
    struct TempSock(PathBuf);

    impl Drop for TempSock {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    impl std::ops::Deref for TempSock {
        type Target = std::path::Path;
        fn deref(&self) -> &std::path::Path {
            &self.0
        }
    }

    // macOS caps socket paths at 104 bytes: no deep temp dir.
    fn temp_sock() -> TempSock {
        static N: AtomicU32 = AtomicU32::new(0);
        let n = N.fetch_add(1, Ordering::Relaxed);
        TempSock(PathBuf::from(format!(
            "/tmp/axh-{}-{n}.sock",
            std::process::id()
        )))
    }

    fn spawn_serve(sock: &std::path::Path) {
        let s = sock.to_path_buf();
        std::thread::spawn(move || serve(&s).unwrap());
        for _ in 0..100 {
            if UnixStream::connect(sock).is_ok() {
                return;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        panic!("the host did not start");
    }

    fn open(sock: &std::path::Path, json: &str) -> BufReader<UnixStream> {
        let mut s = UnixStream::connect(sock).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        writeln!(s, "{json}").unwrap();
        BufReader::new(s)
    }

    fn request(sock: &std::path::Path, json: &str) -> Value {
        let mut line = String::new();
        open(sock, json).read_line(&mut line).unwrap();
        serde_json::from_str(&line).unwrap()
    }

    fn read_until(r: &mut BufReader<UnixStream>, needle: &str) -> bool {
        let mut line = String::new();
        loop {
            line.clear();
            match r.read_line(&mut line) {
                Ok(0) | Err(_) => return false,
                Ok(_) if line.contains(needle) => return true,
                Ok(_) => {}
            }
        }
    }

    #[test]
    fn an_ask_needs_a_window_and_gets_its_answer() {
        let sock = temp_sock();
        spawn_serve(&sock);
        let none = request(&sock, r#"{"op":"ask","ask":{"op":"chat_send"}}"#);
        assert!(none["error"].as_str().unwrap().contains("closed"));

        let mut window = open(&sock, r#"{"op":"window"}"#);
        // The window must be counted before the ask goes out.
        std::thread::sleep(Duration::from_millis(100));
        let path = sock.to_path_buf();
        let asked = std::thread::spawn(move || {
            request(
                &path,
                r#"{"op":"ask","ask":{"op":"chat_send","text":"hi"}}"#,
            )
        });
        let mut line = String::new();
        window.read_line(&mut line).unwrap();
        let ask: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(ask["ask"]["text"], "hi");
        let id = ask["ask"]["askId"].as_u64().unwrap();
        let ok = request(
            &sock,
            &format!(r#"{{"op":"answer","ask_id":{id},"result":{{"chatId":"c1"}}}}"#),
        );
        assert_eq!(ok["ok"], true);
        assert_eq!(asked.join().unwrap()["chatId"], "c1");
    }

    #[test]
    fn a_terminal_outlives_its_window_and_replays() {
        let sock = temp_sock();
        spawn_serve(&sock);
        let mut a = open(
            &sock,
            r#"{"op":"term_open","id":"t1","start":{"cwd":"/tmp","cols":80,"rows":24,"command":"echo logit-host","workspaceId":"w","title":"T","tag":"setup"}}"#,
        );
        assert!(read_until(&mut a, "\"exit\":0"));
        drop(a);
        let list = request(&sock, r#"{"op":"list"}"#);
        // The exit reached `a`, so the ended entry is gone.
        assert_eq!(list["terms"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn an_ended_terminal_waits_for_a_window_to_see_its_exit() {
        let sock = temp_sock();
        spawn_serve(&sock);
        let a = open(
            &sock,
            r#"{"op":"term_open","id":"t2","start":{"cwd":"/tmp","cols":80,"rows":24,"command":"sleep 0.3; echo done-late","workspaceId":"w","title":"T","tag":"setup"}}"#,
        );
        drop(a);
        // The shell reads the user's rc files first (`-i`): give it time, without a fixed wait.
        let mut list = request(&sock, r#"{"op":"list"}"#);
        for _ in 0..100 {
            if list["terms"][0]["ended"] == true {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
            list = request(&sock, r#"{"op":"list"}"#);
        }
        assert_eq!(list["terms"][0]["ended"], true);
        assert_eq!(list["terms"][0]["tag"], "setup");
        let mut b = open(&sock, r#"{"op":"term_open","id":"t2"}"#);
        assert!(read_until(&mut b, "done-late"));
        assert!(read_until(&mut b, "\"exit\":0"));
    }

    #[test]
    fn hello_reports_the_protocol() {
        let sock = temp_sock();
        spawn_serve(&sock);
        assert_eq!(
            request(&sock, r#"{"op":"hello"}"#)["protocol"],
            HOST_PROTOCOL
        );
        let mode = std::fs::metadata(&*sock).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn a_second_host_leaves_a_live_socket_alone() {
        let sock = temp_sock();
        spawn_serve(&sock);
        assert!(serve(&sock).is_ok()); // returns at once
        assert_eq!(
            request(&sock, r#"{"op":"hello"}"#)["protocol"],
            HOST_PROTOCOL
        );
    }

    fn servers_dir(name: &str, base: u16) -> String {
        let dir = std::env::temp_dir().join(format!("logit-srv-{name}-{}", std::process::id()));
        std::fs::create_dir_all(dir.join(".logit")).unwrap();
        let config = format!(
            r#"{{"prepare":"echo prepared","apps":[{{"name":"web","port":{base},"command":"exec python3 -m http.server ${{port}} --bind 127.0.0.1","env":{{"EMPTY":""}},"timeout":20}}]}}"#
        );
        std::fs::write(dir.join(".logit/servers.json"), config).unwrap();
        dir.to_string_lossy().into_owned()
    }

    fn app_status(sock: &std::path::Path, ws: &str) -> Option<(u16, String)> {
        let list = request(sock, r#"{"op":"servers_list"}"#);
        let run = list["runs"]
            .as_array()?
            .iter()
            .find(|r| r["workspaceId"] == ws)?
            .clone();
        Some((
            run["apps"][0]["port"].as_u64()? as u16,
            run["apps"][0]["status"].as_str()?.into(),
        ))
    }

    fn wait_ready(sock: &std::path::Path, ws: &str) -> u16 {
        for _ in 0..200 {
            if let Some((port, status)) = app_status(sock, ws) {
                assert_ne!(
                    status,
                    "failed",
                    "{}",
                    request(sock, r#"{"op":"servers_list"}"#)
                );
                if status == "ready" {
                    return port;
                }
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        panic!("{ws} never got ready");
    }

    #[test]
    fn two_workspaces_get_their_own_ports_and_stopping_frees_them() {
        let sock = temp_sock();
        spawn_serve(&sock);
        let base = 47_310;
        let (a, b) = (servers_dir("a", base), servers_dir("b", base));
        for (ws, cwd) in [("wa", &a), ("wb", &b)] {
            let r = request(
                &sock,
                &format!(
                    r#"{{"op":"servers_start","workspace_id":"{ws}","project_id":"p","cwd":"{cwd}"}}"#
                ),
            );
            assert!(r["slot"].as_u64().unwrap() >= 1, "{r}");
        }
        let (pa, pb) = (wait_ready(&sock, "wa"), wait_ready(&sock, "wb"));
        assert_ne!(pa, pb);
        assert!(pa > base && pb > base, "slot 0 is never used");
        request(&sock, r#"{"op":"servers_stop","workspace_id":"wa"}"#);
        assert!(!servers::port_busy(pa));
        assert!(servers::port_busy(pb));
        assert!(app_status(&sock, "wa").is_none());
        request(&sock, r#"{"op":"servers_stop","workspace_id":"wb"}"#);
        assert!(!servers::port_busy(pb));
    }
}
