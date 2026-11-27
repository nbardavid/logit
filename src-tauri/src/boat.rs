//! Workspaces whose Claude runs on a Boat sandbox (boat.dev), driven through the `boat` CLI.
//! Two subcommands of this binary do the work: `--boat-setup <workspace>` makes the sandbox
//! (run as the workspace's Setup terminal, so its progress shows there) and `--boat-chat
//! <workspace> <chat> -- <claude args>`, which the host spawns instead of `claude`: it pipes
//! stream-json through `boat ssh` and answers logit's MCP from this Mac. No port is opened
//! here: the MCP goes through a Unix socket in the sandbox and a second ssh session.
//! The sandbox id is kept in `<data>/boat/<workspace>.json`, never in the catalog.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::git::tool_path;
use crate::store::{self, data_dir, Workspace};

/// Where the checkout lives in the sandbox.
pub const REPO: &str = "/home/user/repo";
const BRIDGE_PATH: &str = "/home/user/.logit/bridge.py";

/// Relays stdio to a Unix socket in the sandbox: `bridge.py <sock>` is the MCP server Claude
/// starts (it connects, retrying while the other side comes up); `bridge.py serve <sock>` is
/// what the Mac runs over ssh, each connection relayed to its stdio in turn.
pub const BRIDGE: &str = r#"import os, socket, sys, threading, time

def pump(src, dst):
    try:
        while True:
            data = src(65536)
            if not data:
                break
            dst(data)
    except OSError:
        pass

def out(data):
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()

def stdin_read(n):
    return os.read(0, n)

if sys.argv[1] == "serve":
    path = sys.argv[2]
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass
    server = socket.socket(socket.AF_UNIX)
    server.bind(path)
    os.chmod(path, 0o600)
    server.listen(1)
    while True:
        conn, _ = server.accept()
        threading.Thread(target=pump, args=(stdin_read, conn.sendall), daemon=True).start()
        pump(conn.recv, out)
        conn.close()
else:
    path = sys.argv[1]
    deadline = time.time() + 60
    while True:
        try:
            conn = socket.socket(socket.AF_UNIX)
            conn.connect(path)
            break
        except OSError:
            if time.time() > deadline:
                sys.exit("logit: the Mac side of the MCP never came up")
            time.sleep(0.5)
    threading.Thread(target=pump, args=(stdin_read, conn.sendall), daemon=True).start()
    pump(conn.recv, out)
"#;

/// The `boat` binary: `BOAT_BIN`, else the installer's `~/.ascii/bin/boat`, else on the PATH.
pub fn bin() -> PathBuf {
    if let Some(bin) = std::env::var_os("BOAT_BIN") {
        return bin.into();
    }
    let home = std::env::var("HOME").unwrap_or_default();
    let installed = Path::new(&home).join(".ascii/bin/boat");
    if installed.exists() {
        installed
    } else {
        "boat".into()
    }
}

fn command() -> Command {
    let mut cmd = Command::new(bin());
    cmd.env("PATH", tool_path()).env("BOAT_NO_UPDATE", "1");
    cmd
}

/// What logit knows of a workspace's sandbox.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Machine {
    pub id: String,
    #[serde(default)]
    pub ready: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn sidecar(root: &Path, workspace: &str) -> Option<PathBuf> {
    let ok = !workspace.is_empty()
        && workspace
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    ok.then(|| root.join("boat").join(format!("{workspace}.json")))
}

pub fn load(workspace: &str) -> Option<Machine> {
    load_in(&data_dir(), workspace)
}

fn load_in(root: &Path, workspace: &str) -> Option<Machine> {
    let raw = std::fs::read_to_string(sidecar(root, workspace)?).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn save(workspace: &str, machine: &Machine) -> Result<(), String> {
    save_in(&data_dir(), workspace, machine)
}

fn save_in(root: &Path, workspace: &str, machine: &Machine) -> Result<(), String> {
    let path = sidecar(root, workspace).ok_or("bad workspace id")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(machine).map_err(|e| e.to_string())?;
    std::fs::write(path, raw).map_err(|e| e.to_string())
}

fn forget_in(root: &Path, workspace: &str) {
    if let Some(path) = sidecar(root, workspace) {
        let _ = std::fs::remove_file(path);
    }
}

/// `s` as one word for a POSIX shell.
pub fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// Boat's message out of its JSON error, or the raw text.
fn boat_error(text: &str) -> String {
    text.lines()
        .rev()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .find_map(|v| v["error"].as_str().map(String::from))
        .unwrap_or_else(|| text.trim().to_string())
}

/// `boat <args> --json`, its answer parsed (the last JSON line it printed).
pub fn boat(args: &[&str], org: Option<&str>) -> Result<Value, String> {
    let mut cmd = command();
    cmd.args(args).arg("--json");
    if let Some(org) = org.filter(|o| !o.is_empty()) {
        cmd.args(["--org", org]);
    }
    let output = cmd.output().map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => "Boat CLI not found: install it from boat.dev".to_string(),
        _ => format!("boat: {e}"),
    })?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(boat_error(&format!("{stdout}\n{stderr}")));
    }
    Ok(stdout
        .lines()
        .rev()
        .find_map(|l| serde_json::from_str::<Value>(l).ok())
        .unwrap_or(Value::Null))
}

