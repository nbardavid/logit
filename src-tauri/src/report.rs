//! The page of a workspace's task (the MCP `report` tool): one per workspace, kept from the
//! start of the work to its end and filled in by its agent as it goes, in
//! `<data>/reports/<workspaceId>/report.json` with its images beside it. A call merges into the
//! page: the head fields it gives replace theirs, each section it gives replaces that section,
//! the rest stays. Written by the MCP process itself (the window may be closed), read by the
//! window. A page written before sections existed (one snapshot per call) loads as sections.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::blocks::{self, Block, ImageSlot};
use crate::store;

pub const STATES: [&str; 6] = ["working", "question", "review", "ready", "done", "blocked"];
/// The page's sections, in reading order.
pub const SECTIONS: [&str; 6] = ["ticket", "understood", "plan", "progress", "result", "left"];
pub const PROGRESS: [&str; 5] = ["done", "current", "todo", "failed", "skipped"];
/// Most characters per text (chars, not bytes), as the tool's schema says them.
pub const MAX_TITLE: usize = 60;
pub const MAX_SUMMARY: usize = 200;
pub const MAX_CONTEXT: usize = 300;
pub const MAX_CHOICE: usize = 120;
/// The current step, after the state: "Working · code".
pub const MAX_STEP: usize = 24;
/// One progress step: a few words, read on one line with the others.
pub const MAX_PROGRESS_TEXT: usize = 40;
pub const MAX_PROGRESS: usize = 12;
/// Images per section of a page (the page adds up as it goes), and per `show` call.
pub(crate) const MAX_IMAGES: usize = 16;
const MAX_IMAGE_BYTES: u64 = 4 * 1024 * 1024;
const EXTENSIONS: [&str; 4] = ["png", "jpg", "jpeg", "webp"];
const FILE: &str = "report.json";

/// The sections made of blocks, and what their images are called in a call's errors.
const BLOCK_SECTIONS: [(&str, &str); 4] = [
    ("ticket", "sections.ticket"),
    ("understood", "sections.understood"),
    ("plan", "sections.plan"),
    ("result", "sections.result"),
];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub workspace_id: String,
    pub chat_id: String,
    /// The last call (ms).
    pub at: u64,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub ticket: Option<String>,
    pub title: String,
    pub summary: String,
    /// A word or two for the current step: "Working · code".
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub step: Option<String>,
    /// The question of a page written the old way (its open choice), drawn while the chat
    /// can't say what it asks.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub question: Option<String>,
    #[serde(default)]
    pub sections: Sections,
    /// When each section was last set (ms), by name.
    #[serde(skip_serializing_if = "BTreeMap::is_empty", default)]
    pub updated: BTreeMap<String, u64>,
    /// What a page written before sections held: read, mapped onto sections, never written.
    #[serde(flatten, skip_serializing)]
    legacy: Legacy,
}

/// The page's sections; an empty one is not written yet (or was cleared).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Sections {
    /// What was asked, as written.
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub ticket: Vec<Block>,
    /// What the work is for, the problem, whether the reading was confirmed.
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub understood: Vec<Block>,
    /// The solution, what is set aside, product choices, today next to the mockup.
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub plan: Vec<Block>,
    /// The agent's own steps for this task.
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub progress: Vec<Progress>,
    /// The real screens, what was run, the PR.
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub result: Vec<Block>,
    /// What the user still has to do.
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub left: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Progress {
    pub text: String,
    pub status: String,
}

impl Sections {
    fn blocks_mut(&mut self, name: &str) -> Option<&mut Vec<Block>> {
        match name {
            "ticket" => Some(&mut self.ticket),
            "understood" => Some(&mut self.understood),
            "plan" => Some(&mut self.plan),
            "result" => Some(&mut self.result),
            _ => None,
        }
    }

    fn is_empty(&self, name: &str) -> bool {
        match name {
            "progress" => self.progress.is_empty(),
            "left" => self.left.is_empty(),
            _ => self.blocks(name).is_empty(),
        }
    }

    fn blocks(&self, name: &str) -> &[Block] {
        match name {
            "ticket" => &self.ticket,
            "understood" => &self.understood,
            "plan" => &self.plan,
            "result" => &self.result,
            _ => &[],
        }
    }

    /// Every image slot of every section, in reading order.
    pub fn images_mut(&mut self) -> Vec<ImageSlot<'_>> {
        let Sections {
            ticket,
            understood,
            plan,
            result,
            ..
        } = self;
        let mut out = blocks::images_in(ticket, "sections.ticket");
        out.extend(blocks::images_in(understood, "sections.understood"));
        out.extend(blocks::images_in(plan, "sections.plan"));
        out.extend(blocks::images_in(result, "sections.result"));
        out
    }
}

