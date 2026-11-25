//! Git and gh reads for the git panel (writes live in `git_write`). Fixed argument lists: the
//! webview names a workspace path and a file, never a git subcommand.

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

#[derive(Debug, PartialEq, Serialize)]
pub struct FileChange {
    pub path: String,
    pub status: char,
    pub untracked: bool,
    /// Something of it sits in the index (`git commit` would take it).
    pub staged: bool,
    /// Something of it differs from the index in the working tree.
    pub unstaged: bool,
    pub add: Option<u32>,
    pub del: Option<u32>,
}

pub struct Entry {
    pub status: char,
    pub untracked: bool,
    pub staged: bool,
    pub unstaged: bool,
    pub path: String,
}

/// `git status --porcelain=v1 -z`: `XY path\0`, plus `orig\0` after a rename or copy.
/// X is the index side, Y the working tree side.
pub fn parse_porcelain(raw: &str) -> Vec<Entry> {
    let mut out = Vec::new();
    let mut fields = raw.split('\0').filter(|f| !f.is_empty());
    while let Some(entry) = fields.next() {
        if entry.len() < 4 {
            continue;
        }
        let mut chars = entry.chars();
        let (x, y) = (chars.next().unwrap_or(' '), chars.next().unwrap_or(' '));
        let path = entry[3..].to_string();
        if matches!(x, 'R' | 'C') {
            fields.next();
        }
        let untracked = x == '?';
        out.push(Entry {
            path,
            staged: !untracked && x != ' ',
            status: if untracked {
                'A'
            } else if x != ' ' {
                x
            } else {
                y
            },
            unstaged: !untracked && y != ' ',
            untracked,
        });
    }
    out
}

/// `git diff --numstat -z`: `add\tdel\tpath\0`, or `add\tdel\t\0old\0new\0` for a rename.
/// Binary files report `-` and map to `None`.
pub fn parse_numstat(raw: &str) -> HashMap<String, (Option<u32>, Option<u32>)> {
    let mut out = HashMap::new();
    let mut fields = raw.split('\0');
    while let Some(entry) = fields.next() {
        let mut parts = entry.splitn(3, '\t');
        let (Some(add), Some(del), Some(path)) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        let path = if path.is_empty() {
            fields.next();
            fields.next().unwrap_or_default().to_string()
        } else {
            path.to_string()
        };
        out.insert(path, (add.parse().ok(), del.parse().ok()));
    }
    out
}

/// Lines of an untracked file, `None` for binary or large files.
fn count_lines(file: &Path) -> Option<u32> {
    let bytes = std::fs::read(file).ok()?;
    if bytes.len() > 2 * 1024 * 1024 || bytes.contains(&0) {
        return None;
    }
    let newlines = bytes.iter().filter(|&&b| b == b'\n').count() as u32;
    Some(if bytes.last().is_some_and(|&b| b != b'\n') {
        newlines + 1
    } else {
        newlines
    })
}

pub fn tool_path() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let path = std::env::var("PATH").unwrap_or_default();
    // A Finder launch gets a bare PATH: add where bun, claude, git and gh usually live.
    format!("{home}/.bun/bin:{home}/.local/bin:/opt/homebrew/bin:/usr/local/bin:{path}")
}

fn run(program: &str, cwd: &str, args: &[&str]) -> Result<(bool, String), String> {
    let output = Command::new(program)
        .args(args)
        .current_dir(cwd)
        .env("PATH", tool_path())
        .output()
        .map_err(|e| format!("{program}: {e}"))?;
    Ok((
        output.status.success(),
        String::from_utf8_lossy(&output.stdout).into_owned(),
    ))
}

#[tauri::command(async)]
pub fn git_status(path: String) -> Result<Vec<FileChange>, String> {
    let (ok, status) = run(
        "git",
        &path,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?;
    if !ok {
        return Err(format!("{path} is not a git repository"));
    }
    // A repository without commits has no HEAD to diff against: counts stay empty.
    let numstat = run("git", &path, &["diff", "--numstat", "-z", "HEAD"])
        .map(|(_, out)| parse_numstat(&out))?;
    Ok(parse_porcelain(&status)
        .into_iter()
        .map(|e| {
            let (add, del) = if e.untracked {
                (count_lines(&Path::new(&path).join(&e.path)), Some(0))
            } else {
                numstat.get(&e.path).copied().unwrap_or((None, None))
            };
            FileChange {
                add,
                del,
                path: e.path,
                staged: e.staged,
                status: e.status,
                unstaged: e.unstaged,
                untracked: e.untracked,
            }
        })
        .collect())
}

/// How long `gh` may take: past it (a network gone quiet after sleep), it is killed, so the
/// panel's polling never waits on a request that will not answer.
const GH_TIMEOUT: Duration = Duration::from_secs(20);

/// Why a timed command gave no answer.
#[derive(Debug, PartialEq)]
enum Unanswered {
    /// It could not start: the program is not installed (or not on the PATH).
    Missing,
    TimedOut,
}

/// A pipe read to its end on the side: a full pipe would block the child before it exits.
fn drain(pipe: Option<impl Read + Send + 'static>) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut out = String::new();
        if let Some(mut pipe) = pipe {
            let _ = pipe.read_to_string(&mut out);
        }
        out
    })
}

