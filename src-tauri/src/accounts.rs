//! Claude accounts beside the default one (`~/.claude`). Each lives in its own config folder,
//! which Claude Code takes from `CLAUDE_CONFIG_DIR`: its login goes to a Keychain entry of its
//! own, everything else (settings, skills, plugins, transcripts…) links to `~/.claude`, so only
//! who is signed in changes.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::git::tool_path;
use crate::store::{data_dir, write_atomic};

/// The account that is `~/.claude` itself.
pub const DEFAULT: &str = "default";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    /// Who signed in, from `claude auth status`.
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub plan: String,
}

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
}

fn accounts_file() -> PathBuf {
    data_dir().join("accounts.json")
}

/// `~/.claude`, or the folder the user's own `CLAUDE_CONFIG_DIR` names.
pub fn default_dir() -> PathBuf {
    std::env::var("CLAUDE_CONFIG_DIR")
        .ok()
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join(".claude"))
}

fn valid(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// The config folder of account `id`; None for the default account (and unknown ids).
pub fn config_dir(id: &str) -> Option<PathBuf> {
    (id != DEFAULT && valid(id)).then(|| data_dir().join("accounts").join(id))
}

fn saved() -> Vec<Account> {
    std::fs::read_to_string(accounts_file())
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save(accounts: &[Account]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(accounts).map_err(|e| e.to_string())?;
    write_atomic(&accounts_file(), &json)
}

/// What never links to `~/.claude`: per-account state Claude Code keeps in its folder.
const OWN: [&str; 2] = [".credentials.json", ".claude.json"];

/// Links every entry of `~/.claude` the folder lacks, so a skill or plugin added later shows
/// in every account. Cheap: called before each Claude this account starts.
pub fn link_shared(dir: &Path) {
    link_from(&default_dir(), dir);
}

fn link_from(shared: &Path, dir: &Path) {
    let _ = std::fs::create_dir_all(dir);
    let Ok(entries) = std::fs::read_dir(shared) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        if OWN.iter().any(|o| name == *o) {
            continue;
        }
        let target = dir.join(&name);
        if target.symlink_metadata().is_err() {
            let _ = std::os::unix::fs::symlink(entry.path(), target);
        }
    }
}

/// The user-scope MCP servers of `~/.claude.json`, copied into the account's own state once.
fn seed_state(dir: &Path) {
    let file = dir.join(".claude.json");
    if file.exists() {
        return;
    }
    let servers = std::fs::read_to_string(home().join(".claude.json"))
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .map(|v| v["mcpServers"].clone())
        .filter(|v| v.is_object());
    if let Some(servers) = servers {
        let _ = write_atomic(
            &file,
            &serde_json::json!({ "mcpServers": servers }).to_string(),
        );
    }
}

/// `claude <args>` as account `dir` (None: the default one), waited for.
fn claude(dir: Option<&Path>, args: &[&str]) -> Result<std::process::Output, String> {
    let mut cmd = Command::new("claude");
    cmd.args(args)
        .env("PATH", tool_path())
        .current_dir(home())
        .stdin(Stdio::null());
    for (key, _) in std::env::vars() {
        if key == "CLAUDECODE" || key.starts_with("CLAUDE_CODE_") {
            cmd.env_remove(key);
        }
    }
    if let Some(dir) = dir {
        cmd.env("CLAUDE_CONFIG_DIR", dir);
    }
    cmd.output().map_err(|e| format!("claude: {e}"))
}

/// Who is signed in to `dir`, as (email, plan); None when nobody is.
fn status(dir: Option<&Path>) -> Option<(String, String)> {
    let out = claude(dir, &["auth", "status", "--json"]).ok()?;
    let v: Value = serde_json::from_slice(&out.stdout).ok()?;
    if v["loggedIn"] != true {
        return None;
    }
    let text = |k: &str| v[k].as_str().unwrap_or_default().to_string();
    let plan = if text("planTier").is_empty() {
        text("subscriptionType")
    } else {
        text("planTier")
    };
    Some((text("email"), plan))
}

/// The default account first, then the ones added, each with who is signed in.
#[tauri::command(async)]
pub fn accounts_list() -> Vec<Account> {
    let (email, plan) = status(None).unwrap_or_default();
    let mut all = vec![Account {
        id: DEFAULT.into(),
        email,
        plan,
    }];
    all.extend(saved());
    all
}

/// A new account: Claude Code's own sign-in opens in the browser, and this returns once it
/// finished. Signing in to an account already listed gives that one back.
#[tauri::command(async)]
pub fn account_add() -> Result<Account, String> {
    let id = format!(
        "a{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or_default()
    );
    let dir = config_dir(&id).ok_or("bad account id")?;
    link_shared(&dir);
    seed_state(&dir);
    let out = claude(Some(&dir), &["auth", "login", "--claudeai"])?;
    let Some((email, plan)) = status(Some(&dir)) else {
        let _ = std::fs::remove_dir_all(&dir);
        let why = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if why.is_empty() {
            "Sign-in did not finish.".into()
        } else {
            why
        });
    };
    let mut accounts = saved();
    let default_email = status(None).map(|(e, _)| e).unwrap_or_default();
    if let Some(same) = accounts
        .iter()
        .find(|a| a.email == email)
        .cloned()
        .or_else(|| {
            (email == default_email).then(|| Account {
                id: DEFAULT.into(),
                email: email.clone(),
                plan: plan.clone(),
            })
        })
    {
        let _ = claude(Some(&dir), &["auth", "logout"]);
        let _ = std::fs::remove_dir_all(&dir);
        return Ok(same);
    }
    let account = Account { id, email, plan };
    accounts.push(account.clone());
    save(&accounts)?;
    Ok(account)
}