/// A report's fields from before sections: a stored page's, or an agent's on older
/// instructions (still accepted, mapped the same way).
#[derive(Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
struct Legacy {
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
    blocks: Option<Value>,
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
    #[serde(default)]
    reset: bool,
    state: Option<String>,
    ticket: Option<String>,
    title: Option<String>,
    summary: Option<String>,
    step: Option<String>,
    sections: Option<serde_json::Map<String, Value>>,
    #[serde(flatten)]
    legacy: Legacy,
}

/// Old fields as the sections they fill: the feature and problem are what was understood,
/// the choices made the plan, the screens, other blocks and links the result.
#[derive(Default)]
struct Mapped {
    understood: Vec<Block>,
    plan: Vec<Block>,
    result: Vec<Block>,
    left: Vec<String>,
    /// The open choice's text, when choices were given.
    question: Option<Option<String>>,
}

impl Mapped {
    fn new(legacy: Legacy, blocks: Vec<Block>) -> Mapped {
        let trimmed = |v: Option<String>| v.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
        let (feature, problem) = (trimmed(legacy.feature), trimmed(legacy.problem));
        let mut m = Mapped::default();
        if feature.is_some() || problem.is_some() {
            m.understood
                .push(Block::Context(blocks::Context { feature, problem }));
        }
        let made: Vec<blocks::Decision> = legacy
            .choices
            .iter()
            .filter(|c| !c.open)
            .map(|c| blocks::Decision {
                text: c.text.trim().to_string(),
                set_aside: trimmed(c.set_aside.clone()),
            })
            .collect();
        if !made.is_empty() {
            m.plan.push(Block::Decisions(blocks::Decisions {
                title: None,
                items: made,
            }));
        }
        if !legacy.choices.is_empty() {
            m.question = Some(
                legacy
                    .choices
                    .iter()
                    .find(|c| c.open)
                    .map(|c| c.text.trim().to_string()),
            );
        }
        let steps: Vec<blocks::ScreenStep> = legacy
            .screens
            .into_iter()
            .map(|s| blocks::ScreenStep {
                caption: s.step.trim().to_string(),
                before: s.before,
                after: s.after,
            })
            .collect();
        for chunk in steps.chunks(blocks::MAX_SCREEN_STEPS) {
            m.result.push(Block::Screens(blocks::Screens {
                title: None,
                steps: chunk.to_vec(),
            }));
        }
        m.left = legacy
            .left
            .iter()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect();
        for b in blocks {
            match b {
                Block::Decisions(_) => m.plan.push(b),
                Block::Left(l) => m.left.extend(l.items),
                Block::Context(_) => m.understood.push(b),
                other => m.result.push(other),
            }
        }
        if !legacy.links.is_empty() {
            m.result.push(Block::Text(blocks::Text {
                title: None,
                paragraphs: Vec::new(),
                links: legacy
                    .links
                    .into_iter()
                    .map(|l| Link {
                        label: l.label.trim().to_string(),
                        url: l.url.trim().to_string(),
                    })
                    .collect(),
            }));
        }
        m
    }

    /// The sections it fills, by name (only those it has something for).
    fn sections(self) -> (Vec<(&'static str, SectionValue)>, Option<Option<String>>) {
        let mut out = Vec::new();
        for (name, blocks) in [
            ("understood", self.understood),
            ("plan", self.plan),
            ("result", self.result),
        ] {
            if !blocks.is_empty() {
                out.push((name, SectionValue::Blocks(blocks)));
            }
        }
        if !self.left.is_empty() {
            out.push(("left", SectionValue::Left(self.left)));
        }
        (out, self.question)
    }
}

enum SectionValue {
    Blocks(Vec<Block>),
    Progress(Vec<Progress>),
    Left(Vec<String>),
}

impl Sections {
    fn set(&mut self, name: &str, value: SectionValue) {
        match value {
            SectionValue::Progress(p) => self.progress = p,
            SectionValue::Left(l) => self.left = l,
            SectionValue::Blocks(b) => {
                if let Some(slot) = self.blocks_mut(name) {
                    *slot = b;
                }
            }
        }
    }
}

impl Report {
    /// A page written before sections, as sections; any other page as it is.
    fn migrate(mut self) -> Report {
        let legacy = std::mem::take(&mut self.legacy);
        if legacy == Legacy::default() {
            return self;
        }
        let blocks: Vec<Block> = legacy
            .blocks
            .clone()
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();
        let (sections, question) = Mapped::new(legacy, blocks).sections();
        for (name, value) in sections {
            if self.sections.is_empty(name) {
                self.sections.set(name, value);
            }
        }
        if self.question.is_none() && self.state == "question" {
            self.question = question.flatten();
        }
        self
    }

