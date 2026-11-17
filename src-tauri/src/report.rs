//! Where an agent stands, as it last reported it (the MCP `report` tool): one report per
//! workspace, in `<data>/reports/<workspaceId>/report.json` with its screenshots beside it.
//! Written by the MCP process itself (the window may be closed), read by the window.

use std::path::{Path, PathBuf};

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::store;

pub const STATES: [&str; 5] = ["question", "review", "ready", "done", "blocked"];
/// Most characters per text (chars, not bytes), as the tool's schema says them.
pub const MAX_TITLE: usize = 60;
pub const MAX_SUMMARY: usize = 200;
pub const MAX_CONTEXT: usize = 300;
pub const MAX_CHOICE: usize = 120;
const MAX_IMAGES: usize = 16;
const MAX_IMAGE_BYTES: u64 = 4 * 1024 * 1024;
const EXTENSIONS: [&str; 4] = ["png", "jpg", "jpeg", "webp"];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub workspace_id: String,
    pub chat_id: String,
    pub at: u64,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub ticket: Option<String>,
    pub title: String,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub feature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub problem: Option<String>,
    pub choices: Vec<Choice>,
    pub screens: Vec<Screen>,
    pub links: Vec<Link>,
    pub left: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Choice {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub set_aside: Option<String>,
    #[serde(default)]
    pub open: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Screen {
    pub step: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub before: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub after: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub label: String,
    pub url: String,
}

/// The tool's input, before the ids and time are added.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Input {
    state: Option<String>,
    ticket: Option<String>,
    title: Option<String>,
    summary: Option<String>,
    feature: Option<String>,
    problem: Option<String>,
    #[serde(default)]
    choices: Vec<Choice>,
    #[serde(default)]
    screens: Vec<Screen>,
    #[serde(default)]
    links: Vec<Link>,
    #[serde(default)]
    left: Vec<String>,
}

fn reports_dir(root: &Path) -> PathBuf {
    root.join("reports")
}

fn folder(root: &Path, workspace: &str) -> Result<PathBuf, String> {
    if workspace.is_empty() || workspace.contains(['/', '\\']) || workspace.starts_with('.') {
        return Err(format!("bad workspace id {workspace}"));
    }
    Ok(reports_dir(root).join(workspace))
}

fn required(value: Option<String>, field: &str) -> Result<String, String> {
    match value.map(|v| v.trim().to_string()) {
        Some(v) if !v.is_empty() => Ok(v),
        _ => Err(format!("`{field}` is required and must not be empty")),
    }
}

/// A text the user reads at a glance: at most `max` characters, or an error saying how to
/// shorten it.
fn short(text: &str, field: &str, max: usize, how: &str) -> Result<(), String> {
    let n = text.chars().count();
    if n > max {
        return Err(format!("`{field}` is {n} characters, at most {max}: {how}"));
    }
    Ok(())
}

/// A link the window may open: http or https only.
fn web_url(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    ["https://", "http://"]
        .iter()
        .any(|p| lower.starts_with(p) && lower.len() > p.len())
}

/// An image the agent named: resolved against the worktree, checked, its extension.
fn image(worktree: &Path, path: &str, what: &str) -> Result<(PathBuf, String), String> {
    let p = Path::new(path.trim());
    let p = if p.is_absolute() {
        p.to_path_buf()
    } else {
        worktree.join(p)
    };
    let ext = p
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!(
            "{what}: {} must be a {} file",
            p.display(),
            EXTENSIONS.join(", ")
        ));
    }
    let meta = std::fs::metadata(&p).map_err(|_| {
        format!(
            "{what}: no file at {} (take the screenshot first, or fix the path)",
            p.display()
        )
    })?;
    if !meta.is_file() {
        return Err(format!("{what}: {} is not a file", p.display()));
    }
    if meta.len() > MAX_IMAGE_BYTES {
        return Err(format!(
            "{what}: {} is {} KB, at most 4 MB (crop it or save a jpg)",
            p.display(),
            meta.len() / 1024
        ));
    }
    Ok((p, ext))
}