/// Signs account `id` out and forgets it. The default account stays.
#[tauri::command(async)]
pub fn account_remove(id: String) -> Result<(), String> {
    let dir = config_dir(&id).ok_or("the default account stays")?;
    let _ = claude(Some(&dir), &["auth", "logout"]);
    let _ = std::fs::remove_dir_all(&dir);
    let mut accounts = saved();
    accounts.retain(|a| a.id != id);
    save(&accounts)
}

/// The Keychain entry Claude Code keeps account `id`'s login under: its own name for the
/// default folder, a short hash of the folder's path otherwise.
pub fn keychain_service(id: &str) -> String {
    match config_dir(id) {
        None => "Claude Code-credentials".into(),
        Some(dir) => format!(
            "Claude Code-credentials-{}",
            &sha256_hex(&dir.to_string_lossy())[..8]
        ),
    }
}

fn sha256_hex(text: &str) -> String {
    use std::io::Write;
    let Ok(mut child) = Command::new("shasum")
        .args(["-a", "256"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
    else {
        return "00000000".into();
    };
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(text.as_bytes());
    }
    child
        .wait_with_output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .and_then(|s| s.split_whitespace().next().map(String::from))
        .filter(|h| h.len() >= 8)
        .unwrap_or_else(|| "00000000".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_account_has_no_folder_of_its_own() {
        assert_eq!(config_dir(DEFAULT), None);
        assert_eq!(config_dir("../x"), None);
        assert!(config_dir("a1").unwrap().ends_with("accounts/a1"));
        assert_eq!(keychain_service(DEFAULT), "Claude Code-credentials");
    }

    #[test]
    fn hashes_like_shasum() {
        assert_eq!(
            sha256_hex("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn links_everything_but_the_accounts_own_state() {
        let root = std::env::temp_dir().join(format!("logit-accounts-{}", std::process::id()));
        let shared = root.join("shared");
        std::fs::create_dir_all(shared.join("skills")).unwrap();
        std::fs::write(shared.join("settings.json"), "{}").unwrap();
        std::fs::write(shared.join(".credentials.json"), "{}").unwrap();
        let dir = root.join("acct");
        link_from(&shared, &dir);
        assert!(dir.join("skills").symlink_metadata().unwrap().is_symlink());
        assert!(dir.join("settings.json").exists());
        assert!(!dir.join(".credentials.json").exists());
        let _ = std::fs::remove_dir_all(&root);
    }
}
