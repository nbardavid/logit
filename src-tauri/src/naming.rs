//! A new workspace named from its first prompt, as the aimux TUI does: one quick headless
//! Claude call gives a title (the sidebar's name) and a `<type>/<subject>` branch. The folder
//! keeps its colour. Any failure leaves the colour name and the `logit/<colour>` branch.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use tauri::State;

use crate::git::tool_path;
use crate::store::{edit, Store, Workspace};

const TIMEOUT: Duration = Duration::from_secs(30);
const BRANCH_TYPES: &[&str] = &[
    "feat", "fix", "refactor", "perf", "docs", "test", "chore", "ci", "style", "build",
];

pub fn naming_prompt(request: &str) -> String {
    let request: String = request.chars().take(8000).collect();
    format!(
        "Name a workspace for the user request below.\n\
         Return exactly two lines and nothing else.\n\
         Line 1 — a sidebar label: 1 or 2 words, at most 24 characters, in the same language as the request. \
         It names the subject itself, the thing being worked on, the way a person would tag the task at a glance: \
         no verb, no article, no preposition (de, du, en, of, the), no filler (fix, add, improve, ticket, page, feature). \
         Keep product and brand names as they are. Capitalise only the first letter, unless it is a proper name.\n\
         Never 3 words or more: shorten to the two words that carry the meaning.\n\
         Good line 1: Google pay, Apple pay, Crypto, Paiement 90j, Recherche rapide, Dark mode, Webhooks\n\
         Bad line 1: Scroll du chat (write Scroll chat), Paiement en 3 fois (write Paiement 3x), Fix login page (write Login)\n\
         Line 2 — a git branch named <type>/<subject>, always in English whatever the language of the request.\n\
         <type> is one of: {}.\n\
         <subject> is 2 to 5 lowercase words joined by hyphens, naming what changes rather than restating the request.\n\
         Example line 2: fix/scroll-drift-on-resize\n\
         No quotes, no labels, no numbering, no markdown, no ending punctuation.\n\n{request}",
        BRANCH_TYPES.join(", ")
    )
}

/// One line of the reply, unwrapped: no markdown, label, list marker or quotes.
fn unwrap_line(line: &str) -> &str {
    let mut s = line.trim().trim_matches('*').trim();
    for label in [
        "Title:", "title:", "Branch:", "branch:", "Line 1:", "Line 2:",
    ] {
        s = s.strip_prefix(label).unwrap_or(s).trim();
    }
    s = s.trim_start_matches(['-', '•', '#']).trim();
    if let Some((n, rest)) = s.split_once(['.', ')']) {
        if !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()) {
            s = rest.trim();
        }
    }
    s.trim_matches(['"', '\'', '`', '“', '”', '«', '»']).trim()
}

/// Short words that never end a label: cut after one, a title would read "Scroll du".
const DANGLING: &[&str] = &[
    "a", "à", "an", "and", "au", "aux", "d'", "de", "des", "du", "en", "et", "for", "in", "l'",
    "la", "le", "les", "of", "on", "pour", "sur", "the", "to", "un", "une", "with",
];

/// 1 or 2 words, at most 24 characters cut at a word, no ending punctuation, never ending on
/// a dangling short word.
pub fn clamp_title(raw: &str) -> Option<String> {
    let mut words: Vec<&str> = raw.split_whitespace().take(2).collect();
    if words.len() == 2 && DANGLING.contains(&words[1].to_lowercase().as_str()) {
        words.pop();
    }
    let mut title = String::new();
    for w in words {
        let next = if title.is_empty() {
            w.to_string()
        } else {
            format!("{title} {w}")
        };
        if next.chars().count() > 24 {
            break;
        }
        title = next;
    }
    let title = title
        .trim_end_matches(['.', '!', '?', ',', ';', ':', '…'])
        .to_string();
    (!title.is_empty()).then_some(title)
}

/// `<type>/<subject>`: a known type, 2 to 5 lowercase ASCII words joined by hyphens.
pub fn clamp_branch(raw: &str) -> Option<String> {
    let (kind, subject) = raw.trim().split_once('/')?;
    let kind = kind.trim().to_lowercase();
    if !BRANCH_TYPES.contains(&kind.as_str()) {
        return None;
    }
    let words: Vec<String> = subject
        .to_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|w| !w.is_empty())
        .take(5)
        .map(String::from)
        .collect();
    (words.len() >= 2).then(|| format!("{kind}/{}", words.join("-")))
}

