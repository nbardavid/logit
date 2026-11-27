//! The window's ground, natively: the window is always made transparent (it can't become so
//! later), the page paints its own colour over it, and when that colour lets the desktop
//! through, macOS blurs what is behind (an NSVisualEffectView behind the window, as Yab does).

use tauri::window::{Effect, EffectState, EffectsBuilder};
use tauri::{Runtime, Window};

/// The material for each of the picker's choices: none for an opaque or plainly clear ground,
/// a light frost (sidebar) for soft, Yab's heavier, darker HUD for strong. macOS gives no
/// blur radius: the materials are the scale.
pub fn material(effect: &str) -> Result<Option<Effect>, String> {
    match effect {
        "solid" | "clear" => Ok(None),
        "soft" => Ok(Some(Effect::Sidebar)),
        "strong" => Ok(Some(Effect::HudWindow)),
        other => Err(format!("unknown window effect: {other}")),
    }
}

/// Puts the material behind the window, or takes it away; live, no window remade.
#[tauri::command]
pub fn window_ground<R: Runtime>(window: Window<R>, effect: String) -> Result<(), String> {
    let config = material(&effect)?.map(|m| {
        EffectsBuilder::new()
            .effect(m)
            // Active even when the window isn't in front, so it doesn't go flat on blur.
            .state(EffectState::Active)
            .build()
    });
    window.set_effects(config).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_choice_has_its_material() {
        assert!(material("solid").unwrap().is_none());
        assert!(material("clear").unwrap().is_none());
        assert!(matches!(material("soft").unwrap(), Some(Effect::Sidebar)));
        assert!(matches!(
            material("strong").unwrap(),
            Some(Effect::HudWindow)
        ));
        assert!(material("frosted").is_err());
    }
}