    /// Every image file the page names.
    fn files(&mut self) -> BTreeSet<String> {
        self.sections
            .images_mut()
            .into_iter()
            .filter_map(|s| s.path.clone())
            .collect()
    }
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

/// A text the user reads at a glance: at most `max` characters, or an error saying how to
/// shorten it.
pub(crate) fn short(text: &str, field: &str, max: usize, how: &str) -> Result<(), String> {
    let n = text.chars().count();
    if n > max {
        return Err(format!("`{field}` is {n} characters, at most {max}: {how}"));
    }
    Ok(())
}

/// A link the window may open: http or https only.
pub(crate) fn web_url(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    ["https://", "http://"]
        .iter()
        .any(|p| lower.starts_with(p) && lower.len() > p.len())
}

/// An image the agent named: resolved against the worktree, checked, its extension.
pub(crate) fn image(worktree: &Path, path: &str, what: &str) -> Result<(PathBuf, String), String> {
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

/// A head field: the call's (trimmed, never empty), else the page's, else an error.
fn head(value: Option<String>, field: &str, kept: Option<&str>) -> Result<String, String> {
    match value.map(|v| v.trim().to_string()) {
        Some(v) if !v.is_empty() => Ok(v),
        Some(_) => Err(format!("`{field}` must not be empty")),
        None => kept.map(String::from).ok_or_else(|| {
            format!("`{field}` is required on the first call for this task (and after `reset`)")
        }),
    }
}

/// One section as the agent gave it, checked; null or [] clears it.
fn section(name: &str, value: &Value) -> Result<SectionValue, String> {
    let field = format!("sections.{name}");
    let empty = value.is_null() || value.as_array().is_some_and(Vec::is_empty);
    match name {
        "progress" => Ok(SectionValue::Progress(if empty {
            Vec::new()
        } else {
            progress(value)?
        })),
        "left" => Ok(SectionValue::Left(if empty {
            Vec::new()
        } else {
            left(value)?
        })),
        _ if BLOCK_SECTIONS.iter().any(|(n, _)| *n == name) => Ok(SectionValue::Blocks(if empty {
            Vec::new()
        } else {
            blocks::parse_in(value, blocks::Tool::Report, &field)?
        })),
        _ => Err(format!(
            "`sections` has no `{name}`: the sections are {}",
            SECTIONS.join(", ")
        )),
    }
}

fn progress(value: &Value) -> Result<Vec<Progress>, String> {
    let shape = "a list of {text, status: done|current|todo|failed|skipped}";
    let items: Vec<Progress> = serde_json::from_value(value.clone())
        .map_err(|e| format!("`sections.progress` is {shape}: {e}"))?;
    if items.len() > MAX_PROGRESS {
        return Err(format!(
            "`sections.progress` has {} steps, at most {MAX_PROGRESS}: merge the small ones",
            items.len()
        ));
    }
    let mut out = Vec::new();
    for (i, p) in items.into_iter().enumerate() {
        let field = format!("sections.progress[{i}]");
        let text = p.text.trim().to_string();
        if text.is_empty() {
            return Err(format!("`{field}.text` must not be empty"));
        }
        short(
            &text,
            &format!("{field}.text"),
            MAX_PROGRESS_TEXT,
            "a word or two (investigation, mockup, code, on-screen test, PR)",
        )?;
        if !PROGRESS.contains(&p.status.as_str()) {
            return Err(format!(
                "`{field}.status` must be one of {}, not {}",
                PROGRESS.join(", "),
                p.status
            ));
        }
        out.push(Progress {
            text,
            status: p.status,
        });
    }
    let current = out.iter().filter(|p| p.status == "current").count();
    if current > 1 {
        return Err(format!(
            "`sections.progress` has {current} current steps, at most one: the one you are on"
        ));
    }
    Ok(out)
}

fn left(value: &Value) -> Result<Vec<String>, String> {
    let items: Vec<String> = serde_json::from_value(value.clone())
        .map_err(|e| format!("`sections.left` is a list of strings: {e}"))?;
    if items.len() > blocks::MAX_ITEMS {
        return Err(format!(
            "`sections.left` has {}, at most {}: keep what the user must not forget",
            items.len(),
            blocks::MAX_ITEMS
        ));
    }
    let mut out = Vec::new();
    for (i, item) in items.iter().enumerate() {
        let item = item.trim();
        if item.is_empty() {
            return Err(format!("`sections.left[{i}]` must not be empty"));
        }
        short(
            item,
            &format!("sections.left[{i}]"),
            blocks::MAX_LINE,
            "one thing to do, in one line",
        )?;
        out.push(item.to_string());
    }
    Ok(out)
}

/// An agent's old fields, checked as before, as the sections they fill.
fn legacy_input(legacy: Legacy, state: &str) -> Result<Mapped, String> {
    let optional = |v: &Option<String>| {
        v.as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .map(String::from)
    };
    for (field, text) in [
        ("feature", optional(&legacy.feature)),
        ("problem", optional(&legacy.problem)),
    ] {
        if let Some(text) = text {
            short(
                &text,
                field,
                MAX_CONTEXT,
                "two or three short lines, one concrete case rather than every detail",
            )?;
        }
    }
    for (i, c) in legacy.choices.iter().enumerate() {
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
    let open = legacy.choices.iter().filter(|c| c.open).count();
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
    for (i, l) in legacy.links.iter().enumerate() {
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
    for (i, s) in legacy.screens.iter().enumerate() {
        if s.step.trim().is_empty() {
            return Err(format!("screens[{i}].step must not be empty"));
        }
    }
    let blocks = match &legacy.blocks {
        None | Some(Value::Null) => Vec::new(),
        Some(list) => blocks::parse(list, blocks::Tool::Report)?,
    };
    Ok(Mapped::new(legacy, blocks))
}

/// Validates the tool's arguments and merges them into the workspace's page: what the call
/// gives replaces what it names, the rest stays (all of it goes with `reset`). Images of the
/// sections it replaces are copied beside the page, and the files no section names any more
/// are removed. Returns a short confirmation.
pub fn save(
    root: &Path,
    workspace_id: &str,
    chat_id: &str,
    worktree: &Path,
    args: &Value,
    at: u64,
) -> Result<String, String> {
    let input: Input = serde_json::from_value(args.clone()).map_err(|e| {
        format!("bad arguments: {e} (sections is {{ticket?, understood?, plan?, result?: [block], progress?: [{{text, status}}], left?: [string]}})")
    })?;
    let dir = folder(root, workspace_id)?;
    let previous = if input.reset {
        None
    } else {
        load(root, workspace_id)
    };
    let kept = previous.as_ref();
    let state = head(input.state, "state", kept.map(|p| p.state.as_str()))?;
    if !STATES.contains(&state.as_str()) {
        return Err(format!(
            "`state` must be one of {}, not {state}",
            STATES.join(", ")
        ));
    }
    let title = head(input.title, "title", kept.map(|p| p.title.as_str()))?;
    let summary = head(input.summary, "summary", kept.map(|p| p.summary.as_str()))?;
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
        "keep the one sentence that matters (where it stands, the question, why blocked)",
    )?;
    let given = |v: Option<String>| v.map(|t| t.trim().to_string());
    let ticket = match given(input.ticket) {
        Some(t) => Some(t).filter(|t| !t.is_empty()),
        None => kept.and_then(|p| p.ticket.clone()),
    };
    // A step belongs to its state: a new state without one clears it.
    let step = match given(input.step) {
        Some(s) => Some(s).filter(|s| !s.is_empty()),
        None => kept
            .filter(|p| p.state == state)
            .and_then(|p| p.step.clone()),
    };
    if let Some(step) = &step {
        short(
            step,
            "step",
            MAX_STEP,
            "a word or two: investigation, mockup, code, on-screen test, PR",
        )?;
    }

    let mut sections = kept.map(|p| p.sections.clone()).unwrap_or_default();
    let mut updated = kept.map(|p| p.updated.clone()).unwrap_or_default();
    let mut set: Vec<&'static str> = Vec::new();
    for (name, value) in input.sections.iter().flatten() {
        let value = section(name, value)?;
        let name = SECTIONS
            .iter()
            .find(|n| **n == name.as_str())
            .copied()
            .unwrap_or_default();
        sections.set(name, value);
        set.push(name);
    }
    let (mapped, asked) = legacy_input(input.legacy, &state)?.sections();
    for (name, value) in mapped {
        if set.contains(&name) {
            return Err(format!(
                "`sections.{name}` and an older field ({}) both set the {name} section: give `sections.{name}` only",
                match name {
                    "understood" => "feature, problem",
                    "plan" => "choices",
                    "result" => "screens, links, blocks",
                    _ => "left",
                }
            ));
        }
        sections.set(name, value);
        set.push(name);
    }
    let question = match asked {
        Some(q) => q,
        None if state == "question" => kept.and_then(|p| p.question.clone()),
        None => None,
    };

    // Check every new image before touching the page, and name its copy.
    let mut copies = Vec::new();
    for (name, list) in BLOCK_SECTIONS {
        if !set.contains(&name) {
            continue;
        }
        let Some(blocks) = sections.blocks_mut(name) else {
            continue;
        };
        let n = blocks::image_count(blocks);
        if n > MAX_IMAGES {
            return Err(format!(
                "`{list}` has {n} images, at most {MAX_IMAGES} per section: keep the screens that matter"
            ));
        }
        for slot in blocks::images_in(blocks, list) {
            if let Some(path) = slot.path.take() {
                let (src, ext) = image(worktree, &path, &slot.field())?;
                let file = format!(
                    "{name}-{at}-{}-{}-{}.{ext}",
                    slot.block, slot.step, slot.side
                );
                copies.push((src, file.clone()));
                *slot.path = Some(file);
            }
        }
    }
    for name in &set {
        updated.insert((*name).to_string(), at);
    }

    let mut report = Report {
        workspace_id: workspace_id.to_string(),
        chat_id: chat_id.to_string(),
        at,
        state: state.clone(),
        ticket,
        title,
        summary,
        step,
        question,
        sections,
        updated,
        legacy: Legacy::default(),
    };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    for (i, (src, name)) in copies.iter().enumerate() {
        if let Err(e) = std::fs::copy(src, dir.join(name)) {
            for (_, done) in &copies[..i] {
                let _ = std::fs::remove_file(dir.join(done));
            }
            return Err(format!("copying {}: {e}", src.display()));
        }
    }
    let text = serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?;
    store::write_atomic(&dir.join(FILE), &text)?;
    // The files no section names any more: replaced sections', a reset page's.
    let named = report.files();
    for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name != FILE && !named.contains(&name) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    let what = if set.is_empty() {
        "the head".to_string()
    } else {
        set.join(", ")
    };
    Ok(format!(
        "Saved on the task's page ({state}; set {what}). The other sections stay as they were: call again as the work moves, and whenever the state changes."
    ))
}

/// The stored page, images as stored file names (a page written the old way, as sections).
pub fn load(root: &Path, workspace_id: &str) -> Option<Report> {
    let text = std::fs::read_to_string(folder(root, workspace_id).ok()?.join(FILE)).ok()?;
    serde_json::from_str::<Report>(&text)
        .ok()
        .map(Report::migrate)
}

/// The page with its images inlined as `data:` URLs (a missing one is dropped).
pub fn load_inline(root: &Path, workspace_id: &str) -> Option<Report> {
    let mut report = load(root, workspace_id)?;
    let dir = folder(root, workspace_id).ok()?;
    for slot in report.sections.images_mut() {
        *slot.path = slot.path.take().and_then(|name| data_url(&dir.join(name)));
    }
    Some(report)
}

pub(crate) fn data_url(path: &Path) -> Option<String> {
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

/// Every workspace's page, without images, newest first.
pub fn list(root: &Path) -> Vec<Report> {
    let Ok(entries) = std::fs::read_dir(reports_dir(root)) else {
        return Vec::new();
    };
    let mut reports: Vec<Report> = entries
        .flatten()
        .filter_map(|e| load(root, &e.file_name().to_string_lossy()))
        .map(|mut r| {
            for slot in r.sections.images_mut() {
                *slot.path = None;
            }
            r
        })
        .collect();
    reports.sort_by(|a, b| b.at.cmp(&a.at));
    reports
}

/// Drops a workspace's page, if any.
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

    fn first() -> Value {
        json!({
            "state": "working", "ticket": "ATL-79", "title": "Refund flow",
            "summary": "Reading the ticket.", "step": "investigation",
            "sections": {
                "ticket": [{ "kind": "text", "paragraphs": ["Refund cancelled trips."] }],
                "understood": [{ "kind": "text", "paragraphs": ["Travellers wait a week."] }],
            },
        })
    }

    fn shot(root: &Path, name: &str) {
        std::fs::write(root.join(name), b"png!").unwrap();
    }

    fn files(root: &Path) -> Vec<String> {
        let mut out: Vec<String> = std::fs::read_dir(root.join("reports/w"))
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        out.sort();
        out
    }

    #[test]
    fn a_later_call_merges_into_the_page() {
        let root = temp("merge");
        save(&root, "w", "c", &root, &first(), 1).unwrap();
        let msg = save(
            &root,
            "w",
            "c2",
            &root,
            &json!({ "sections": { "plan": [{ "kind": "decisions", "items": [{ "text": "Refund in one click" }] }],
                "progress": [{ "text": "investigation", "status": "done" }, { "text": "code", "status": "current" }] } }),
            2,
        )
        .unwrap();
        assert!(msg.contains("plan, progress"), "{msg}");
        let r = load(&root, "w").unwrap();
        assert_eq!(
            (r.title.as_str(), r.state.as_str()),
            ("Refund flow", "working")
        );
        assert_eq!(r.ticket.as_deref(), Some("ATL-79"));
        assert_eq!(r.step.as_deref(), Some("investigation"));
        assert_eq!((r.at, r.chat_id.as_str()), (2, "c2"));
        assert_eq!(r.sections.ticket.len(), 1);
        assert_eq!(r.sections.understood.len(), 1);
        assert_eq!(r.sections.plan.len(), 1);
        assert_eq!(r.sections.progress[1].status, "current");
        assert_eq!(r.updated["ticket"], 1);
        assert_eq!(r.updated["plan"], 2);
        // A section given replaces only itself; [] clears it; a new state drops the old step.
        save(
            &root,
            "w",
            "c",
            &root,
            &json!({ "state": "review", "summary": "Screens to check.",
                "sections": { "understood": [], "left": ["Try it on staging"] } }),
            3,
        )
        .unwrap();
        let r = load(&root, "w").unwrap();
        assert!(r.sections.understood.is_empty());
        assert_eq!(r.sections.plan.len(), 1);
        assert_eq!(r.sections.left, vec!["Try it on staging"]);
        assert_eq!(r.step, None);
        assert_eq!(r.summary, "Screens to check.");
        let v = serde_json::to_value(&r).unwrap();
        assert!(v["sections"].get("understood").is_none());
        assert_eq!(v["updated"]["understood"], 3);
    }

    #[test]
    fn the_first_call_and_a_reset_need_the_head() {
        let root = temp("first");
        let err = |args: Value| save(&root, "w", "c", &root, &args, 0).unwrap_err();
        let e = err(json!({ "state": "working", "title": "T" }));
        assert!(e.contains("`summary` is required on the first call"), "{e}");
        save(&root, "w", "c", &root, &first(), 1).unwrap();
        save(&root, "w", "c", &root, &json!({ "state": "done" }), 2).unwrap();
        let e = err(json!({ "reset": true, "state": "working" }));
        assert!(e.contains("`title` is required"), "{e}");
        save(
            &root,
            "w",
            "c",
            &root,
            &json!({ "reset": true, "state": "working", "title": "Next", "summary": "Starting." }),
            3,
        )
        .unwrap();
        let r = load(&root, "w").unwrap();
        assert_eq!(r.title, "Next");
        assert_eq!(r.ticket, None);
        assert_eq!(r.sections, Sections::default());
        assert!(r.updated.is_empty());
    }

    #[test]
    fn images_of_kept_sections_stay_and_replaced_ones_go() {
        let root = temp("images");
        shot(&root, "a.png");
        shot(&root, "b.png");
        let mut a = first();
        a["sections"]["plan"] = json!([{ "kind": "screens", "steps": [{ "caption": "Today", "before": "a.png", "after": "b.png" }] }]);
        a["sections"]["result"] =
            json!([{ "kind": "screens", "steps": [{ "caption": "Done", "after": "a.png" }] }]);
        save(&root, "w", "c", &root, &a, 1).unwrap();
        assert_eq!(
            files(&root),
            [
                "plan-1-0-0-after.png",
                "plan-1-0-0-before.png",
                "report.json",
                "result-1-0-0-after.png"
            ]
        );
        // The result is replaced: its old screen goes, the plan's stay.
        save(
            &root,
            "w",
            "c",
            &root,
            &json!({ "sections": { "result": [{ "kind": "screens", "steps": [{ "caption": "Again", "after": "b.png" }] }] } }),
            2,
        )
        .unwrap();
        assert_eq!(
            files(&root),
            [
                "plan-1-0-0-after.png",
                "plan-1-0-0-before.png",
                "report.json",
                "result-2-0-0-after.png"
            ]
        );
        let r = load_inline(&root, "w").unwrap();
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(
            v["sections"]["plan"][0]["steps"][0]["before"],
            "data:image/png;base64,cG5nIQ=="
        );
        assert_eq!(
            v["sections"]["result"][0]["steps"][0]["after"],
            "data:image/png;base64,cG5nIQ=="
        );
        let listed = serde_json::to_value(list(&root)).unwrap();
        assert_eq!(
            listed[0]["sections"]["plan"][0]["steps"][0],
            json!({ "caption": "Today" })
        );
        // A failed call changes nothing.
        let e = save(
            &root,
            "w",
            "c",
            &root,
            &json!({ "sections": { "plan": [{ "kind": "screens", "steps": [{ "caption": "x", "after": "none.png" }] }] } }),
            3,
        )
        .unwrap_err();
        assert!(
            e.contains("sections.plan[0].steps[0].after: no file"),
            "{e}"
        );
        assert_eq!(load(&root, "w").unwrap().at, 2);
        // A reset leaves no file behind.
        save(
            &root,
            "w",
            "c",
            &root,
            &json!({ "reset": true, "state": "working", "title": "T", "summary": "S" }),
            4,
        )
        .unwrap();
        assert_eq!(files(&root), ["report.json"]);
        remove(&root, "w");
        assert!(load(&root, "w").is_none());
    }

    #[test]
    fn images_are_capped_per_section() {
        let root = temp("cap");
        shot(&root, "ok.png");
        let steps: Vec<Value> = (0..8)
            .map(|_| json!({ "caption": "s", "before": "ok.png", "after": "ok.png" }))
            .collect();
        let mut a = first();
        a["sections"]["plan"] = json!([{ "kind": "screens", "steps": steps }]);
        a["sections"]["result"] = json!([{ "kind": "screens", "steps": steps }]);
        // 16 in each section: accepted.
        save(&root, "w", "c", &root, &a, 1).unwrap();
        a["sections"]["result"] = json!([
            { "kind": "screens", "steps": steps },
            { "kind": "screens", "steps": [{ "caption": "one more", "after": "ok.png" }] },
        ]);
        let e = save(&root, "w", "c", &root, &a, 2).unwrap_err();
        assert!(
            e.contains("`sections.result` has 17 images, at most 16 per section"),
            "{e}"
        );
    }

    #[test]
    fn bad_input_says_what_to_fix() {
        let root = temp("bad");
        let err = |args: Value| save(&root, "w", "c", &root, &args, 0).unwrap_err();
        let with = |k: &str, v: Value| {
            let mut a = first();
            a[k] = v;
            a
        };
        assert!(err(with("state", json!("finished"))).contains("must be one of working"));
        assert!(err(with("title", json!(" "))).contains("`title` must not be empty"));
        assert!(err(with("step", json!("x".repeat(25)))).contains("at most 24"));
        assert!(err(with("sections", json!({ "notes": [] }))).contains("the sections are ticket"));
        let e = err(with("sections", json!({ "plan": [{ "kind": "chart" }] })));
        assert!(e.contains("sections.plan[0].kind must be one of"), "{e}");
        let e = err(with(
            "sections",
            json!({ "progress": [{ "text": "code", "status": "doing" }] }),
        ));
        assert!(
            e.contains("sections.progress[0].status` must be one of done"),
            "{e}"
        );
        let two =
            json!([{ "text": "a", "status": "current" }, { "text": "b", "status": "current" }]);
        assert!(err(with("sections", json!({ "progress": two }))).contains("at most one"));
        let long = json!([{ "text": "x".repeat(41), "status": "todo" }]);
        assert!(err(with("sections", json!({ "progress": long }))).contains("at most 40"));
        assert!(err(with("sections", json!({ "left": [""] }))).contains("must not be empty"));
        let e = err(with(
            "sections",
            json!({ "understood": [{ "kind": "context" }] }),
        ));
        assert!(e.contains("sections.understood[0]"), "{e}");
        let mut a = first();
        a["feature"] = json!("The refunds.");
        let e = err(a);
        assert!(e.contains("give `sections.understood` only"), "{e}");
        assert!(load(&root, "w").is_none());
    }

    #[test]
    fn old_fields_from_an_agent_fill_their_sections() {
        let root = temp("legacy-input");
        shot(&root, "a.png");
        let args = json!({
            "state": "question", "ticket": "#335", "title": "Sidebar badges",
            "summary": "Which cap?", "feature": "The sidebar.", "problem": "You miss replies.",
            "choices": [{ "text": "Count up to 99", "setAside": "No cap" }, { "text": "Grey when zero?", "open": true }],
            "screens": [{ "step": "Open", "after": "a.png" }],
            "links": [{ "label": "PR", "url": "https://x/pr/1" }], "left": ["merge"],
            "blocks": [{ "kind": "left", "items": ["deploy"] }, { "kind": "callout", "tone": "note", "text": "n" }],
        });
        save(&root, "w", "c", &root, &args, 1).unwrap();
        let v = serde_json::to_value(load(&root, "w").unwrap()).unwrap();
        let s = &v["sections"];
        assert_eq!(
            s["understood"],
            json!([{ "kind": "context", "feature": "The sidebar.", "problem": "You miss replies." }])
        );
        assert_eq!(
            s["plan"],
            json!([{ "kind": "decisions", "items": [{ "text": "Count up to 99", "setAside": "No cap" }] }])
        );
        assert_eq!(
            s["result"][0]["steps"][0]["after"],
            "result-1-0-0-after.png"
        );
        assert_eq!(s["result"][1]["kind"], "callout");
        assert_eq!(s["result"][2]["links"][0]["url"], "https://x/pr/1");
        assert_eq!(s["left"], json!(["merge", "deploy"]));
        assert_eq!(v["question"], "Grey when zero?");
        assert!(v.get("feature").is_none() && v.get("choices").is_none());
        let err = |args: Value| save(&root, "w", "c", &root, &args, 0).unwrap_err();
        assert!(
            err(json!({ "state": "review", "choices": [{ "text": "a", "open": true }] }))
                .contains("set `state` to question")
        );
        assert!(
            err(json!({ "links": [{ "label": "x", "url": "file:///etc" }] }))
                .contains("http or https")
        );
        // The question goes with the state.
        save(&root, "w", "c", &root, &json!({ "state": "working" }), 2).unwrap();
        assert_eq!(load(&root, "w").unwrap().question, None);
    }

    #[test]
    fn a_page_saved_before_sections_loads_as_sections() {
        let root = temp("old");
        std::fs::create_dir_all(root.join("reports/w")).unwrap();
        std::fs::write(root.join("reports/w/0-after.png"), b"png!").unwrap();
        let old = r##"{"workspaceId":"w","chatId":"c","at":3,"state":"question","ticket":"#9","title":"T","summary":"S",
            "feature":"F","choices":[{"text":"Made"},{"text":"Asked?","open":true}],
            "screens":[{"step":"Open","after":"0-after.png"}],"links":[{"label":"PR","url":"https://x/pr/2"}],
            "left":["merge"],"blocks":[{"kind":"text","paragraphs":["Hi"]}]}"##;
        std::fs::write(root.join("reports/w/report.json"), old).unwrap();
        let r = load_inline(&root, "w").unwrap();
        assert_eq!(r.question.as_deref(), Some("Asked?"));
        let v = serde_json::to_value(&r).unwrap();
        let s = &v["sections"];
        assert_eq!(
            s["understood"][0],
            json!({ "kind": "context", "feature": "F" })
        );
        assert_eq!(s["plan"][0]["items"][0]["text"], "Made");
        assert_eq!(
            s["result"][0]["steps"][0]["after"],
            "data:image/png;base64,cG5nIQ=="
        );
        assert_eq!(s["result"][1]["paragraphs"][0], "Hi");
        assert_eq!(s["result"][2]["links"][0]["label"], "PR");
        assert_eq!(s["left"], json!(["merge"]));
        // Written again by a later call: the old screen is kept with its section.
        save(&root, "w", "c", &root, &json!({ "state": "working" }), 4).unwrap();
        assert_eq!(files(&root), ["0-after.png", "report.json"]);
        let stored = std::fs::read_to_string(root.join("reports/w/report.json")).unwrap();
        assert!(!stored.contains("\"choices\""), "{stored}");
        // The oldest shape (no blocks, empty lists) loads too.
        std::fs::write(
            root.join("reports/w/report.json"),
            r#"{"workspaceId":"w","chatId":"c","at":3,"state":"ready","title":"T","summary":"S","choices":[],"screens":[],"links":[],"left":[]}"#,
        )
        .unwrap();
        assert_eq!(load(&root, "w").unwrap().sections, Sections::default());
    }

    #[test]
    fn texts_are_counted_in_characters() {
        let root = temp("limits");
        let mut a = first();
        a["title"] = json!("é".repeat(60));
        save(&root, "w", "c", &root, &a, 1).unwrap();
        for (field, max) in [("title", 60), ("summary", 200)] {
            let mut a = first();
            a[field] = json!("x".repeat(max + 1));
            let e = save(&root, "w", "c", &root, &a, 2).unwrap_err();
            assert!(
                e.contains(&format!(
                    "`{field}` is {} characters, at most {max}",
                    max + 1
                )),
                "{e}"
            );
        }
    }
}
