//! A workspace's dev servers: what a project declares (`.logit/servers.json` in the repo, else
//! the project's setting in logit), the slot each workspace gets and the ports it gives, and
//! how the host stops only what it started. The host runs them (see `host.rs`).
//!
//! Slot N (1..9) gives every app its base port + N. Slot 0, the base ports themselves, is the
//! developer's own `pnpm dev` and is never used.

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::store;

pub const SLOTS: std::ops::RangeInclusive<u16> = 1..=9;
/// How long an app gets to open its port when the config says nothing.
pub const DEFAULT_TIMEOUT: u64 = 180;
/// How long a stopped process tree gets between SIGTERM and SIGKILL.
const STOP_GRACE: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    /// Run before the apps, one workspace at a time per project (installs, builds).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prepare: Option<String>,
    /// Variables every app and `prepare` get.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub env: BTreeMap<String, String>,
    pub apps: Vec<App>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct App {
    pub name: String,
    pub command: String,
    /// The base port: this app listens on `port + slot`. None: no port, no readiness check.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    /// Values may be empty: an empty variable is set, empty.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub env: BTreeMap<String, String>,
    /// Started only when asked by name.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub optional: bool,
    /// Seconds until a port that never opens counts as failed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout: Option<u64>,
}

impl Config {
    pub fn parse(text: &str) -> Result<Config, String> {
        let config: Config = serde_json::from_str(text).map_err(|e| e.to_string())?;
        let mut seen = HashSet::new();
        for app in &config.apps {
            let ok = !app.name.is_empty()
                && app
                    .name
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
            if !ok {
                return Err(format!(
                    "app name {:?}: use letters, digits, - or _",
                    app.name
                ));
            }
            if !seen.insert(app.name.clone()) {
                return Err(format!("two apps are named {}", app.name));
            }
            if app.command.trim().is_empty() {
                return Err(format!("app {} has no command", app.name));
            }
            if app
                .port
                .is_some_and(|p| p.checked_add(*SLOTS.end()).is_none())
            {
                return Err(format!("app {}: port too high", app.name));
            }
        }
        if config.apps.is_empty() {
            return Err("no apps".into());
        }
        Ok(config)
    }

    pub fn app(&self, name: &str) -> Option<&App> {
        self.apps.iter().find(|a| a.name == name)
    }

    /// The apps `asked` names (each must exist), or every app that is not optional.
    pub fn pick(&self, asked: Option<&[String]>) -> Result<Vec<String>, String> {
        match asked {
            Some(names) if !names.is_empty() => names
                .iter()
                .map(|n| {
                    self.app(n).map(|a| a.name.clone()).ok_or_else(|| {
                        let all: Vec<&str> = self.apps.iter().map(|a| a.name.as_str()).collect();
                        format!("no app {n} (apps: {})", all.join(", "))
                    })
                })
                .collect(),
            _ => Ok(self
                .apps
                .iter()
                .filter(|a| !a.optional)
                .map(|a| a.name.clone())
                .collect()),
        }
    }

    /// Every app's port in `slot`.
    pub fn ports(&self, slot: u16) -> BTreeMap<String, u16> {
        self.apps
            .iter()
            .filter_map(|a| Some((a.name.clone(), a.port? + slot)))
            .collect()
    }
}

pub fn url(port: u16) -> String {
    format!("http://localhost:{port}")
}

/// `name` as an env var suffix: `my-app` gives `MY_APP`.
fn env_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_uppercase()
            } else {
                '_'
            }
        })
        .collect()
}