/// The new sandbox's id in what `boat new --json` printed.
pub fn sandbox_id(created: &Value) -> Option<String> {
    [
        &created["id"],
        &created["sandbox"]["id"],
        &created["sandboxes"][0]["id"],
    ]
    .into_iter()
    .filter_map(Value::as_str)
    .find(|id| id.starts_with("bx_"))
    .map(String::from)
}

/// `boat ssh <id> -- <remote>`, its stdin from `input`, the output shown as it comes.
fn ssh_shown(id: &str, remote: &str, input: Option<&Path>) -> Result<(), String> {
    let mut cmd = command();
    cmd.args(["ssh", id, "--", remote]);
    if let Some(file) = input {
        cmd.stdin(std::fs::File::open(file).map_err(|e| e.to_string())?);
    } else {
        cmd.stdin(Stdio::null());
    }
    let status = cmd.status().map_err(|e| format!("boat: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("`{remote}` failed in the sandbox ({status})"))
    }
}

/// `boat ssh <id> -- <remote>`, its output returned.
fn ssh_output(id: &str, remote: &str) -> Result<String, String> {
    let output = command()
        .args(["ssh", id, "--", remote])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("boat: {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        Err(boat_error(&String::from_utf8_lossy(&output.stderr)))
    }
}

/// The ref the sandbox's branch starts from: the remote's copy of the base.
fn remote_base(base: &str) -> String {
    let base = base.trim();
    if base.starts_with("origin/") {
        base.into()
    } else if base.is_empty() {
        "origin/HEAD".into()
    } else {
        format!("origin/{base}")
    }
}

/// The checkout in the sandbox: cloned once, then on the workspace's branch.
pub fn clone_command(origin: &str, branch: &str, base: &str) -> String {
    format!(
        "test -d {REPO}/.git || git clone {origin} {REPO}; cd {REPO} && git fetch origin && git checkout -B {branch} {base}",
        origin = sh_quote(origin),
        branch = sh_quote(branch),
        base = sh_quote(&remote_base(base)),
    )
}

fn find_workspace(workspace: &str) -> Result<(Workspace, store::Project), String> {
    let catalog = store::saved_catalog();
    let w = catalog
        .workspaces
        .iter()
        .find(|w| w.id == workspace)
        .cloned()
        .ok_or("unknown workspace")?;
    let p = catalog
        .projects
        .iter()
        .find(|p| p.id == w.project_id)
        .cloned()
        .ok_or("unknown project")?;
    Ok((w, p))
}

fn org_of(w: &Workspace) -> Option<String> {
    w.boat.as_ref().and_then(|b| b.org.clone())
}

/// How long a sandbox stays on after its agent's last turn before Boat stops it.
const STAY_ON_HOURS: &str = "6";

/// A sandbox's name on Boat: the workspace's, as a slug (`CSV export: bookings` →
/// `csv-export-bookings`), at most 60 characters.
pub fn sandbox_name(name: &str) -> String {
    let mut slug = String::new();
    for c in name.chars() {
        if c.is_alphanumeric() {
            slug.extend(c.to_lowercase());
        } else if !slug.is_empty() && !slug.ends_with('-') {
            slug.push('-');
        }
    }
    let slug: String = slug.chars().take(60).collect();
    let slug = slug.trim_end_matches('-');
    if slug.is_empty() {
        name.to_string()
    } else {
        slug.to_string()
    }
}

/// Names the workspace's sandbox after the workspace (Claude's name, or the user's), once it
/// has one. Quiet: a name is cosmetic.
pub fn sync_name(workspace: &str) {
    let Ok((w, _)) = find_workspace(workspace) else {
        return;
    };
    if w.boat.is_none() {
        return;
    }
    if let Some(m) = load(workspace).filter(|m| !m.id.is_empty()) {
        let _ = boat(
            &["rename", &m.id, &sandbox_name(&w.name)],
            org_of(&w).as_deref(),
        );
    }
}

/// Pushes Boat's auto-stop back to `STAY_ON_HOURS` from now: ssh does not count as activity.
fn stay_on(id: &str, org: Option<&str>) {
    let _ = boat(&["extend", id, "--hours", STAY_ON_HOURS], org);
}

/// `logit --boat-setup <workspace>`: the sandbox, the checkout, the project's setup script.
/// Safe to run again: a ready sandbox returns at once, a made one is reused.
pub fn setup(workspace: &str) -> i32 {
    match make(workspace) {
        Ok(()) => {
            println!("boat: ready");
            0
        }
        Err(e) => {
            eprintln!("boat: {e}");
            let mut m = load(workspace).unwrap_or_default();
            m.error = Some(e);
            m.ready = false;
            let _ = save(workspace, &m);
            1
        }
    }
}

fn make(workspace: &str) -> Result<(), String> {
    let (w, project) = find_workspace(workspace)?;
    let org = org_of(&w);
    let mut m = load(workspace).unwrap_or_default();
    if m.ready && !m.id.is_empty() {
        return Ok(());
    }
    m.error = None;
    if m.id.is_empty() {
        println!("boat: creating a sandbox…");
        let bridge = data_dir().join("boat").join("bridge.py");
        std::fs::create_dir_all(bridge.parent().unwrap_or(Path::new("/")))
            .and_then(|_| std::fs::write(&bridge, BRIDGE))
            .map_err(|e| e.to_string())?;
        let file = format!("{BRIDGE_PATH}={}", bridge.display());
        let name = sandbox_name(&w.name);
        let mut new = vec!["new", "--name", &name, "--file", &file];
        // No org is the user's own wallet, even when Boat's active org is another one.
        if org.is_none() {
            new.push("--personal");
        }
        let created = boat(&new, org.as_deref())?;
        m.id = sandbox_id(&created).ok_or("Boat did not give the new sandbox's id")?;
        save(workspace, &m)?;
        println!("boat: sandbox {}", m.id);
    } else {
        wake(&m.id, org.as_deref())?;
    }
    stay_on(&m.id, org.as_deref());
    // Claude may have named the workspace and its branch meanwhile: take the latest names.
    sync_name(workspace);
    let (w, _) = find_workspace(workspace)?;
    let origin = git_out(&w.path, &["remote", "get-url", "origin"])
        .map_err(|_| "the project has no `origin` remote to clone in the sandbox".to_string())?;
    println!("boat: checking out {} in the sandbox…", w.branch);
    ssh_shown(
        &m.id,
        &clone_command(origin.trim(), &w.branch, &w.base),
        None,
    )?;
    let script = data_dir()
        .join("projects")
        .join(&project.id)
        .join("setup.sh");
    if script.exists() {
        println!("boat: running the project's setup script…");
        ssh_shown(&m.id, &format!("cd {REPO} && bash -s"), Some(&script))?;
    }
    m.ready = true;
    save(workspace, &m)
}

fn git_out(cwd: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("PATH", tool_path())
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().into())
    }
}