/// Validates the tool's arguments and stores them as the workspace's report, replacing the
/// previous one and its images. Returns a short confirmation.
pub fn save(
    root: &Path,
    workspace_id: &str,
    chat_id: &str,
    worktree: &Path,
    args: &Value,
    at: u64,
) -> Result<String, String> {
    let input: Input = serde_json::from_value(args.clone()).map_err(|e| {
        format!("bad arguments: {e} (choices are {{text, setAside?, open?}}, screens {{step, before?, after?}}, links {{label, url}}, left strings)")
    })?;
    let state = required(input.state, "state")?;
    if !STATES.contains(&state.as_str()) {
        return Err(format!(
            "`state` must be one of {}, not {state}",
            STATES.join(", ")
        ));
    }
    let title = required(input.title, "title")?;
    let summary = required(input.summary, "summary")?;
    let optional = |v: Option<String>| v.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
    let feature = optional(input.feature);
    let problem = optional(input.problem);
    short(
        &title,
        "title",
        MAX_TITLE,
        "name the work in a few words, the details go in summary",
    )?;
    short(
        &summary,
        "summary",
        MAX_SUMMARY,
        "keep the one sentence that matters (the question, or what changed)",
    )?;
    for (field, text) in [("feature", &feature), ("problem", &problem)] {
        if let Some(text) = text {
            short(
                text,
                field,
                MAX_CONTEXT,
                "two or three short lines, one concrete case rather than every detail",
            )?;
        }
    }
    for (i, c) in input.choices.iter().enumerate() {
        if c.text.trim().is_empty() {
            return Err(format!("choices[{i}].text must not be empty"));
        }
        short(
            c.text.trim(),
            &format!("choices[{i}].text"),
            MAX_CHOICE,
            "say what the person sees in one line, not how it is built",
        )?;
    }
    let open = input.choices.iter().filter(|c| c.open).count();
    if open > 1 {
        return Err(format!(
            "{open} choices are open, at most one: ask one question at a time, the others are choices you made"
        ));
    }
    if open == 1 && state != "question" {
        return Err(format!(
            "an open choice is a question to the user: set `state` to question, or make the choice and set `open` to false (state is {state})"
        ));
    }
    for (i, l) in input.links.iter().enumerate() {
        if l.url.trim().is_empty() || l.label.trim().is_empty() {
            return Err(format!("links[{i}] needs a label and a url"));
        }
        if !web_url(&l.url) {
            return Err(format!(
                "links[{i}].url must be an http or https URL, not {}",
                l.url.trim()
            ));
        }
    }
    let count: usize = input
        .screens
        .iter()
        .map(|s| s.before.is_some() as usize + s.after.is_some() as usize)
        .sum();
    if count > MAX_IMAGES {
        return Err(format!(
            "{count} images, at most {MAX_IMAGES}: keep the screens that matter"
        ));
    }
    // Check every image before touching the previous report.
    let mut copies = Vec::new();
    let mut screens = Vec::new();
    for (i, s) in input.screens.iter().enumerate() {
        if s.step.trim().is_empty() {
            return Err(format!("screens[{i}].step must not be empty"));
        }
        let mut stored = Screen {
            step: s.step.trim().to_string(),
            before: None,
            after: None,
        };
        for (side, path, slot) in [
            ("before", &s.before, &mut stored.before),
            ("after", &s.after, &mut stored.after),
        ] {
            if let Some(path) = path {
                let (src, ext) = image(worktree, path, &format!("screens[{i}].{side}"))?;
                let name = format!("{i}-{side}.{ext}");
                copies.push((src, name.clone()));
                *slot = Some(name);
            }
        }
        screens.push(stored);
    }
    let report = Report {
        workspace_id: workspace_id.to_string(),
        chat_id: chat_id.to_string(),
        at,
        state: state.clone(),
        ticket: input
            .ticket
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty()),
        title,
        summary,
        feature,
        problem,
        choices: input
            .choices
            .into_iter()
            .map(|c| Choice {
                text: c.text.trim().to_string(),
                ..c
            })
            .collect(),
        screens,
        links: input
            .links
            .into_iter()
            .map(|l| Link {
                label: l.label.trim().to_string(),
                url: l.url.trim().to_string(),
            })
            .collect(),
        left: input.left,
    };
    // Build the new folder aside, then swap it in.
    let dir = folder(root, workspace_id)?;
    let fresh = dir.with_extension(format!("new.{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&fresh);
    std::fs::create_dir_all(&fresh).map_err(|e| e.to_string())?;
    let built = (|| {
        for (src, name) in &copies {
            std::fs::copy(src, fresh.join(name))
                .map_err(|e| format!("copying {}: {e}", src.display()))?;
        }
        let text = serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?;
        store::write_atomic(&fresh.join("report.json"), &text)
    })();
    if let Err(e) = built {
        let _ = std::fs::remove_dir_all(&fresh);
        return Err(e);
    }
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::rename(&fresh, &dir).map_err(|e| e.to_string())?;
    Ok(format!(
        "Reported ({state}, {} screens): the user sees it in logit. A new report replaces this one.",
        report.screens.len()
    ))
}

/// The stored report, images as stored file names.
pub fn load(root: &Path, workspace_id: &str) -> Option<Report> {
    let text =
        std::fs::read_to_string(folder(root, workspace_id).ok()?.join("report.json")).ok()?;
    serde_json::from_str(&text).ok()
}

/// The report with its images inlined as `data:` URLs (a missing one is dropped).
pub fn load_inline(root: &Path, workspace_id: &str) -> Option<Report> {
    let mut report = load(root, workspace_id)?;
    let dir = folder(root, workspace_id).ok()?;
    for s in &mut report.screens {
        for slot in [&mut s.before, &mut s.after] {
            *slot = slot.take().and_then(|name| data_url(&dir.join(name)));
        }
    }
    Some(report)
}

fn data_url(path: &Path) -> Option<String> {
    let mime = match path.extension()?.to_str()? {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => return None,
    };
    let bytes = std::fs::read(path).ok()?;
    Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

/// Every workspace's report, without images, newest first.
pub fn list(root: &Path) -> Vec<Report> {
    let Ok(entries) = std::fs::read_dir(reports_dir(root)) else {
        return Vec::new();
    };
    let mut reports: Vec<Report> = entries
        .flatten()
        .filter_map(|e| load(root, &e.file_name().to_string_lossy()))
        .map(|mut r| {
            for s in &mut r.screens {
                s.before = None;
                s.after = None;
            }
            r
        })
        .collect();
    reports.sort_by(|a, b| b.at.cmp(&a.at));
    reports
}

/// Drops a workspace's report, if any.
pub fn remove(root: &Path, workspace_id: &str) {
    if let Ok(dir) = folder(root, workspace_id) {
        let _ = std::fs::remove_dir_all(dir);
    }
}

#[tauri::command(async)]
pub fn report_get(workspace: String) -> Option<Report> {
    load_inline(&store::data_dir(), &workspace)
}

#[tauri::command(async)]
pub fn report_list() -> Vec<Report> {
    list(&store::data_dir())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("logit-report-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn valid(screens: Value) -> Value {
        json!({
            "state": "review", "ticket": "#335", "title": "Sidebar badges",
            "summary": "Badges now show unread counts.", "feature": "The sidebar.",
            "problem": "You miss replies.",
            "choices": [{ "text": "Count up to 99", "setAside": "No cap" }, { "text": "Grey when zero" }],
            "screens": screens,
            "links": [{ "label": "PR", "url": "https://x/pr/1" }], "left": ["merge"],
        })
    }

    #[test]
    fn a_valid_report_round_trips_with_relative_paths_and_data_urls() {
        let root = temp("round");
        let wt = root.join("wt");
        std::fs::create_dir_all(wt.join("shots")).unwrap();
        std::fs::write(wt.join("shots/a.png"), b"png!").unwrap();
        std::fs::write(root.join("b.JPG"), b"jpg!").unwrap();
        let abs = root.join("b.JPG").to_string_lossy().to_string();
        let args = valid(json!([{ "step": "Open", "before": "shots/a.png", "after": abs }]));
        save(&root, "w1", "c1", &wt, &args, 42).unwrap();
        let stored = load(&root, "w1").unwrap();
        assert_eq!(stored.screens[0].before.as_deref(), Some("0-before.png"));
        assert_eq!(stored.screens[0].after.as_deref(), Some("0-after.jpg"));
        let r = load_inline(&root, "w1").unwrap();
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["workspaceId"], "w1");
        assert_eq!(v["chatId"], "c1");
        assert_eq!(v["at"], 42);
        assert_eq!(v["choices"][0]["setAside"], "No cap");
        assert_eq!(v["choices"][1]["open"], false);
        assert_eq!(v["screens"][0]["before"], "data:image/png;base64,cG5nIQ==");
        assert_eq!(v["screens"][0]["after"], "data:image/jpeg;base64,anBnIQ==");
        let listed = serde_json::to_value(list(&root)).unwrap();
        assert_eq!(listed[0]["screens"][0], json!({ "step": "Open" }));
        remove(&root, "w1");
        assert!(load(&root, "w1").is_none());
    }

    #[test]
    fn a_new_report_replaces_the_old_images() {
        let root = temp("replace");
        std::fs::write(root.join("a.png"), b"x").unwrap();
        save(
            &root,
            "w",
            "c",
            &root,
            &valid(json!([{ "step": "s", "before": "a.png" }])),
            1,
        )
        .unwrap();
        assert!(root.join("reports/w/0-before.png").exists());
        save(&root, "w", "c", &root, &valid(json!([])), 2).unwrap();
        assert!(!root.join("reports/w/0-before.png").exists());
        assert_eq!(load(&root, "w").unwrap().at, 2);
    }

    #[test]
    fn bad_input_says_what_to_fix() {
        let root = temp("bad");
        std::fs::write(root.join("a.gif"), b"x").unwrap();
        std::fs::write(root.join("big.png"), vec![0u8; 4 * 1024 * 1024 + 1]).unwrap();
        std::fs::write(root.join("ok.png"), b"x").unwrap();
        let err = |args: Value| save(&root, "w", "c", &root, &args, 0).unwrap_err();
        let mut a = valid(json!([]));
        a["title"] = json!(" ");
        assert!(err(a).contains("`title`"));
        let mut a = valid(json!([]));
        a["state"] = json!("finished");
        assert!(err(a).contains("must be one of"));
        assert!(err(valid(json!([{ "step": "s", "before": "nope.png" }]))).contains("no file"));
        assert!(err(valid(json!([{ "step": "s", "before": "a.gif" }]))).contains("png, jpg"));
        assert!(err(valid(json!([{ "step": "s", "after": "big.png" }]))).contains("4 MB"));
        let many: Vec<Value> = (0..9)
            .map(|_| json!({ "step": "s", "before": "ok.png", "after": "ok.png" }))
            .collect();
        assert!(err(valid(json!(many))).contains("at most 16"));
        assert!(load(&root, "w").is_none());
    }

    #[test]
    fn feature_and_problem_are_optional_and_done_is_a_state() {
        let root = temp("optional");
        let mut a = valid(json!([]));
        let o = a.as_object_mut().unwrap();
        o.remove("feature");
        o.remove("problem");
        a["state"] = json!("done");
        save(&root, "w", "c", &root, &a, 1).unwrap();
        let v = serde_json::to_value(load(&root, "w").unwrap()).unwrap();
        assert_eq!(v["state"], "done");
        assert!(v.get("feature").is_none() && v.get("problem").is_none());
    }

    #[test]
    fn texts_are_counted_in_characters_and_capped() {
        let root = temp("limits");
        let err = |args: Value| save(&root, "w", "c", &root, &args, 0).unwrap_err();
        // 60 accented letters are 120 bytes but 60 characters: accepted.
        let mut a = valid(json!([]));
        a["title"] = json!("é".repeat(60));
        save(&root, "w", "c", &root, &a, 1).unwrap();
        for (field, max) in [
            ("title", 60),
            ("summary", 200),
            ("feature", 300),
            ("problem", 300),
        ] {
            let mut a = valid(json!([]));
            a[field] = json!("x".repeat(max + 1));
            let e = err(a);
            assert!(
                e.contains(&format!(
                    "`{field}` is {} characters, at most {max}",
                    max + 1
                )),
                "{e}"
            );
        }
        let mut a = valid(json!([]));
        a["choices"][1]["text"] = json!("x".repeat(121));
        assert!(err(a).contains("choices[1].text` is 121 characters, at most 120"));
    }

    #[test]
    fn one_open_choice_and_only_for_a_question() {
        let root = temp("open");
        let err = |args: Value| save(&root, "w", "c", &root, &args, 0).unwrap_err();
        let mut a = valid(json!([]));
        a["choices"][0]["open"] = json!(true);
        assert!(err(a.clone()).contains("set `state` to question"));
        a["state"] = json!("question");
        save(&root, "w", "c", &root, &a, 1).unwrap();
        a["choices"][1]["open"] = json!(true);
        assert!(err(a).contains("at most one"));
    }

    #[test]
    fn links_are_web_urls_only() {
        let root = temp("links");
        let err = |args: Value| save(&root, "w", "c", &root, &args, 0).unwrap_err();
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "not a url",
            "https://",
        ] {
            let mut a = valid(json!([]));
            a["links"][0]["url"] = json!(url);
            assert!(err(a).contains("http or https"), "{url}");
        }
        let mut a = valid(json!([]));
        a["links"][0]["url"] = json!(" HTTP://example.com/x ");
        save(&root, "w", "c", &root, &a, 1).unwrap();
        assert_eq!(
            load(&root, "w").unwrap().links[0].url,
            "HTTP://example.com/x"
        );
    }
}
