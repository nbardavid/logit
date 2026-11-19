//! Blocks an agent composes (drawn by `src/report/blocks` in the window): the `report` tool's
//! optional body, and the whole of the `show` tool, which draws them in the conversation. One
//! schema and one validation for both; only where the images go differs (a report copies
//! them beside it, `show` leaves them in the worktree for the window to read).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::report::{short, web_url, Link, MAX_TITLE};

/// Limits, as the schema states them (characters, not bytes).
pub const MAX_BLOCKS: usize = 12;
pub const MAX_PARAGRAPHS: usize = 6;
pub const MAX_PARAGRAPH: usize = 600;
pub const MAX_LINKS: usize = 8;
/// One line: a step, a choice, a caption, a cell, a link's label.
pub const MAX_LINE: usize = 160;
/// A callout's text, a step's detail.
pub const MAX_DETAIL: usize = 300;
pub const MAX_ITEMS: usize = 16;
pub const MAX_COLUMNS: usize = 6;
pub const MAX_ROWS: usize = 20;
pub const MAX_SCREEN_STEPS: usize = 8;

const TONES: [&str; 3] = ["note", "assumption", "risk"];
const STATUSES: [&str; 3] = ["done", "failed", "skipped"];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Block {
    Text(Text),
    Callout(Callout),
    Steps(Steps),
    Table(Table),
    Decisions(Decisions),
    Screens(Screens),
    Left(Left),
    /// Why the work exists, from a report written before pages (`feature` and `problem`).
    /// Logit's own: an agent never sends it.
    Context(Context),
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Context {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub feature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub problem: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Text {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub title: Option<String>,
    #[serde(default)]
    pub paragraphs: Vec<String>,
    #[serde(default)]
    pub links: Vec<Link>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Callout {
    pub tone: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub title: Option<String>,
    pub text: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Steps {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub title: Option<String>,
    pub items: Vec<Step>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Step {
    pub text: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub detail: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Table {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub title: Option<String>,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Decisions {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub title: Option<String>,
    pub items: Vec<Decision>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Decision {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub set_aside: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Screens {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub title: Option<String>,
    pub steps: Vec<ScreenStep>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ScreenStep {
    pub caption: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub before: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub after: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Left {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub title: Option<String>,
    pub items: Vec<String>,
}

/// Which tool the blocks came through: what an error tells the agent to do instead.
#[derive(Clone, Copy, PartialEq)]
pub enum Tool {
    Report,
    Show,
}

/// Each kind an agent may send: its fields, and its shape as an error says it.
const SHAPES: [(&str, &[&str], &str); 7] = [
    (
        "text",
        &["kind", "title", "paragraphs", "links"],
        "{kind: \"text\", title?, paragraphs: [string], links?: [{label, url}]}",
    ),
    (
        "callout",
        &["kind", "tone", "title", "text"],
        "{kind: \"callout\", tone: note|assumption|risk, title?, text}",
    ),
    (
        "steps",
        &["kind", "title", "items"],
        "{kind: \"steps\", title?, items: [{text, status: done|failed|skipped, detail?}]}",
    ),
    (
        "table",
        &["kind", "title", "columns", "rows"],
        "{kind: \"table\", title?, columns: [string], rows: [[string]]}",
    ),
    (
        "decisions",
        &["kind", "title", "items"],
        "{kind: \"decisions\", title?, items: [{text, setAside?}]}",
    ),
    (
        "screens",
        &["kind", "title", "steps"],
        "{kind: \"screens\", title?, steps: [{caption, before?, after?}]}",
    ),
    (
        "left",
        &["kind", "title", "items"],
        "{kind: \"left\", title?, items: [string]}",
    ),
];

/// The `blocks` property's schema, shared by `report` and `show`.
pub fn schema(description: &str) -> Value {
    let title = json!({ "type": "string", "maxLength": MAX_TITLE });
    let line = json!({ "type": "string", "maxLength": MAX_LINE });
    let kind = |k: &str| json!({ "const": k });
    json!({
        "type": "array",
        "minItems": 1,
        "maxItems": MAX_BLOCKS,
        "description": description,
        "items": { "anyOf": [
            { "type": "object", "description": "Paragraphs, and links out. Inline: **bold**, `code`, [label](https://…).", "properties": {
                "kind": kind("text"), "title": title,
                "paragraphs": { "type": "array", "maxItems": MAX_PARAGRAPHS, "items": { "type": "string", "maxLength": MAX_PARAGRAPH } },
                "links": { "type": "array", "maxItems": MAX_LINKS, "items": { "type": "object", "properties": {
                    "label": line, "url": { "type": "string", "pattern": "^[Hh][Tt][Tt][Pp][Ss]?://" },
                }, "required": ["label", "url"] } },
            }, "required": ["kind"] },
            { "type": "object", "description": "One short paragraph to notice: a note, an assumption you made, or a risk.", "properties": {
                "kind": kind("callout"), "tone": { "type": "string", "enum": TONES }, "title": title,
                "text": { "type": "string", "maxLength": MAX_DETAIL },
            }, "required": ["kind", "tone", "text"] },
            { "type": "object", "description": "What was done, in order, each done, failed or skipped.", "properties": {
                "kind": kind("steps"), "title": title,
                "items": { "type": "array", "minItems": 1, "maxItems": MAX_ITEMS, "items": { "type": "object", "properties": {
                    "text": line, "status": { "type": "string", "enum": STATUSES },
                    "detail": { "type": "string", "maxLength": MAX_DETAIL },
                }, "required": ["text", "status"] } },
            }, "required": ["kind", "items"] },
            { "type": "object", "description": "Key/value pairs (two columns) or a comparison; every row has one cell per column.", "properties": {
                "kind": kind("table"), "title": title,
                "columns": { "type": "array", "minItems": 1, "maxItems": MAX_COLUMNS, "items": title },
                "rows": { "type": "array", "minItems": 1, "maxItems": MAX_ROWS, "items": { "type": "array", "items": line } },
            }, "required": ["kind", "columns", "rows"] },
            { "type": "object", "description": "Product choices made, in terms of what the person sees, each with the option set aside.", "properties": {
                "kind": kind("decisions"), "title": title,
                "items": { "type": "array", "minItems": 1, "maxItems": MAX_ITEMS, "items": { "type": "object", "properties": {
                    "text": line, "setAside": line,
                }, "required": ["text"] } },
            }, "required": ["kind", "items"] },
            { "type": "object", "description": "Screenshots: a before/after pair, one screen, or a flow of steps. Image paths (png, jpg, jpeg, webp, 4 MB each), absolute or relative to the worktree.", "properties": {
                "kind": kind("screens"), "title": title,
                "steps": { "type": "array", "minItems": 1, "maxItems": MAX_SCREEN_STEPS, "items": { "type": "object", "properties": {
                    "caption": line, "before": { "type": "string" }, "after": { "type": "string" },
                }, "required": ["caption"] } },
            }, "required": ["kind", "steps"] },
            { "type": "object", "description": "What the user still has to do themselves.", "properties": {
                "kind": kind("left"), "title": title,
                "items": { "type": "array", "minItems": 1, "maxItems": MAX_ITEMS, "items": line },
            }, "required": ["kind", "items"] },
        ] },
    })
}

/// Checks the agent's `blocks` and returns them trimmed, or an error saying how to fix the call.
pub fn parse(list: &Value, tool: Tool) -> Result<Vec<Block>, String> {
    parse_in(list, tool, "blocks")
}

/// `parse`, for blocks given under another name (a report's section, `sections.plan`).
pub fn parse_in(list: &Value, tool: Tool, field: &str) -> Result<Vec<Block>, String> {
    let Some(items) = list.as_array() else {
        return Err(format!(
            "`{field}` must be an array of blocks, each {{kind, ...}}"
        ));
    };
    if items.is_empty() {
        return Err(match tool {
            Tool::Report => format!("`{field}` is empty: leave it out to keep it as it is"),
            Tool::Show => {
                "`blocks` is empty: give at least one block (plain prose goes in your message)"
                    .into()
            }
        });
    }
    if items.len() > MAX_BLOCKS {
        return Err(format!(
            "`{field}` has {} blocks, at most {MAX_BLOCKS}: keep the ones that matter, merge the rest into a text block",
            items.len()
        ));
    }
    items
        .iter()
        .enumerate()
        .map(|(i, v)| block(&format!("{field}[{i}]"), v, tool))
        .collect()
}

fn block(at: &str, v: &Value, tool: Tool) -> Result<Block, String> {
    let at = at.to_string();
    let Some(obj) = v.as_object() else {
        return Err(format!("{at} must be an object {{kind, ...}}"));
    };
    let kind = obj.get("kind").and_then(Value::as_str).unwrap_or_default();
    let instead = match (kind, tool) {
        ("question", _) => Some("a question goes through AskUserQuestion, not a block"),
        ("pr", _) => Some(
            "put the pull request's link in a text block's links or paragraphs: it becomes its live card by itself",
        ),
        ("context", Tool::Report) => Some(
            "say what the screen is for and the problem in a text block of `sections.understood`",
        ),
        ("context", Tool::Show) => Some("say it in your message"),
        _ => None,
    };
    if let Some(instead) = instead {
        return Err(format!("{at}: no `{kind}` block: {instead}"));
    }
    let Some((_, fields, shape)) = SHAPES.iter().find(|(k, ..)| *k == kind) else {
        let kinds: Vec<&str> = SHAPES.iter().map(|s| s.0).collect();
        return Err(format!(
            "{at}.kind must be one of {}, not {}",
            kinds.join(", "),
            if kind.is_empty() { "missing" } else { kind }
        ));
    };
    if let Some(extra) = obj.keys().find(|k| !fields.contains(&k.as_str())) {
        return Err(format!(
            "{at} ({kind}) has no field `{extra}`: a {kind} block is {shape}"
        ));
    }
    let b: Block = serde_json::from_value(v.clone())
        .map_err(|e| format!("{at} ({kind}): {e}; a {kind} block is {shape}"))?;
    check(&at, b)
}

/// Trims what the agent wrote and holds it to the limits.
fn check(at: &str, b: Block) -> Result<Block, String> {
    let title = |t: Option<String>| -> Result<Option<String>, String> {
        let t = t.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
        if let Some(t) = &t {
            short(
                t,
                &format!("{at}.title"),
                MAX_TITLE,
                "a few words; the rest goes in the block",
            )?;
        }
        Ok(t)
    };
    let line = |text: &str, field: String| -> Result<String, String> {
        let text = text.trim();
        if text.is_empty() {
            return Err(format!("`{field}` must not be empty"));
        }
        short(
            text,
            &field,
            MAX_LINE,
            "one line; details go in a text block",
        )?;
        Ok(text.to_string())
    };
    let count = |n: usize, field: &str, min: usize, max: usize| -> Result<(), String> {
        if n < min {
            return Err(format!("{at}.{field} is empty: give at least one"));
        }
        if n > max {
            return Err(format!(
                "{at}.{field} has {n}, at most {max}: keep the ones that matter"
            ));
        }
        Ok(())
    };
    Ok(match b {
        Block::Text(t) => {
            let paragraphs: Vec<String> = t
                .paragraphs
                .iter()
                .map(|p| p.trim().to_string())
                .filter(|p| !p.is_empty())
                .collect();
            count(paragraphs.len(), "paragraphs", 0, MAX_PARAGRAPHS)?;
            for (j, p) in paragraphs.iter().enumerate() {
                short(
                    p,
                    &format!("{at}.paragraphs[{j}]"),
                    MAX_PARAGRAPH,
                    "split it, or keep what the user needs",
                )?;
            }
            count(t.links.len(), "links", 0, MAX_LINKS)?;
            let mut links = Vec::new();
            for (j, l) in t.links.iter().enumerate() {
                let label = line(&l.label, format!("{at}.links[{j}].label"))?;
                if !web_url(&l.url) {
                    return Err(format!(
                        "{at}.links[{j}].url must be an http or https URL, not {}",
                        l.url.trim()
                    ));
                }
                links.push(Link {
                    label,
                    url: l.url.trim().to_string(),
                });
            }
            if paragraphs.is_empty() && links.is_empty() {
                return Err(format!(
                    "{at} (text) says nothing: give it paragraphs or links"
                ));
            }
            Block::Text(Text {
                title: title(t.title)?,
                paragraphs,
                links,
            })
        }
        Block::Callout(c) => {
            if !TONES.contains(&c.tone.as_str()) {
                return Err(format!(
                    "{at}.tone must be one of {}, not {}",
                    TONES.join(", "),
                    c.tone
                ));
            }
            let text = c.text.trim().to_string();
            if text.is_empty() {
                return Err(format!("`{at}.text` must not be empty"));
            }
            short(
                &text,
                &format!("{at}.text"),
                MAX_DETAIL,
                "one short paragraph; more goes in a text block",
            )?;
            Block::Callout(Callout {
                tone: c.tone,
                title: title(c.title)?,
                text,
            })
        }
        Block::Steps(s) => {
            count(s.items.len(), "items", 1, MAX_ITEMS)?;
            let mut items = Vec::new();
            for (j, step) in s.items.iter().enumerate() {
                if !STATUSES.contains(&step.status.as_str()) {
                    return Err(format!(
                        "{at}.items[{j}].status must be one of {}, not {}",
                        STATUSES.join(", "),
                        step.status
                    ));
                }
                let detail = step
                    .detail
                    .as_deref()
                    .map(str::trim)
                    .filter(|d| !d.is_empty());
                if let Some(d) = detail {
                    short(
                        d,
                        &format!("{at}.items[{j}].detail"),
                        MAX_DETAIL,
                        "a line or two on what happened",
                    )?;
                }
                items.push(Step {
                    text: line(&step.text, format!("{at}.items[{j}].text"))?,
                    status: step.status.clone(),
                    detail: detail.map(String::from),
                });
            }
            Block::Steps(Steps {
                title: title(s.title)?,
                items,
            })
        }
        Block::Table(t) => {
            count(t.columns.len(), "columns", 1, MAX_COLUMNS)?;
            count(t.rows.len(), "rows", 1, MAX_ROWS)?;
            let columns: Vec<String> = t.columns.iter().map(|c| c.trim().to_string()).collect();
            for (j, c) in columns.iter().enumerate() {
                short(
                    c,
                    &format!("{at}.columns[{j}]"),
                    MAX_TITLE,
                    "a column's name in a few words",
                )?;
            }
            let mut rows = Vec::new();
            for (j, r) in t.rows.iter().enumerate() {
                if r.len() != columns.len() {
                    return Err(format!(
                        "{at}.rows[{j}] has {} cells for {} columns: give every row one cell per column (an empty string for none)",
                        r.len(),
                        columns.len()
                    ));
                }
                let mut row = Vec::new();
                for (k, cell) in r.iter().enumerate() {
                    let cell = cell.trim();
                    short(
                        cell,
                        &format!("{at}.rows[{j}][{k}]"),
                        MAX_LINE,
                        "a cell is a value, not a paragraph",
                    )?;
                    row.push(cell.to_string());
                }
                rows.push(row);
            }
            Block::Table(Table {
                title: title(t.title)?,
                columns,
                rows,
            })
        }
        Block::Decisions(d) => {
            count(d.items.len(), "items", 1, MAX_ITEMS)?;
            let mut items = Vec::new();
            for (j, c) in d.items.iter().enumerate() {
                let set_aside = c
                    .set_aside
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty());
                if let Some(s) = set_aside {
                    short(
                        s,
                        &format!("{at}.items[{j}].setAside"),
                        MAX_LINE,
                        "the option not taken, in one line",
                    )?;
                }
                items.push(Decision {
                    text: line(&c.text, format!("{at}.items[{j}].text"))?,
                    set_aside: set_aside.map(String::from),
                });
            }
            Block::Decisions(Decisions {
                title: title(d.title)?,
                items,
            })
        }
        Block::Screens(s) => {
            count(s.steps.len(), "steps", 1, MAX_SCREEN_STEPS)?;
            let mut steps = Vec::new();
            for (j, step) in s.steps.iter().enumerate() {
                let path = |p: &Option<String>| {
                    p.as_deref()
                        .map(str::trim)
                        .filter(|p| !p.is_empty())
                        .map(String::from)
                };
                let (before, after) = (path(&step.before), path(&step.after));
                if before.is_none() && after.is_none() {
                    return Err(format!(
                        "{at}.steps[{j}] has no image: give it a before or an after (an image path)"
                    ));
                }
                steps.push(ScreenStep {
                    caption: line(&step.caption, format!("{at}.steps[{j}].caption"))?,
                    before,
                    after,
                });
            }
            Block::Screens(Screens {
                title: title(s.title)?,
                steps,
            })
        }
        Block::Left(l) => {
            count(l.items.len(), "items", 1, MAX_ITEMS)?;
            let items = l
                .items
                .iter()
                .enumerate()
                .map(|(j, item)| line(item, format!("{at}.items[{j}]")))
                .collect::<Result<_, _>>()?;
            Block::Left(Left {
                title: title(l.title)?,
                items,
            })
        }
        // Never parsed from an agent: `block` finds no shape for it.
        Block::Context(c) => Block::Context(c),
    })
}

/// One image slot of a screens block: which block, which step, which side, its path.
pub struct ImageSlot<'a> {
    /// What the blocks are called in the call (`blocks`, `sections.result`).
    pub list: &'static str,
    pub block: usize,
    pub step: usize,
    pub side: &'static str,
    pub path: &'a mut Option<String>,
}

impl ImageSlot<'_> {
    /// How an error names it.
    pub fn field(&self) -> String {
        format!(
            "{}[{}].steps[{}].{}",
            self.list, self.block, self.step, self.side
        )
    }
}

/// Every image the blocks name, in order (the empty slots too).
pub fn images_mut(blocks: &mut [Block]) -> Vec<ImageSlot<'_>> {
    images_in(blocks, "blocks")
}

/// `images_mut`, for blocks given under another name.
pub fn images_in<'a>(blocks: &'a mut [Block], list: &'static str) -> Vec<ImageSlot<'a>> {
    let mut out = Vec::new();
    for (i, b) in blocks.iter_mut().enumerate() {
        if let Block::Screens(s) = b {
            for (j, step) in s.steps.iter_mut().enumerate() {
                out.push(ImageSlot {
                    list,
                    block: i,
                    step: j,
                    side: "before",
                    path: &mut step.before,
                });
                out.push(ImageSlot {
                    list,
                    block: i,
                    step: j,
                    side: "after",
                    path: &mut step.after,
                });
            }
        }
    }
    out
}

/// How many images the blocks name.
pub fn image_count(blocks: &mut [Block]) -> usize {
    images_mut(blocks)
        .iter()
        .filter(|s| s.path.is_some())
        .count()
}

/// An image the window may read from a worktree: an allowed file, under the limit, really
/// inside the worktree (symlinks and `..` resolved).
pub fn image_in(worktree: &Path, path: &str, what: &str) -> Result<PathBuf, String> {
    let (p, _) = crate::report::image(worktree, path, what)?;
    let root = worktree
        .canonicalize()
        .map_err(|e| format!("{}: {e}", worktree.display()))?;
    let real = p
        .canonicalize()
        .map_err(|e| format!("{what}: {}: {e}", p.display()))?;
    if !real.starts_with(&root) {
        return Err(format!(
            "{what}: {} is outside this worktree ({}): save the screenshot inside it so the window can show it",
            p.display(),
            root.display()
        ));
    }
    Ok(real)
}

/// `show`'s whole check: the blocks, then each image where the window will read it.
pub fn check_shown(worktree: &Path, args: &Value) -> Result<usize, String> {
    if args.get("blocks").is_none() {
        return Err("`blocks` is required: the blocks to show, each {kind, ...}".into());
    }
    let mut blocks = parse(&args["blocks"], Tool::Show)?;
    let n = image_count(&mut blocks);
    if n > crate::report::MAX_IMAGES {
        return Err(format!(
            "{n} images, at most {}: keep the screens that matter",
            crate::report::MAX_IMAGES
        ));
    }
    for slot in images_mut(&mut blocks) {
        if let Some(path) = slot.path.as_deref() {
            image_in(worktree, path, &slot.field())?;
        }
    }
    Ok(blocks.len())
}

/// A screen `show` named, for the window: a `data:` URL, only for an image inside one of the
/// app's workspaces (`cwd` must be one), with an allowed extension, under the size limit.
#[tauri::command(async)]
pub fn shown_image(cwd: String, path: String) -> Result<String, String> {
    let catalog = crate::store::saved_catalog();
    if !catalog.workspaces.iter().any(|w| w.path == cwd) {
        return Err(format!("{cwd} is not a workspace"));
    }
    let file = image_in(Path::new(&cwd), &path, "image")?;
    crate::report::data_url(&file).ok_or_else(|| format!("could not read {}", file.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("logit-blocks-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn every_kind() -> Value {
        json!([
            { "kind": "text", "title": " What changed ", "paragraphs": ["One **bold** line.", " "], "links": [{ "label": "PR", "url": "https://github.com/a/b/pull/1" }] },
            { "kind": "callout", "tone": "risk", "text": "Old drafts are deleted after 90 days." },
            { "kind": "steps", "items": [{ "text": "Ran the tests", "status": "done" }, { "text": "E2E", "status": "skipped", "detail": "No browser here." }] },
            { "kind": "table", "columns": ["Key", "Value"], "rows": [["Port", "3400"], ["Host", ""]] },
            { "kind": "decisions", "items": [{ "text": "Hover opens the submenu", "setAside": "Click only" }] },
            { "kind": "screens", "steps": [{ "caption": "The menu", "before": "a.png", "after": "b.png" }] },
            { "kind": "left", "items": ["Merge"] },
        ])
    }

    #[test]
    fn every_kind_parses_trimmed_and_serialises_as_the_window_reads_it() {
        let blocks = parse(&every_kind(), Tool::Show).unwrap();
        assert_eq!(blocks.len(), 7);
        let v = serde_json::to_value(&blocks).unwrap();
        assert_eq!(v[0]["kind"], "text");
        assert_eq!(v[0]["title"], "What changed");
        assert_eq!(v[0]["paragraphs"], json!(["One **bold** line."]));
        assert_eq!(v[2]["items"][1]["detail"], "No browser here.");
        assert!(v[2]["items"][0].get("detail").is_none());
        assert_eq!(v[4]["items"][0]["setAside"], "Click only");
        assert_eq!(v[5]["steps"][0]["before"], "a.png");
        // What is stored reads back.
        let back: Vec<Block> = serde_json::from_value(v).unwrap();
        assert_eq!(back, blocks);
    }

    #[test]
    fn each_mistake_says_how_to_fix_the_call() {
        let err = |b: Value| parse(&json!([b]), Tool::Report).unwrap_err();
        let cases = [
            (
                json!({ "kind": "question", "question": "?" }),
                "AskUserQuestion",
            ),
            (json!({ "kind": "pr", "url": "x" }), "live card by itself"),
            (
                json!({ "kind": "context", "feature": "x" }),
                "`sections.understood`",
            ),
            (json!({ "kind": "chart" }), "must be one of text, callout"),
            (json!({ "paragraphs": ["x"] }), "not missing"),
            (json!("text"), "must be an object"),
            (
                json!({ "kind": "text", "lead": "x", "paragraphs": ["y"] }),
                "has no field `lead`",
            ),
            (
                json!({ "kind": "text", "paragraphs": [" "] }),
                "says nothing",
            ),
            (
                json!({ "kind": "text", "paragraphs": ["x".repeat(601)] }),
                "at most 600",
            ),
            (
                json!({ "kind": "text", "paragraphs": vec!["x"; 7] }),
                "at most 6",
            ),
            (
                json!({ "kind": "text", "links": [{ "label": "x", "url": "file:///etc" }] }),
                "http or https",
            ),
            (
                json!({ "kind": "text", "title": "x".repeat(61), "paragraphs": ["y"] }),
                "blocks[0].title` is 61 characters",
            ),
            (
                json!({ "kind": "callout", "tone": "warning", "text": "x" }),
                "tone must be one of note",
            ),
            (
                json!({ "kind": "callout", "tone": "note" }),
                "missing field `text`",
            ),
            (
                json!({ "kind": "callout", "tone": "note", "text": "x".repeat(301) }),
                "at most 300",
            ),
            (json!({ "kind": "steps", "items": [] }), "items is empty"),
            (
                json!({ "kind": "steps", "items": [{ "text": "x", "status": "ok" }] }),
                "status must be one of done",
            ),
            (
                json!({ "kind": "steps", "items": vec![json!({ "text": "x", "status": "done" }); 17] }),
                "at most 16",
            ),
            (
                json!({ "kind": "table", "columns": ["a", "b"], "rows": [["1"]] }),
                "1 cells for 2 columns",
            ),
            (
                json!({ "kind": "table", "columns": vec!["a"; 7], "rows": [vec!["1"; 7]] }),
                "columns has 7, at most 6",
            ),
            (
                json!({ "kind": "table", "columns": ["a"], "rows": vec![vec!["1"]; 21] }),
                "rows has 21, at most 20",
            ),
            (
                json!({ "kind": "table", "columns": ["a"], "rows": [["x".repeat(161)]] }),
                "a cell is a value",
            ),
            (
                json!({ "kind": "decisions", "items": [{ "text": " " }] }),
                "items[0].text` must not be empty",
            ),
            (
                json!({ "kind": "screens", "steps": [{ "caption": "x" }] }),
                "has no image",
            ),
            (
                json!({ "kind": "left", "items": ["x".repeat(161)] }),
                "at most 160",
            ),
        ];
        for (block, says) in cases {
            let e = err(block.clone());
            assert!(e.contains(says), "{block} -> {e}");
        }
        assert!(parse(&json!([]), Tool::Report)
            .unwrap_err()
            .contains("leave it out"));
        let named = parse_in(&json!([{ "kind": "chart" }]), Tool::Report, "sections.plan");
        assert!(named
            .unwrap_err()
            .contains("sections.plan[0].kind must be one of"));
        assert!(parse(&json!([]), Tool::Show)
            .unwrap_err()
            .contains("at least one block"));
        assert!(parse(&json!({}), Tool::Show)
            .unwrap_err()
            .contains("must be an array"));
        let many: Vec<Value> = (0..13)
            .map(|_| json!({ "kind": "left", "items": ["x"] }))
            .collect();
        assert!(parse(&json!(many), Tool::Show)
            .unwrap_err()
            .contains("at most 12"));
        let context = parse(&json!([{ "kind": "context" }]), Tool::Show).unwrap_err();
        assert!(context.contains("in your message"));
    }

    #[test]
    fn shown_images_must_be_real_files_inside_the_worktree() {
        let root = temp("shown");
        let wt = root.join("wt");
        std::fs::create_dir_all(wt.join("shots")).unwrap();
        std::fs::write(wt.join("shots/a.png"), b"png!").unwrap();
        std::fs::write(root.join("outside.png"), b"png!").unwrap();
        std::fs::write(wt.join("shots/a.gif"), b"gif!").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(root.join("outside.png"), wt.join("shots/link.png")).unwrap();
        let args = |after: &str| json!({ "blocks": [{ "kind": "screens", "steps": [{ "caption": "c", "after": after }] }] });
        assert_eq!(check_shown(&wt, &args("shots/a.png")).unwrap(), 1);
        let abs = wt.join("shots/a.png").to_string_lossy().to_string();
        assert_eq!(check_shown(&wt, &args(&abs)).unwrap(), 1);
        for (path, says) in [
            ("../outside.png", "outside this worktree"),
            ("shots/link.png", "outside this worktree"),
            ("shots/none.png", "no file"),
            ("shots/a.gif", "png, jpg"),
        ] {
            let e = check_shown(&wt, &args(path)).unwrap_err();
            assert!(
                e.contains(says) && e.contains("blocks[0].steps[0].after"),
                "{path} -> {e}"
            );
        }
        assert!(check_shown(&wt, &json!({}))
            .unwrap_err()
            .contains("is required"));
        let many: Vec<Value> = (0..9)
            .map(|_| json!({ "caption": "c", "before": "shots/a.png", "after": "shots/a.png" }))
            .collect();
        let e = check_shown(
            &wt,
            &json!({ "blocks": [{ "kind": "screens", "steps": many }] }),
        )
        .unwrap_err();
        assert!(e.contains("steps has 9, at most 8"), "{e}");
    }
}