/// Whether Boat calls this sandbox state stopped (resume it before use).
fn is_stopped(state: &str) -> bool {
    matches!(state, "stopped" | "stopping" | "archived" | "archiving")
}

/// Resumes the sandbox when it is stopped.
fn wake(id: &str, org: Option<&str>) -> Result<(), String> {
    let info = boat(&["info", id], org)?;
    let state = info["state"]
        .as_str()
        .or(info["sandbox"]["state"].as_str())
        .unwrap_or("");
    if is_stopped(state) {
        boat(&["resume", id], org)?;
    }
    Ok(())
}

/// Socket and file names keep to the chat id's safe characters.
fn safe(id: &str) -> String {
    id.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect()
}

fn socket_of(chat: &str) -> String {
    format!("/tmp/logit-mcp-{}.sock", safe(chat))
}

/// The shell line that runs Claude in the sandbox's checkout with `args`, its logit MCP the
/// bridge to this chat's socket.
pub fn remote_claude(chat: &str, args: &[String]) -> String {
    let config = serde_json::json!({
        "mcpServers": { "logit": { "command": "python3", "args": [BRIDGE_PATH, socket_of(chat)] } }
    });
    let mut line = format!(
        "export PATH=\"$HOME/.local/bin:$HOME/.bun/bin:$HOME/.npm-global/bin:$PATH\"; cd {REPO} && exec env CLAUDE_CODE_ENTRYPOINT=logit CLAUDE_CODE_ARTIFACT=1 CLAUDE_CODE_ARTIFACT_AUTO_OPEN=0 claude"
    );
    for arg in args {
        line.push(' ');
        line.push_str(&sh_quote(arg));
    }
    line.push_str(" --mcp-config ");
    line.push_str(&sh_quote(&config.to_string()));
    line.push_str(" --allowedTools mcp__logit");
    line
}