/// A command killed after `limit`: whether it succeeded, its stdout and its stderr.
fn output_within(
    program: &str,
    cwd: &str,
    args: &[&str],
    limit: Duration,
) -> Result<(bool, String, String), Unanswered> {
    let mut child = Command::new(program)
        .args(args)
        .current_dir(cwd)
        .env("PATH", tool_path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| Unanswered::Missing)?;
    let stdout = drain(child.stdout.take());
    let stderr = drain(child.stderr.take());
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if start.elapsed() < limit => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(Unanswered::TimedOut);
            }
        }
    };
    Ok((
        status.success(),
        stdout.join().unwrap_or_default(),
        stderr.join().unwrap_or_default(),
    ))
}

/// `run`, killed after `limit`: `None` when it did not finish or failed to start.
fn run_within(program: &str, cwd: &str, args: &[&str], limit: Duration) -> Option<(bool, String)> {
    output_within(program, cwd, args, limit)
        .ok()
        .map(|(ok, out, _)| (ok, out))
}

/// What the git panel and the PR cards read of a pull request.
const PR_FIELDS: &str = "number,title,state,isDraft,url,additions,deletions,changedFiles,body,\
                         statusCheckRollup,mergeable,mergeStateStatus,baseRefName,headRefName,\
                         reviewDecision";

/// The branch's pull request as `gh` reports it, or `None` without gh or without a PR. An
/// error when gh did not answer in time: the panel keeps what it showed.
#[tauri::command(async)]
pub fn pr_view(path: String) -> Result<Option<String>, String> {
    match run_within(
        "gh",
        &path,
        &["pr", "view", "--json", PR_FIELDS],
        GH_TIMEOUT,
    ) {
        Some((true, out)) => Ok(Some(out)),
        Some((false, _)) => Ok(None),
        None => Err("gh did not answer".into()),
    }
}

/// A GitHub pull request's address, `https://github.com/<owner>/<repo>/pull/<n>` (anything
/// after the number, a `/files` or a `#comment`, dropped), and its `owner/repo`. The webview
/// names a PR only this way: never a flag, never another host.
pub fn pr_address(url: &str) -> Result<(String, String), String> {
    let refuse = || format!("{url} is not a GitHub pull request");
    let rest = url.strip_prefix("https://github.com/").ok_or_else(refuse)?;
    let mut parts = rest.split(['/', '?', '#']);
    let (owner, repo, pull, number) = (parts.next(), parts.next(), parts.next(), parts.next());
    let name = |s: &str| {
        !s.is_empty()
            && !s.starts_with(['-', '.'])
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    };
    match (owner, repo, pull, number) {
        (Some(owner), Some(repo), Some("pull"), Some(n))
            if name(owner)
                && name(repo)
                && !n.is_empty()
                && n.len() <= 9
                && n.chars().all(|c| c.is_ascii_digit()) =>
        {
            Ok((
                format!("https://github.com/{owner}/{repo}/pull/{n}"),
                format!("{owner}/{repo}"),
            ))
        }
        _ => Err(refuse()),
    }
}

/// Where gh runs for a PR named by its address: the workspace, or home when it is gone (gh
/// needs no checkout to read or merge a PR by its URL).
pub fn gh_cwd(path: &str) -> String {
    if !path.is_empty() && Path::new(path).is_dir() {
        return path.to_string();
    }
    std::env::var("HOME").unwrap_or_else(|_| "/".into())
}

/// gh's own words on a failure, its first lines; or what kept it from answering.
pub fn gh_failure(stderr: &str) -> String {
    let message = stderr.trim().lines().take(3).collect::<Vec<_>>().join("\n");
    if message.is_empty() {
        "gh failed without saying why".into()
    } else {
        message
    }
}

pub const GH_MISSING: &str = "gh is not installed: the GitHub CLI reads and merges pull requests.";

