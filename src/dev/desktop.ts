// The preview has no desktop to show through a see-through window: it draws a stand-in
// wallpaper behind the page, and frosts it as macOS would under each material. Dev only.

const STYLE = `
html[data-fake-desktop] {
  background:
    radial-gradient(circle at 78% 22%, #ffd9a0 0 7%, transparent 7.2%),
    linear-gradient(172deg, transparent 0 58%, #2f5d50 58.2% 100%),
    linear-gradient(186deg, transparent 0 66%, #1f4038 66.2% 100%),
    linear-gradient(160deg, transparent 0 48%, #6f8fa8 48.2% 62%, transparent 62.2%),
    repeating-linear-gradient(90deg, rgb(255 255 255 / 0.08) 0 2px, transparent 2px 120px),
    linear-gradient(180deg, #e98b5f 0%, #c5617a 38%, #4a4f8c 70%, #20264d 100%);
}
html[data-fake-desktop='soft'] body {
  -webkit-backdrop-filter: blur(28px) saturate(1.6);
  backdrop-filter: blur(28px) saturate(1.6);
  background:
    var(--ground-layer),
    rgb(236 236 236 / 0.55);
}
html[data-fake-desktop='strong'] body {
  -webkit-backdrop-filter: blur(44px) saturate(1.4);
  backdrop-filter: blur(44px) saturate(1.4);
  background:
    var(--ground-layer),
    rgb(28 28 30 / 0.55);
}
`

let styled = false

/** What `window_ground` would do natively: the wallpaper shows, plain or frosted. */
export function fakeDesktop(effect: string) {
  if (!styled) {
    styled = true
    const style = document.createElement('style')
    style.textContent = STYLE
    document.head.append(style)
  }
  const root = document.documentElement
  if (effect === 'solid') delete root.dataset.fakeDesktop
  else root.dataset.fakeDesktop = effect
}