/// Waits for `--boat-setup` to have made the sandbox (it may still be running).
fn wait_ready(workspace: &str, within: Duration) -> Result<Machine, String> {
    let start = Instant::now();
    loop {
        match load(workspace) {
            Some(m) if m.ready => return Ok(m),
            Some(Machine { error: Some(e), .. }) => {
                return Err(format!("the sandbox is not ready: {e}"))
            }
            _ if start.elapsed() > within => {
                return Err("the sandbox is still not ready: see the Setup tab".into())
            }
            _ => std::thread::sleep(Duration::from_secs(1)),
        }
    }
}

/// Copies `from` into `to` until either side closes.
fn pump(mut from: impl Read + Send + 'static, mut to: impl Write + Send + 'static) {
    std::thread::spawn(move || {
        let mut buf = [0u8; 65536];
        while let Ok(n) = from.read(&mut buf) {
            if n == 0 || to.write_all(&buf[..n]).and_then(|_| to.flush()).is_err() {
                break;
            }
        }
    });
}

/// logit's MCP for this chat, answered here in the local worktree, reached from the sandbox
/// through the bridge's socket: `boat ssh … bridge.py serve` piped into `logit --mcp`.
fn mcp_relay(id: &str, chat: &str, cwd: &str) -> Result<(Child, Child), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut remote = command()
        .args([
            "ssh",
            id,
            "--",
            &format!("python3 {BRIDGE_PATH} serve {}", socket_of(chat)),
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("boat: {e}"))?;
    let mut local = Command::new(exe)
        .args(["--mcp", chat])
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("logit --mcp: {e}"))?;
    if let (Some(r_out), Some(l_in), Some(l_out), Some(r_in)) = (
        remote.stdout.take(),
        local.stdin.take(),
        local.stdout.take(),
        remote.stdin.take(),
    ) {
        pump(r_out, l_in);
        pump(l_out, r_in);
    }
    Ok((remote, local))
}

/// After a finished turn: the branch the agent pushed, fast-forwarded into the local worktree,
/// so the git panel and the PR follow.
fn follow_branch(w: &Workspace) {
    if git_out(&w.path, &["fetch", "origin", &w.branch]).is_ok() {
        let _ = git_out(&w.path, &["merge", "--ff-only", "FETCH_HEAD"]);
    }
}

/// `logit --boat-chat <workspace> <chat> -- <claude args>`: Claude in the sandbox, its
/// stream-json on this process' stdio, as if it were `claude` itself.
pub fn chat(workspace: &str, chat: &str, args: Vec<String>) -> i32 {
    match run_chat(workspace, chat, args) {
        Ok(code) => code,
        Err(e) => {
            eprintln!("boat: {e}");
            1
        }
    }
}

fn run_chat(workspace: &str, chat: &str, args: Vec<String>) -> Result<i32, String> {
    let (w, _) = find_workspace(workspace)?;
    let m = wait_ready(workspace, Duration::from_secs(600))?;
    let org = org_of(&w);
    wake(&m.id, org.as_deref())?;
    {
        let (id, org, workspace) = (m.id.clone(), org.clone(), workspace.to_string());
        std::thread::spawn(move || {
            stay_on(&id, org.as_deref());
            sync_name(&workspace);
        });
    }
    let relay = mcp_relay(&m.id, chat, &w.path);
    let mut claude = command()
        .args(["ssh", &m.id, "--", &remote_claude(chat, &args)])
        .stdin(Stdio::inherit())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("boat: {e}"))?;
    if let Some(out) = claude.stdout.take() {
        let mut stdout = std::io::stdout().lock();
        for line in BufReader::new(out).lines().map_while(Result::ok) {
            if writeln!(stdout, "{line}")
                .and_then(|_| stdout.flush())
                .is_err()
            {
                break;
            }
            let finished = line.contains("\"result\"")
                && serde_json::from_str::<Value>(&line).is_ok_and(|v| v["type"] == "result");
            if finished {
                let (w, id, org) = (w.clone(), m.id.clone(), org.clone());
                std::thread::spawn(move || {
                    stay_on(&id, org.as_deref());
                    follow_branch(&w);
                });
            }
        }
    }
    let status = claude.wait().map_err(|e| e.to_string())?;
    if let Ok((mut remote, mut local)) = relay {
        let _ = remote.kill();
        let _ = local.kill();
    }
    Ok(status.code().unwrap_or(1))
}

