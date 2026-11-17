//! Chat backgrounds are files: each `.js` in `<data>/backgrounds` is a scene (the body of a
//! `(p, hash, flicker) => void` function) that the webview draws in a sandboxed worker. The
//! user makes new ones by asking Claude in a chat, which writes a file here; the app lists
//! the folder. Kites and Koi are seeded once, as if the user had made them: deletable.

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::store::{data_dir, write_atomic};

const SEEDS: &[(&str, &str)] = &[
    ("kites.js", include_str!("../backgrounds/kites.js")),
    ("koi.js", include_str!("../backgrounds/koi.js")),
];
/// How a scene is written, for Claude: kept up to date at every listing.
const GUIDE: &str = include_str!("../backgrounds/README.md");
/// A scene is a few hundred lines; a bigger file is not one.
const MAX_SIZE: u64 = 200_000;

#[derive(Serialize)]
pub struct Background {
    /// The file's name without `.js`.
    id: String,
    name: String,
    code: String,
}

#[derive(Serialize)]
pub struct Backgrounds {
    dir: String,
    scenes: Vec<Background>,
}

pub fn backgrounds_dir() -> PathBuf {
    data_dir().join("backgrounds")
}

/// The folder, made and seeded the first time; the guide rewritten when it changed.
fn ensure(dir: &Path) -> Result<(), String> {
    if !dir.exists() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        for (file, code) in SEEDS {
            write_atomic(&dir.join(file), code)?;
        }
    }
    let guide = dir.join("README.md");
    if std::fs::read_to_string(&guide).ok().as_deref() != Some(GUIDE) {
        write_atomic(&guide, GUIDE)?;
    }
    Ok(())
}

/// `// name: Night forest` on the first line, else the id in words.
pub fn name_of(id: &str, code: &str) -> String {
    let first = code.lines().next().unwrap_or_default().trim();
    let named = first
        .strip_prefix("//")
        .map(str::trim)
        .and_then(|l| l.strip_prefix("name:").or_else(|| l.strip_prefix("Name:")))
        .map(str::trim)
        .filter(|n| !n.is_empty());
    match named {
        Some(n) => n.chars().take(32).collect(),
        None => {
            let words = id.replace(['-', '_'], " ");
            let mut chars = words.chars();
            chars
                .next()
                .map(|c| c.to_uppercase().chain(chars).collect())
                .unwrap_or_default()
        }
    }
}

/// An id that names a file in the folder and nothing else.
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Every scene in the folder, oldest first (the order they were made in).
pub fn list_in(dir: &Path) -> Vec<Background> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut found: Vec<(u128, Background)> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let id = path
                .file_name()?
                .to_str()?
                .strip_suffix(".js")?
                .to_string();
            let meta = entry.metadata().ok()?;
            if !valid_id(&id) || !meta.is_file() || meta.len() > MAX_SIZE {
                return None;
            }
            let code = std::fs::read_to_string(&path).ok()?;
            let made = meta
                .created()
                .or_else(|_| meta.modified())
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_millis());
            Some((
                made,
                Background {
                    name: name_of(&id, &code),
                    id,
                    code,
                },
            ))
        })
        .collect();
    found.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.id.cmp(&b.1.id)));
    found.into_iter().map(|(_, b)| b).collect()
}

#[tauri::command(async)]
pub fn backgrounds_list() -> Result<Backgrounds, String> {
    let dir = backgrounds_dir();
    ensure(&dir)?;
    Ok(Backgrounds {
        dir: dir.to_string_lossy().into_owned(),
        scenes: list_in(&dir),
    })
}

#[tauri::command]
pub fn background_delete(id: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("not a background".into());
    }
    std::fs::remove_file(backgrounds_dir().join(format!("{id}.js"))).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_a_scene() {
        assert_eq!(name_of("x", "// name: Night forest\np.sky([])"), "Night forest");
        assert_eq!(name_of("night-forest", "p.sky([])"), "Night forest");
        assert_eq!(name_of("koi", SEEDS[1].1), "Koi");
    }

    #[test]
    fn keeps_ids_inside_the_folder() {
        assert!(valid_id("night-forest"));
        assert!(!valid_id("../settings"));
        assert!(!valid_id(""));
    }

    #[test]
    fn lists_only_scenes() {
        let dir = std::env::temp_dir().join(format!("logit-bg-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        ensure(&dir).unwrap();
        std::fs::write(dir.join("notes.txt"), "x").unwrap();
        let ids: Vec<String> = list_in(&dir).into_iter().map(|b| b.id).collect();
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&"kites".to_string()) && ids.contains(&"koi".to_string()));
        assert!(dir.join("README.md").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