/// `text` with `${slot}`, `${port}`, `${url}` (this app's), `${port.<app>}` and `${url.<app>}`
/// filled in. `$` alone and `$VAR` pass through for the shell.
pub fn fill(
    text: &str,
    slot: u16,
    ports: &BTreeMap<String, u16>,
    app: Option<&str>,
) -> Result<String, String> {
    let mut out = String::new();
    let mut rest = text;
    while let Some(at) = rest.find("${") {
        out.push_str(&rest[..at]);
        let after = &rest[at + 2..];
        let end = after
            .find('}')
            .ok_or_else(|| format!("unclosed ${{ in {text:?}"))?;
        let key = &after[..end];
        let port_of = |name: &str| {
            ports
                .get(name)
                .copied()
                .ok_or_else(|| format!("${{{key}}}: no app {name} with a port"))
        };
        let own = || app.ok_or_else(|| format!("${{{key}}} only means something in an app"));
        let value = match key.split_once('.') {
            None if key == "slot" => slot.to_string(),
            None if key == "port" => port_of(own()?)?.to_string(),
            None if key == "url" => url(port_of(own()?)?),
            Some(("port", name)) => port_of(name)?.to_string(),
            Some(("url", name)) => url(port_of(name)?),
            // Anything else is the shell's (`${HOME}`), left as written.
            _ => format!("${{{key}}}"),
        };
        out.push_str(&value);
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    Ok(out)
}

/// What `app` (None: `prepare`) runs with in `slot`: LOGIT_SLOT, every app's LOGIT_PORT_<APP>
/// and LOGIT_URL_<APP>, then the config's env, then the app's own.
pub fn env_for(
    config: &Config,
    slot: u16,
    app: Option<&App>,
) -> Result<Vec<(String, String)>, String> {
    let ports = config.ports(slot);
    let mut env: BTreeMap<String, String> = BTreeMap::new();
    env.insert("LOGIT_SLOT".into(), slot.to_string());
    for (name, port) in &ports {
        env.insert(format!("LOGIT_PORT_{}", env_name(name)), port.to_string());
        env.insert(format!("LOGIT_URL_{}", env_name(name)), url(*port));
    }
    let name = app.map(|a| a.name.as_str());
    for (k, v) in &config.env {
        env.insert(k.clone(), fill(v, slot, &ports, name)?);
    }
    if let Some(app) = app {
        for (k, v) in &app.env {
            env.insert(k.clone(), fill(v, slot, &ports, name)?);
        }
    }
    Ok(env.into_iter().collect())
}

// Where the config lives.

pub fn repo_path(worktree: &str) -> PathBuf {
    Path::new(worktree).join(".logit/servers.json")
}

pub fn project_path(project_id: &str) -> Result<PathBuf, String> {
    Ok(store::project_dir(project_id)?.join("servers.json"))
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    Repo,
    Project,
}

/// The config a workspace runs with: the repo's file wins over the project's setting.
/// Ok(None) when neither exists.
pub fn load(project_id: &str, worktree: &str) -> Result<Option<(Config, Source)>, String> {
    for (path, source) in [
        (repo_path(worktree), Source::Repo),
        (project_path(project_id)?, Source::Project),
    ] {
        match std::fs::read_to_string(&path) {
            Ok(text) => {
                return Config::parse(&text)
                    .map(|c| Some((c, source)))
                    .map_err(|e| format!("{}: {e}", path.display()))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(format!("{}: {e}", path.display())),
        }
    }
    Ok(None)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigFiles {
    /// The project's setting, "" when unset.
    pub project: String,
    /// The repo's file in this worktree, when there is one: it wins.
    pub repo: Option<String>,
    pub repo_path: String,
}

/// The servers a project declares, both places, for Settings and the dock.
#[tauri::command]
pub fn servers_config(project_id: String, cwd: String) -> Result<ConfigFiles, String> {
    let read = |p: PathBuf| match std::fs::read_to_string(&p) {
        Ok(t) => Ok(Some(t)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    };
    let repo = repo_path(&cwd);
    Ok(ConfigFiles {
        project: read(project_path(&project_id)?)?.unwrap_or_default(),
        repo: read(repo.clone())?,
        repo_path: repo.to_string_lossy().into_owned(),
    })
}

/// Saves the project's setting, once it parses; "" removes it.
#[tauri::command]
pub fn set_servers_config(project_id: String, text: String) -> Result<(), String> {
    let path = project_path(&project_id)?;
    if text.trim().is_empty() {
        return match std::fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        };
    }
    Config::parse(&text)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    store::write_atomic(&path, &text)
}

// Ports and processes.

/// Whether something listens on `port`, on 127.0.0.1 or ::1.
pub fn port_busy(port: u16) -> bool {
    use std::net::{Ipv6Addr, SocketAddr, TcpStream};
    let wait = Duration::from_millis(300);
    [
        SocketAddr::from(([127, 0, 0, 1], port)),
        SocketAddr::from((Ipv6Addr::LOCALHOST, port)),
    ]
    .iter()
    .any(|a| TcpStream::connect_timeout(a, wait).is_ok())
}

/// `root` and every process descending from it, from one `ps` snapshot.
pub fn tree(root: u32) -> Vec<u32> {
    let out = std::process::Command::new("ps")
        .args(["-A", "-o", "pid=,ppid="])
        .output();
    let Ok(out) = out else {
        return vec![root];
    };
    let pairs: Vec<(u32, u32)> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| {
            let mut it = l.split_whitespace().map(|n| n.parse::<u32>().ok());
            Some((it.next()??, it.next()??))
        })
        .collect();
    let mut found = vec![root];
    let mut i = 0;
    while i < found.len() {
        let parent = found[i];
        found.extend(
            pairs
                .iter()
                .filter(|(_, pp)| *pp == parent)
                .map(|(p, _)| *p),
        );
        i += 1;
    }
    found
}

fn signal(pid: u32, sig: &str) {
    let _ = std::process::Command::new("kill")
        .args([sig, &pid.to_string()])
        .stderr(std::process::Stdio::null())
        .status();
}

fn alive(pid: u32) -> bool {
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

/// Stops the process trees under `roots` (processes the host spawned): SIGTERM, then SIGKILL
/// for what still runs after the grace period. Nothing outside those trees is touched.
pub fn stop_trees(roots: &[u32]) {
    let pids: Vec<u32> = roots.iter().flat_map(|r| tree(*r)).collect();
    for pid in &pids {
        signal(*pid, "-TERM");
    }
    let deadline = Instant::now() + STOP_GRACE;
    while Instant::now() < deadline && pids.iter().any(|p| alive(*p)) {
        std::thread::sleep(Duration::from_millis(250));
    }
    for pid in pids.iter().filter(|p| alive(**p)) {
        signal(*pid, "-KILL");
    }
}

/// The last `n` lines of terminal output, its colours and cursor moves taken out.
pub fn tail(text: &str, n: usize) -> String {
    let plain = strip_ansi(text);
    let lines: Vec<&str> = plain
        .lines()
        .map(|l| l.rsplit('\r').next().unwrap_or(l))
        .filter(|l| !l.trim().is_empty())
        .collect();
    lines[lines.len().saturating_sub(n)..].join("\n")
}

fn strip_ansi(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            out.push(c);
            continue;
        }
        match chars.next() {
            // CSI: up to a final byte in @..~
            Some('[') => {
                for c in chars.by_ref() {
                    if ('@'..='~').contains(&c) {
                        break;
                    }
                }
            }
            // OSC: up to BEL or ESC \
            Some(']') => {
                while let Some(c) = chars.next() {
                    if c == '\u{7}' {
                        break;
                    }
                    if c == '\u{1b}' {
                        chars.next();
                        break;
                    }
                }
            }
            _ => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const MASSILIA: &str = r#"{
      "env": { "COREPACK_ENABLE_DOWNLOAD_PROMPT": "0" },
      "apps": [
        { "name": "server", "port": 3400, "command": "pnpm dev",
          "env": { "PORT": "${port}", "WORDPRESS_APP_PASSWORD": "", "BO_CORS_ORIGIN": "${url.bo}" } },
        { "name": "web", "port": 5200, "optional": true, "command": "vite --port ${port} --strictPort" },
        { "name": "bo", "port": 5300, "optional": true, "command": "vite --port ${port}",
          "env": { "VITE_API_URL": "${url.server}" } }
      ]
    }"#;

    #[test]
    fn ports_are_base_plus_slot() {
        let c = Config::parse(MASSILIA).unwrap();
        let p = c.ports(2);
        assert_eq!(p["server"], 3402);
        assert_eq!(p["web"], 5202);
        assert_eq!(p["bo"], 5302);
    }

    #[test]
    fn env_fills_ports_and_keeps_empty_values() {
        let c = Config::parse(MASSILIA).unwrap();
        let env: BTreeMap<_, _> = env_for(&c, 3, c.app("server"))
            .unwrap()
            .into_iter()
            .collect();
        assert_eq!(env["LOGIT_SLOT"], "3");
        assert_eq!(env["LOGIT_PORT_SERVER"], "3403");
        assert_eq!(env["LOGIT_URL_BO"], "http://localhost:5303");
        assert_eq!(env["PORT"], "3403");
        assert_eq!(env["BO_CORS_ORIGIN"], "http://localhost:5303");
        assert_eq!(env["WORDPRESS_APP_PASSWORD"], "");
        assert_eq!(env["COREPACK_ENABLE_DOWNLOAD_PROMPT"], "0");
        let bo: BTreeMap<_, _> = env_for(&c, 3, c.app("bo")).unwrap().into_iter().collect();
        assert_eq!(bo["VITE_API_URL"], "http://localhost:3403");
    }

    #[test]
    fn fill_leaves_shell_variables_alone() {
        let p = BTreeMap::from([("web".to_string(), 5201)]);
        assert_eq!(
            fill("x ${port} $HOME ${HOME} ${slot}", 1, &p, Some("web")).unwrap(),
            "x 5201 $HOME ${HOME} 1"
        );
        assert!(fill("${url.nope}", 1, &p, None).is_err());
        assert!(fill("${port}", 1, &p, None).is_err());
    }

    #[test]
    fn pick_defaults_to_the_apps_not_optional() {
        let c = Config::parse(MASSILIA).unwrap();
        assert_eq!(c.pick(None).unwrap(), ["server"]);
        assert_eq!(c.pick(Some(&["bo".into()])).unwrap(), ["bo"]);
        assert!(c.pick(Some(&["nope".into()])).is_err());
    }

    #[test]
    fn parse_refuses_bad_configs() {
        assert!(Config::parse(r#"{"apps":[]}"#).is_err());
        assert!(Config::parse(r#"{"apps":[{"name":"a b","command":"x"}]}"#).is_err());
        assert!(Config::parse(
            r#"{"apps":[{"name":"a","command":"x"},{"name":"a","command":"y"}]}"#
        )
        .is_err());
        assert!(Config::parse(r#"{"apps":[{"name":"a","command":"x","prot":1}]}"#).is_err());
    }

    #[test]
    fn tail_strips_colours() {
        assert_eq!(tail("a\n\u{1b}[31mred\u{1b}[0m\nb\r\n\nc", 2), "b\nc");
        assert_eq!(tail("\u{1b}]0;title\u{7}x", 5), "x");
    }

    #[test]
    fn stop_trees_ends_a_child_and_its_children() {
        let mut child = std::process::Command::new("sh")
            .args(["-c", "sleep 30 & sleep 30; wait"])
            .spawn()
            .unwrap();
        std::thread::sleep(Duration::from_millis(200));
        let kids = tree(child.id());
        assert!(kids.len() >= 2, "{kids:?}");
        stop_trees(&[child.id()]);
        let _ = child.wait();
        assert!(kids.iter().all(|p| !alive(*p)));
    }
}