/// A session's transcript, read from the sandbox (its subagents' are left out).
pub fn transcript(workspace: &str, session_id: &str) -> Result<String, String> {
    let m = load(workspace).ok_or("no sandbox for this workspace")?;
    ssh_output(
        &m.id,
        &format!(
            "cat \"$HOME\"/.claude/projects/*/{}.jsonl",
            safe(session_id)
        ),
    )
}

/// Deletes the sandbox through `run` (Boat's CLI in the app); one already gone is fine.
pub fn delete_with(
    root: &Path,
    run: impl Fn(&[&str]) -> Result<Value, String>,
    workspace: &str,
) -> Result<(), String> {
    if let Some(m) = load_in(root, workspace).filter(|m| !m.id.is_empty()) {
        if let Err(e) = run(&["delete", &m.id, "--yes"]) {
            let gone = e.to_lowercase().contains("not found") || e.contains("404");
            if !gone {
                return Err(e);
            }
        }
    }
    forget_in(root, workspace);
    Ok(())
}

/// Deletes a removed workspace's sandbox, if it has one.
pub fn delete(workspace: &str, org: Option<&str>) -> Result<(), String> {
    delete_with(&data_dir(), |args| boat(args, org), workspace)
}

fn machine_of(workspace_id: &str) -> Result<(Machine, Option<String>), String> {
    let (w, _) = find_workspace(workspace_id)?;
    let m = load(workspace_id)
        .filter(|m| !m.id.is_empty())
        .ok_or("no sandbox yet")?;
    Ok((m, org_of(&w)))
}

/// The Boat tab: the sandbox as Boat describes it, with what it cost so far.
#[tauri::command(async)]
pub fn boat_info(workspace_id: String) -> Result<Value, String> {
    let (m, org) = machine_of(&workspace_id)?;
    let info = boat(&["info", &m.id], org.as_deref())?;
    let usage = boat(&["usage", &m.id], org.as_deref()).unwrap_or(Value::Null);
    Ok(serde_json::json!({
        "id": m.id,
        "ready": m.ready,
        "error": m.error,
        "info": info,
        "usage": usage,
    }))
}

#[tauri::command(async)]
pub fn boat_stop(workspace_id: String) -> Result<(), String> {
    let (m, org) = machine_of(&workspace_id)?;
    boat(&["stop", &m.id], org.as_deref()).map(|_| ())
}

#[tauri::command(async)]
pub fn boat_resume(workspace_id: String) -> Result<(), String> {
    let (m, org) = machine_of(&workspace_id)?;
    boat(&["resume", &m.id], org.as_deref()).map(|_| ())
}

/// The wallets a project can bill its sandboxes to: the user's own, then their organizations.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoatOrg {
    pub id: Option<String>,
    pub name: String,
}

/// The organizations in `boat org list --json`, whatever it wraps them in.
pub fn orgs_of(list: &Value) -> Vec<BoatOrg> {
    let items = list
        .as_array()
        .or(list["orgs"].as_array())
        .or(list["organizations"].as_array())
        .cloned()
        .unwrap_or_default();
    items
        .iter()
        .filter(|o| o["type"] != "personal")
        .filter_map(|o| {
            let id = o["id"].as_str().or(o["slug"].as_str())?;
            let name = o["name"].as_str().unwrap_or(id);
            Some(BoatOrg {
                id: Some(id.into()),
                name: name.into(),
            })
        })
        .collect()
}

#[tauri::command(async)]
pub fn boat_orgs() -> Result<Vec<BoatOrg>, String> {
    let mut orgs = vec![BoatOrg {
        id: None,
        name: "Personal".into(),
    }];
    orgs.extend(orgs_of(&boat(&["org", "list"], None)?));
    Ok(orgs)
}