/// A pull request named by its address (a link in a chat or a report), as `pr_view` reads the
/// branch's. gh's own error when it fails, so the card can say what to do.
#[tauri::command(async)]
pub fn pr_view_url(path: String, url: String) -> Result<String, String> {
    let (url, _) = pr_address(&url)?;
    let args = ["pr", "view", url.as_str(), "--json", PR_FIELDS];
    match output_within("gh", &gh_cwd(&path), &args, GH_TIMEOUT) {
        Ok((true, out, _)) => Ok(out),
        Ok((false, _, err)) => Err(gh_failure(&err)),
        Err(Unanswered::Missing) => Err(GH_MISSING.into()),
        Err(Unanswered::TimedOut) => Err("gh did not answer in time (network?)".into()),
    }
}

#[derive(Serialize)]
pub struct Branches {
    /// Local branches, most recently committed first, as the TUI lists them.
    branches: Vec<String>,
    /// What a new workspace forks from unless you pick another: the TUI's `getDefaultBranch`.
    default: Option<String>,
}

#[tauri::command(async)]
pub fn git_branches(path: String) -> Result<Branches, String> {
    let (ok, out) = run(
        "git",
        &path,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "refs/heads",
            "--format=%(refname:short)",
        ],
    )?;
    if !ok {
        return Err(format!("{path} is not a git repository"));
    }
    let branches: Vec<String> = out
        .lines()
        .filter(|l| !l.is_empty())
        .map(String::from)
        .collect();
    let origin = match run(
        "git",
        &path,
        &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    ) {
        Ok((true, head)) => {
            let head = head.trim();
            Some(head.strip_prefix("origin/").unwrap_or(head).to_string())
        }
        _ => None,
    };
    let default = origin
        .filter(|b| branches.contains(b))
        .or_else(|| {
            ["main", "master"]
                .iter()
                .map(|b| b.to_string())
                .find(|b| branches.contains(b))
        })
        .or_else(|| branches.first().cloned());
    Ok(Branches { branches, default })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn porcelain_maps_modified_untracked_and_renamed() {
        let raw = " M src/a.ts\0?? new.sh\0R  b.ts\0old-b.ts\0MM both.ts\0";
        let got: Vec<_> = parse_porcelain(raw)
            .into_iter()
            .map(|e| (e.status, e.untracked, e.staged, e.unstaged, e.path))
            .collect();
        assert_eq!(
            got,
            vec![
                ('M', false, false, true, "src/a.ts".to_string()),
                ('A', true, false, false, "new.sh".to_string()),
                ('R', false, true, false, "b.ts".to_string()),
                ('M', false, true, true, "both.ts".to_string()),
            ]
        );
    }

    #[test]
    fn a_command_past_its_limit_is_killed() {
        let started = Instant::now();
        assert_eq!(
            run_within("sleep", "/", &["5"], Duration::from_millis(200)),
            None
        );
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(
            run_within("echo", "/", &["hi"], Duration::from_secs(5)),
            Some((true, "hi\n".to_string()))
        );
    }

    #[test]
    fn a_missing_program_is_told_from_a_slow_one() {
        assert_eq!(
            output_within("no-such-tool-here", "/", &[], Duration::from_secs(1)),
            Err(Unanswered::Missing)
        );
        let (ok, _, err) = output_within(
            "sh",
            "/",
            &["-c", "echo oops >&2; exit 3"],
            Duration::from_secs(5),
        )
        .unwrap();
        assert!(!ok);
        assert_eq!(gh_failure(&err), "oops");
        assert_eq!(gh_failure("  "), "gh failed without saying why");
    }

    #[test]
    fn a_pr_is_named_by_its_github_address_only() {
        let pr = |u: &str| pr_address(u).map(|(url, repo)| format!("{repo} {url}"));
        assert_eq!(
            pr("https://github.com/nbardavid/logit/pull/128").unwrap(),
            "nbardavid/logit https://github.com/nbardavid/logit/pull/128"
        );
        assert_eq!(
            pr("https://github.com/a-b/c.d_e/pull/7/files#diff-1").unwrap(),
            "a-b/c.d_e https://github.com/a-b/c.d_e/pull/7"
        );
        for bad in [
            "https://github.com/o/r/issues/1",
            "https://gitlab.com/o/r/pull/1",
            "http://github.com/o/r/pull/1",
            "https://github.com/o/r/pull/",
            "https://github.com/o/r/pull/1x",
            "https://github.com/-o/r/pull/1",
            "https://github.com/o/../pull/1",
            "--repo=x",
        ] {
            assert!(pr_address(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn numstat_handles_binary_and_renames() {
        let raw = "13\t6\tsrc/a.ts\0-\t-\tdemo.gif\x002\t1\t\0old.ts\0new.ts\0";
        let stats = parse_numstat(raw);
        assert_eq!(stats["src/a.ts"], (Some(13), Some(6)));
        assert_eq!(stats["demo.gif"], (None, None));
        assert_eq!(stats["new.ts"], (Some(2), Some(1)));
    }
}