/// The reply's two lines: the title, and the branch when it is usable.
pub fn parse_naming(reply: &str) -> Option<(String, Option<String>)> {
    let mut lines = reply.lines().map(unwrap_line).filter(|l| !l.is_empty());
    let title = clamp_title(lines.next()?)?;
    Some((title, lines.next().and_then(clamp_branch)))
}

/// `claude -p` on the naming prompt, killed past the timeout.
fn ask_claude(request: &str) -> Option<String> {
    let mut cmd = Command::new("claude");
    cmd.args([
        "-p",
        "--model",
        "haiku",
        "--output-format",
        "text",
        "--no-session-persistence",
        "--strict-mcp-config",
    ])
    .arg(naming_prompt(request))
    // Away from the project: no CLAUDE.md to read for two lines.
    .current_dir(std::env::temp_dir())
    .env("PATH", tool_path())
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::null());
    for (key, _) in std::env::vars() {
        if key == "CLAUDECODE" || key.starts_with("CLAUDE_CODE_") {
            cmd.env_remove(key);
        }
    }
    cmd.env("CLAUDE_CODE_ENTRYPOINT", "logit");
    let mut child = cmd.spawn().ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut out = String::new();
        let _ = stdout.read_to_string(&mut out);
        out
    });
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if start.elapsed() < TIMEOUT => std::thread::sleep(Duration::from_millis(100)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    };
    let out = reader.join().unwrap_or_default();
    status.success().then_some(out)
}

/// The colour a workspace was made with: its folder's name.
pub fn colour_of(w: &Workspace) -> String {
    Path::new(&w.path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Names a fresh workspace from `prompt`. Only one still on its colour name and branch: a
/// rename by the user meanwhile wins. A taken branch leaves the branch as it was.
#[tauri::command(async)]
pub fn workspace_autoname(
    store: State<'_, Store>,
    id: String,
    prompt: String,
) -> Result<Option<Workspace>, String> {
    if prompt.trim().is_empty() || prompt.trim_start().starts_with('/') {
        return Ok(None);
    }
    let Some((title, branch)) = ask_claude(&prompt).as_deref().and_then(parse_naming) else {
        return Ok(None);
    };
    edit(&store, |c| {
        let Some(w) = c.workspaces.iter_mut().find(|w| w.id == id) else {
            return Ok(None);
        };
        let colour = colour_of(w);
        if w.name != colour {
            return Ok(None);
        }
        if let Some(to) = branch {
            let renamed = [format!("logit/{colour}"), format!("aimux/{colour}")]
                .contains(&w.branch)
                && Command::new("git")
                    .args(["branch", "-m", &w.branch, &to])
                    .current_dir(&w.path)
                    .env("PATH", tool_path())
                    .output()
                    .is_ok_and(|o| o.status.success());
            if renamed {
                w.branch = to;
            }
        }
        w.name = title;
        Ok(Some(w.clone()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_two_lines() {
        let reply = "**Title: Paiement 90j**\n- fix/Billing Webhook retries.\n";
        assert_eq!(
            parse_naming(reply),
            Some((
                "Paiement 90j".into(),
                Some("fix/billing-webhook-retries".into())
            ))
        );
    }

    #[test]
    fn keeps_the_title_without_a_usable_branch() {
        assert_eq!(
            parse_naming("Crypto\nwip/whatever-this-is"),
            Some(("Crypto".into(), None))
        );
        assert_eq!(parse_naming("**\n"), None);
    }

    #[test]
    fn clamps_the_title() {
        assert_eq!(
            clamp_title("Recherche rapide des voyages."),
            Some("Recherche rapide".into())
        );
        assert_eq!(clamp_title("Crypto!"), Some("Crypto".into()));
        assert_eq!(clamp_title("Scroll du chat"), Some("Scroll".into()));
        assert_eq!(
            clamp_title("Internationalisation multilingue"),
            Some("Internationalisation".into())
        );
    }

    #[test]
    fn clamps_the_branch() {
        assert_eq!(
            clamp_branch("feat/add-one-two-three-four-five-six"),
            Some("feat/add-one-two-three-four".into())
        );
        assert_eq!(clamp_branch("feat/x"), None);
        assert_eq!(clamp_branch("logit/amber-two"), None);
    }
}