#[cfg(test)]
mod tests {
    #[test]
    fn sandboxes_are_named_after_their_workspace() {
        use super::sandbox_name;
        assert_eq!(sandbox_name("CSV export: bookings"), "csv-export-bookings");
        assert_eq!(sandbox_name("  Réservations / PDF  "), "réservations-pdf");
        assert_eq!(sandbox_name("amber"), "amber");
        assert_eq!(sandbox_name("—"), "—");
        assert_eq!(sandbox_name(&"a ".repeat(50)).chars().count(), 59);
    }

    use super::*;
    use serde_json::json;

    #[test]
    fn sandbox_id_reads_the_shapes_boat_prints() {
        assert_eq!(
            sandbox_id(&json!({"id": "bx_ab12"})).as_deref(),
            Some("bx_ab12")
        );
        assert_eq!(
            sandbox_id(&json!({"sandbox": {"id": "bx_ab12"}})).as_deref(),
            Some("bx_ab12")
        );
        assert_eq!(
            sandbox_id(&json!({"sandboxes": [{"id": "bx_ab12"}]})).as_deref(),
            Some("bx_ab12")
        );
        assert_eq!(sandbox_id(&json!({"id": "nope"})), None);
    }

    #[test]
    fn sh_quote_survives_quotes() {
        assert_eq!(sh_quote("it's"), r"'it'\''s'");
    }

    #[test]
    fn the_clone_starts_the_branch_from_the_remote_base() {
        let line = clone_command("git@github.com:me/app.git", "logit/amber", "main");
        assert!(line.contains("git clone 'git@github.com:me/app.git' /home/user/repo"));
        assert!(line.contains("git checkout -B 'logit/amber' 'origin/main'"));
        let line = clone_command("o", "b", "origin/dev");
        assert!(line.ends_with("'origin/dev'"));
    }

    #[test]
    fn remote_claude_line_quotes_every_argument() {
        let line = remote_claude("c-1", &["--model".into(), "opus 4".into()]);
        assert!(line.contains("CLAUDE_CODE_ENTRYPOINT=logit"));
        assert!(line.contains("claude '--model' 'opus 4' --mcp-config '{"));
        assert!(line.contains("/tmp/logit-mcp-c-1.sock"));
        assert!(line.ends_with("--allowedTools mcp__logit"));
    }

    #[test]
    fn boat_errors_come_out_of_its_json() {
        let text = r#"{"code":"billing_required","error":"Start the plan.","status":402}"#;
        assert_eq!(boat_error(text), "Start the plan.");
        assert_eq!(boat_error("plain\n"), "plain");
    }

    #[test]
    fn orgs_are_read_from_a_list_or_a_wrapper() {
        let list = json!([{"id": "team_1", "name": "RainPath"}]);
        assert_eq!(orgs_of(&list)[0].name, "RainPath");
        let wrapped = json!({"orgs": [
            {"id": "u1", "name": "Personal", "type": "personal"},
            {"slug": "acme", "type": "org"}
        ]});
        let orgs = orgs_of(&wrapped);
        assert_eq!(orgs.len(), 1);
        assert_eq!(orgs[0].id.as_deref(), Some("acme"));
    }

    #[test]
    fn stopped_states_wake_the_sandbox() {
        assert!(is_stopped("archived"));
        assert!(!is_stopped("idle"));
        assert!(!is_stopped("running"));
    }

    #[test]
    fn deleting_forgets_the_sandbox_even_when_boat_lost_it() {
        let dir = std::env::temp_dir().join(format!("logit-boat-{}", std::process::id()));
        let m = Machine {
            id: "bx_1".into(),
            ready: true,
            error: None,
        };
        save_in(&dir, "ws1", &m).unwrap();
        assert_eq!(load_in(&dir, "ws1"), Some(m));
        delete_with(&dir, |_| Err("sandbox not found".into()), "ws1").unwrap();
        assert_eq!(load_in(&dir, "ws1"), None);
        let other = Machine {
            id: "bx_2".into(),
            ..Default::default()
        };
        save_in(&dir, "ws2", &other).unwrap();
        assert!(delete_with(&dir, |_| Err("network down".into()), "ws2").is_err());
        assert!(load_in(&dir, "ws2").is_some());
        let _ = std::fs::remove_dir_all(dir);
    }
}
