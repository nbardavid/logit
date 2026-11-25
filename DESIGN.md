# logit desktop — design

The bar: a product, not a tool. Everything on screen is deliberate, aligned and finished;
everything that moves, moves smoothly and for a reason. If a detail looks "good enough", it
isn't. Reference for layout, density and feel: Conductor.build. For craft: Linear, Things.

## Principles

- **Canvas.** The window is a ground (`ground`, warm grey unless the user picks another); the
  sidebar sits right on it, and the chat and the right panel are white sheets lifted off it
  (12px radius, `shadow-sheet`, 10px apart and 10px from the window's top, bottom and right edges and from the sidebar: one
  gap, everywhere). Inside a sheet, nothing is boxed for show: work
  is quiet lines, sections sit under small muted labels, rows have no borders.
- **Calm.** One accent (the ink), monochrome icons. Colour only says what needs attention
  (working, waiting, failing, done), and only as a 6px dot or a word, never a fill or a band.
  No decoration, no gradients for show, no hatching.
- **Air, not density.** Lists breathe (sidebar rows 30px, right-panel rows 32px, projects
  20px apart), each row says one or two things, and whitespace does the grouping before any
  hairline does. 13px chrome and 15px prose in a calm 680px reading column. Show what
  matters; keep the rest quiet (`faint` / `label` ink) rather than gone.
- **Square and aligned.** Every edge lines up with something: bar heights (44px), the 10px
  gap, panel paddings, list insets, icon centres. Small radii (4–8px; 12px for sheets and
  floating surfaces). A misaligned pixel is a bug.
- **Native.** System font, macOS shortcuts, no browser feel: no text selection outside text,
  no focus ring on click, no web-style hover delays, no page-like scroll jumps.
- **Keyboard first.** Every action reachable from the keyboard; the focused item is always
  visible and in view.

## Motion

Motion explains change: where something came from, what replaced what. Never ornamental,
never in the way. Every state change that would otherwise "pop" gets a transition.

| What                                            | Duration  | Curve       | Movement                                                |
| ----------------------------------------------- | --------- | ----------- | ------------------------------------------------------- |
| Hover / pressed colours                         | 120ms     | ease-out    | colour only                                             |
| Menus, popovers, combos, tooltips (enter)       | 140–160ms | ease-out    | fade + 2–4px slide from the anchor, scale 0.98 → 1      |
| Same (exit)                                     | 100–120ms | ease-in     | fade only                                               |
| Composer dialog                                 | 180ms     | ease-out    | fade + 6px rise; veil (12 % ink) fades                  |
| New message / block / card                      | 200–280ms | ease-out    | fade + 6px rise; only what arrives (`enter.tsx`)        |
| Expand / collapse (tool rows, "Show all")       | 180ms     | ease-in-out | height + fade, no jump                                  |
| A question answered (its card folds away)       | 180ms     | ease-in-out | height + fade; its one-line record rises in its place   |
| Tabs: open, close, reorder                      | 160ms     | ease-out    | width and position slide; neighbours make room          |
| Panels (sidebar ⌘S, git ⌥⌘B)                    | 200ms     | ease-in-out | layout lands at once; transform slide (FLIP), no reflow |
| Status changes (dots, badges, counts)           | 160ms     | ease-out    | cross-fade; waiting dots breathe (opacity only)         |
| Sidebar row finishes / waits (flash)            | 1.2s      | ease-out    | opacity only: swell, hold, fade back to nothing         |
| Inline confirmations (⌘W twice, discard, merge) | 120ms     | ease-out    | label cross-fade in place, no layout shift              |
| Clean up (a merged workspace leaves)            | 340–760ms | per style   | Dust, Brush or Glint (Settings › Appearance)            |
| Chat background (picked, or changed)            | 300ms     | ease-out    | fade in; the scene then plays at 24 fps, cell by cell   |
| Task page splits in (a workspace with a page)   | 200ms     | ease-in-out | the right panel opens at 40 % (≤ 560px), as panels do   |
| Sidebar: Parked group folds / unfolds           | 180ms     | ease-in-out | grid rows and fade, the chevron turns                   |
| "Needs you": ⌘0 finds nothing                   | 160ms     | ease-out    | label cross-fades to "Nothing needs you", 1.6s, back    |
| Window colour picker (enter / exit)             | 150 / 110 | out / in    | the popover's: fade + zoom 0.98 from the anchor / fade  |
| Window colour: a drag on the field or a slider  | per frame | none        | the ground follows each frame (CSS variables on rAF)    |
| Window colour: a preset or an arrow key         | ~400ms    | spring      | Yab's 0.27 s / 0.65 spring, a little past and back      |
| Window colour: − / +                            | ~250ms    | spring      | linked dots part or close up (Yab's 0.2 s / 0.75)       |
| Window colour: preset pages ‹ ›                 | ~450ms    | spring      | slide a page, no give (Yab's 0.32 s / 1)                |

- "settle" is `--ease-settle` (`cubic-bezier(0.2, 0, 0, 1)`): long, soft landings.
- Animate `opacity` and `transform`; animate size only where the layout must move.
- Nothing above 300ms, except Clean up's send-off, which plays once the worktree is gone and
  blocks nothing, a sidebar row's flash, a notification that moves nothing, and the chat
  background, a scene the user chose that plays behind everything and stops when motion is reduced. Nothing that delays an action the user already took.
- Respect `prefers-reduced-motion`: keep fades, drop movement.
- Entrances play for what is new, never for what was already there: a chat switched back to,
  the sidebar shown again, a task page for another workspace draw at once. `EnterScope` and
  `In` (`app/enter.tsx`) decide it per element as it mounts.
- Panels stay mounted while hidden: their box takes its final width at once and the sheet
  slides in by `transform` (Web Animations), the content beside it following by FLIP. Nothing
  reflows mid-way; reduced motion skips the slide.
- A tw-animate `duration-N` sets `transition-duration`: elements with `animate-in`/`animate-out`
  have `transition-property: none`, so it never leaves a `transition: all` behind.
- Status loaders always light at least three dots: a frame with fewer reads as a flicker.
- A chat keeps where it was read. Switched back to, it opens on the same exchange (or at the
  end if it was following); what arrived meanwhile shows as an "N new" pill with a chevron
  in the ↓ button's place, which scrolls to the end.
- Use tw-animate (`animate-in`, `fade-in`, `slide-in-from-*-[Npx]`, `zoom-in-[0.98]`) and
  Tailwind transitions; tw-animate only accepts whole steps or bracketed values.

## States

Every surface is designed in all its states before it ships:

- empty (with the keyboard path to fill it), loading (skeleton or quiet spinner, never a
  blank flash), error (says what failed and what to do, no "Error:" prefix), long content
  (truncation with full text on hover, at 1000px wide), disabled (why, in a tooltip);
- hover, pressed, keyboard focus (`focus-visible` only), selected, current;
- the working / waiting / done / failing signals, consistent everywhere they appear.

## Tokens

Colours, radii, shadows and type live as CSS variables in `src/styles.css` and are used
through Tailwind utilities (`bg-background`, `text-muted-foreground`, `border-border`,
`text-faint`, `bg-ground`, `h-bar`, `h-gap`, `shadow-sheet`…). No raw hex in components; add a
token when one is missing (the exceptions: the workspace colours in `model/names.ts`, the
project avatar tones and the terminal theme). Light only for now; themes come from the same
variables. Change a value here and in `styles.css` together; `?gallery` in the browser preview
shows them all.

**Surfaces are neutral, inks are warm.** Fills carry no beige; the warmth is in the text.

**Surfaces.** Three levels: the `ground` (window, sidebar), the white sheets on it (chat,
right panel; `rounded-xl shadow-sheet`), and floating surfaces over
everything (menus, popovers, dialogs; `shadow-popover`/`shadow-dialog`). Inside the sidebar,
the selected row is a white pill (`bg-background shadow-pill`); hover is `ground-hover`.
Between sheets the 10px gap is the resize handle: invisible at rest, a 1px line on hover.

**The ground is the user's.** The palette button in the sidebar footer, beside Settings
(⌘P's "Window colour" opens it there too, showing the sidebar first), or Settings ›
Appearance › Window colour, opens the picker above its button (Esc or a click outside closes
it; the focus goes back to the button). No right-click menu: a menu of one item reads as
unfinished. The picker is a port of Yab's
space look card (github.com/yetanotherbrowser/yab, Apache-2.0; credited in `ground.ts` and
`ground-picker.tsx`), 290 wide, 12 in: a dot field (a dot every 10px in the colour the handle
would give there, swelling under a lens near it; hue round the middle, more colour outwards;
the 36px handle ringed in white; − and + add or take a linked colour, up to two, which make the
window a gradient from its top left), Yab's presets (five pages of nine: Colors, Gradients,
Pastels, Muted, Grays; ‹ › slide a page; no mark on the one picked), then Yab's two sliders,
Transparency as a wave flattening past the pill and Grain as scattered dots, and Blur once the
window is see-through. Lightness comes from the presets only, as in Yab. It is
kept as one JSON string, `appearance.ground`; unset, the tokens below are untouched.
A pick is worn as Yab wears it on Liquid Glass (`WindowGlassPolicy.transparency(for:)`): a
colour at transparency 0.8 (a third of it), a gray at 0.6 (half), over a light glass that runs
from `#f8f8f6` top left to `#e2e1de` bottom right, so a vivid pick turns pastel, keeps its hue,
and always carries a gentle gradient; linked colours spread along the same diagonal. A mid gray
that neither ink reads on gets more of its colour, two points at a time (Yab's veil rule).
`ground-store.ts` sets `--ground` (the main colour, opaque), `--ground-paint` (the window's
paint: a colour or a gradient, translucent below 100 % opacity), `--ground-tint` and
`--ground-layer` (the main colour, and the paint as an image), `--ground-hover` (an overlay: ink 4.5 %, or white 10 % on dark), `--grain`
and `--grain-tile` on the root. Body paints the ground once; nothing else paints it, so the
sidebar is transparent on it. Grain is one static 128px noise tile under every surface
(`body::before`), so only the ground wears it, at no cost per frame.
The sidebar's inks are worked out from the ground (`.ground-inks`, `--gi-*`): light on a dark
ground, each kept at its contrast (text 4.5:1, icons 2.9, labels 2.3) over the worst desktop
that can show through, and opacity is held no lower than the main ink needs (the picker says
so). The selected row stays a white pill with the app's own inks; sheets, popups and dialogs
stay opaque white. Panels' own neutral lists (Settings' nav, git's files) use `well`, never
the ground.
**See-through.** The window is always created transparent (macOS can't make it so later);
below 100 % opacity the desktop shows through, and Blur puts a native material behind the
window (`window_ground`, NSVisualEffectView, behind-window, always active): None is plain
transparency, Soft the light `sidebar` material, Strong Yab's darker `hudWindow`. macOS gives
materials, not a blur radius. The preview fakes a wallpaper behind the page (`src/dev/desktop.ts`).

**Surfaces are layers over the scene.** With a chat background on, the scene fills the window
and every pane sits on it. Panes around the chat take `glass` (`styles.css`): white at 50 %,
blurred 24px, and inside them `background`, `chrome` and `sidebar` turn translucent and
hairlines become ink at 8 %. The chat pane stays open, with a veil behind its column. Popups,
menus and dialogs stay opaque. A new pane is designed as a layer: glass, or open.

### Type

Every size in a component comes from this scale; no `text-[13.5px]` and the like. System
font; mono (`font-mono`, Geist Mono) only for code, tool commands, counts and branch names,
never for file names.

| Utility      | Size / line | Weight    | Use                                                                                                      |
| ------------ | ----------- | --------- | -------------------------------------------------------------------------------------------------------- |
| `text-2xs`   | 11 / 14     | 500       | badges and inbox counts only                                                                             |
| `text-xs`    | 12 / 16     | 400 / 500 | ages, hints, section labels, footers, counts, chips, shortcuts                                           |
| `text-sm`    | 13 / 18     | 400 / 500 | all chrome: sidebar, tabs, menus, file rows, buttons (the body)                                          |
| `text-base`  | 14 / 22     | 400 / 600 | a prompt (medium), composer text, top-bar title, PR status, card titles                                  |
| `.md`        | 15 / 24     | 400       | Claude's answers (h1 18/26, h2 16/24, h3–h4 15/24, all 600)                                              |
| `text-md`    | 15 / 24     | 400 / 500 | prose outside markdown: a question card's question (15/22)                                               |
| `text-title` | 18 / 26     | 600       | a report's title (the Report tab)                                                                        |
| `text-lg`    | 20 / 28     | 600       | empty-state titles only                                                                                  |
| `text-mono`  | 12.5 / 20   | 400       | code blocks, diffs, a tool's target (with `font-mono`); 13 for inline code in prose, 12 inline in chrome |

`text-2xs` and `text-lg` carry their weight; the others take `font-medium` or
`font-semibold` where the table allows. No arbitrary sizes, line heights or tracking
(`text-[13.5px]`, `leading-[22px]`): the scale's steps (`leading-4.5`, `leading-5.5`,
`tracking-wide`) cover them.

### Colour

| Token                                                        | Value                             | Use                                                                                                              |
| ------------------------------------------------------------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `background`, `card`, `popover`                              | `#ffffff`                         | the sheets (chat, right panel), popups, dialogs, the selected sidebar row's pill                                 |
| `ground`, `sidebar`                                          | `#efeeec`                         | the window's ground, which the sidebar sits on                                                                   |
| `ground-hover`                                               | `#e7e6e3`                         | a hovered row on the ground                                                                                      |
| `ground-paint`                                               | `ground`                          | what the window paints: the picked ground at its opacity                                                         |
| `well`                                                       | `#efeeec`                         | a panel's own neutral list (Settings' nav, git's files); never the picked ground                                 |
| `foreground`, `primary`                                      | `#1d1c1a`                         | ink: text, the ink button (the one accent)                                                                       |
| `ink-soft`                                                   | `#2e2c2a`                         | a tool's target, command output                                                                                  |
| `sidebar-foreground`                                         | `#3b3936`                         | sidebar rows                                                                                                     |
| `muted-foreground`                                           | `#6f6b67`                         | secondary text, work lines                                                                                       |
| `faint`                                                      | `#8f8a85`                         | icons, meta, hints, shortcuts, section labels                                                                    |
| `label`                                                      | `#a29d97`                         | placeholders, a file row's status square                                                                         |
| `chrome`                                                     | `#fbfaf9`                         | the permission row on top of the composer                                                                        |
| `code`, `bubble`                                             | `#f7f6f4`                         | code blocks, tool output, command cards (no border)                                                              |
| `muted`, `accent`, `secondary`, `hover`                      | `#f4f3f1`                         | hover, the current tab's pill, the segmented control's track, inline code, the secondary button                  |
| `active`                                                     | `#efeeec`                         | a selected row inside a sheet                                                                                    |
| `border`                                                     | `#efeeec`                         | hairlines inside sheets (under a bar)                                                                            |
| `sidebar-border`                                             | transparent                       | the sidebar has no edges: the sheets do the separating                                                           |
| `input`, `line-strong`                                       | `#e8e6e3`                         | field borders, the composer's ring, a disabled send                                                              |
| `tick`                                                       | `#dcdbd9`                         | the turn ruler's ticks                                                                                           |
| `line-ink`                                                   | `#4a4744`                         | the ink button's hover                                                                                           |
| `tan`, `ring`                                                | `#c29c87`                         | the caret, ::selection; focus ring                                                                               |
| `good` / `good-ink` / `good-wash`                            | `#3c9a5f` / `#2f6b3e` / `#f3f8f3` | done, passed, added; green text                                                                                  |
| `warn` / `warn-ink` / `warn-wash`                            | `#d6951c` / `#7a5a08` / `#fbf4e2` | waiting; amber text; an assumption callout, a warning mark                                                       |
| `critical`, `destructive` / `critical-ink` / `critical-wash` | `#d04a3c` / `#b8463a` / `#fbf3f2` | failing, deleted, destructive fills; red text (a failed tool line, a truly blocked PR's headline), the error box |
| `merge` / `merge-hover`                                      | `#2a8045` / `#23713b`             | the Merge button (4.9:1 under white text)                                                                        |
| `neutral`                                                    | `#b4b8bf`                         | a setup script never run                                                                                         |

Text on a wash uses the ink, never the plain status colour.

### Radii

`--radius` is 8px. `rounded-sm` 4 (inline code, key caps), `rounded-md` 6 (rows, chips,
small buttons), `rounded-lg` 8 (buttons, cards, the composer, code blocks), `rounded-xl` 12
(the sheets, menus, popovers, ⌘P, the ⌘N dialog, the composer). The sidebar's pill rows 7px,
the segmented control's track 7px around 5px items. Nothing else: `rounded-2xl` and up don't exist.
`rounded-full` for dots, bars and ticks.

### Heights

`h-bar` 44 for every bar on a sheet's top edge (and the bottom strips), so their hairlines
line up; `gap` 10 between and around the sheets (chat ↔ panel = panel ↔ edge = top = bottom, while
dragging too; the native page in the right panel follows its placeholder inside the sheet). Rows: menus 28 (`h-7`), work lines (tools,
thoughts, groups, agents) 28, tabs 28 pills in the 44 bar, nav 28, popover rows 32, ⌘P rows
36 (one line) or 48 (two), sidebar workspace rows 30, 2px apart: a 6px dot (or the loader),
the task, then at the right the state word when it matters, the colour word and the age in
small `faint` ink; the hover tools cover the meta. The task wins the room: it keeps 54 % of
the row (or all it needs) before truncating, the meta gives way first, and on a sidebar
under 320px a row with a state word or a count drops its colour word (kept in the tooltip). File and check rows 32 in the right panel,
under 24px section labels, sections 24px apart; segmented-control items 24. The
queued-prompt line in the composer 36, the permission row 40. Chat: exchanges 24px apart,
blocks in a turn 12px apart, the column 680px. Controls inside bars: `h-7`. Status dots 6px.

### Shadows

- `shadow-popover`: menus, popovers, ⌘P (a 1px ring and a soft drop).
- `shadow-dialog`: the ⌘N dialog.
- `shadow-sheet`: the chat and the right panel float a little above the ground: a 0.5px
  ring at 6 %, a tight 1–3px contact shadow at 6 % and a wide, low ambient one (40px blur,
  10px in, 14 %). Never a hard edge.
- `shadow-pill`: the selected sidebar row and the segmented control's current item.
- `shadow-composer` (`-focus`): the composer, a 1px `input` ring and a soft 16px drop.
- Code blocks, command cards and tool output have none, and no border either.

### Primitives

- `Kbd` (`components/ui/kbd.tsx`): a shortcut as a plain glyph, `text-xs text-faint`,
  sans, no box. On the ink button, add `text-white/60`. Two boxed key caps only: ⌘P's footer
  legend (`KbdBox`, local to picker.tsx) and an option row's number (below).
- Menus (`components/ui/menu.tsx`, `context-menu.tsx`, the app's `context-menu.tsx`): one
  look from `lib/menu-styles.ts`: 28px rows, 14px faint icons that ink on highlight,
  shortcuts as glyphs (`MenuShortcut`, `ContextMenuShortcut`, or `shortcut` on a
  `MenuAction`), destructive rows in `critical-ink`, edge-to-edge separators, 24px group
  labels. Every row of a right-click menu leads with its 14px icon and shows its shortcut when
  it has one. Popovers that list things (the inbox, the combobox) share the popup.
- `Dialog`: a light veil (`foreground` at 12 %), `rounded-xl`, 180ms rise. ⌘P uses it with
  no veil and a 4px drop. Settings is an opaque sheet on a fainter veil (6 %), so it reads
  anchored while a background picked still shows around it.
- The right panel's tabs (Report, Git, Artifacts) are a segmented control in its 44px bar:
  a `muted` track, the current item a white pill. Git's count shows when the panel is wide
  enough. CI is no tab of its own: its checks are a section of the Git view.
- The Git view's head (`git-panel.tsx`): the PR as one line, a 6px dot, `#N`, `·` and its
  headline ("Checks failing", in `critical-ink` only when the merge is truly blocked; a
  loader while GitHub decides), then its title in `text-title`, a meta line (+/−, files,
  head → base) and its buttons: Merge in the full `merge` green when it can be pressed, a
  quiet grey button naming why when it can't (except "Push first": Push alone says it), Push, and GitHub (outline).
  ⌘P's Merge opens the Git view and asks there. Without a PR, the branch and its ↑/↓ counts
  (the workspace's branch until git answers), Push / Ask for PR. Under it: Checks (dot, name,
  state word), Description, Staged, Changes, each under a `faint` label, rows borderless; a
  file's status is a monochrome square, its +/− the only colour.
- The chat (`transcript.tsx`): a prompt is a `text-base font-medium` line under a small
  `faint` "You", no bubble. Work is quiet lines: a 14px monochrome icon (the loader while it
  runs), a verb ("Ran", "Read", "Searched") and the mono target in `ink-soft`; a failure says
  "· failed" in `critical-ink`. Agents are lines too (kind · title, status, tool count).
- The permission request (`chat-view.tsx`) is one row on top of the composer, on `chrome`:
  a waiting dot, the tool and its mono target, then Deny ⌘⌫ and Always allow ⇧⌘↩ (ghost)
  and Allow ⌘↩ (ink).
- Tabs (`tab-bar.tsx`): plain text, the current one a `muted` pill, no underline.
- ⌘P lists places, then actions (New chat, Push, Merge #N, Settings › a pane…), each with its
  shortcut at the right. Typed, a label starting with the query ranks first, then one with a
  word starting with it, then anywhere; ties keep the latest first. Workspaces read by their
  task, the colour word as meta.
- Scrollbars: none styled. WKWebView draws macOS overlay scrollbars that hide when idle;
  only the tab strip hides its own.

### Cards

A card is something live that a chat or a report names: a PR today (`cards/pr-card.tsx`), a
ticket or a file later. They all use one frame, `CardFrame` in `cards/frame.tsx`. The same
card draws in a chat and in a report, so the two never drift.

- **Anatomy**: a `rounded-lg` hairline box on `background`, padded 14 / 12, with `gap-3`.
  - A 32px `rounded-md` tile with a 16px icon: `chrome`, or a good / critical wash once done
    or failing.
  - Two lines. The title is `text-base` 14/22, medium; clicking it opens the thing. The meta
    is `text-xs` 12/16 `faint`: items `gap-x-3`, mono for branches and counts, a status `Dot`
    before a state.
  - At most one action, at the right, centred on the two lines (`Button size="sm"`).
  - A notice under a hairline, 12/16. A failure gets a `critical-wash` and its Retry. A quiet
    note ("Couldn't refresh it", while what showed stays) is on `chrome`.
- **Narrow**: below 420px of card the tile goes and the title may take two lines. Below
  320px the action moves under the text. Meta items wrap whole and never break inside, and a
  long branch truncates with its full name on hover.
- **States**:
  - Loading: skeleton bars where the title and meta go, and a still box the action's size, so
    nothing moves when it lands. If the agent wrote something about the thing, that draws
    instead of the skeleton.
  - Failed with nothing to show: a muted generic title plus the error notice.
  - Disabled action: shown, with the reason in a `data-tip`.
  - Done (merged): Merge goes, and a calm good tile and badge show. When the PR's head is the
    branch of the card's own workspace (a chat's, a report's), "Delete workspace" (secondary,
    critical once armed) takes its place: the git panel's Clean up, its send-off included. A
    refusal stays on the card; uncommitted changes turn it into "Delete anyway". Someone
    else's PR offers nothing.
- **Actions** confirm in place, with no dialog. The first click (or Enter) arms the button:
  its label becomes "Confirm" and the meta line asks the question. A risky action turns the
  button `critical`. The button falls back to rest after 5 s, on blur, on a click elsewhere,
  or on Esc, and Esc goes no further. While the action works, the button keeps its colour
  and shows the white loader. When it is done, focus moves to the title.
- **Motion**: the card enters with the block it follows (200–280ms rise). Labels and
  statuses cross-fade (160ms, `SWAP`). The armed label swaps in 120ms without changing the
  button's width: its labels are stacked in one grid cell. The notice folds open over 180ms
  (grid rows and fade).
- **Cost**: a card reads its source only while it is in view, at most two at a time, and
  shares the result with every other card of the same thing. It reads again when the window
  comes back (if the last read is older than 10 s), every 15 s while it settles (checks
  running), and after its action. Nothing polls in the background.

### Option rows

Claude's questions (`app/question-card.tsx`) are the agent speaking, not a form.

- **The question** reads in the text column: its short header as a `text-xs` faint eyebrow
  above (with "Pick any" for a multi-select), then the question in `text-md`, medium. No box
  around it.
- **The options** are one grouped list, a hairline between rows, in the cards' frame
  (`rounded-lg` hairline on `background`). Each
  row is padded 14 / 10: a 20px number cap (`rounded-sm` hairline, `text-xs` faint), the label
  `text-base` regular ink, the description under it `text-sm` muted. Both wrap, never cut.
  "Recommended" is a `text-xs` faint word at the row's right, on the label's line.
- **States**: hover `hover` (120ms); pressed `active`; picked, the cap inks (`foreground`
  fill, white number, 160ms) on a `chrome` wash, the mark stays; focus the inset tan ring.
- **No form in a chat**: the composer is the free answer, so the card has no field. One
  single-choice question answers on click; a hint line under it says so ("Pick one, or type
  your own answer below"), with Skip (⌘⌫) as a quiet text action. While the question waits
  and the composer is empty, the composer's Stop gives way to a "Waiting for you" word with a
  breathing warn dot; typing brings Send back. Several questions or a multi-select add a progress count and one Send. A free
  answer typed while other questions wait shows as a picked row of its own (a pencil cap).
- **Asked once**: the chat's card is the only place a question is asked. The task page beside
  it shows its state ("Question"), never the question again.
- **Where it stands**: the last item of the transcript, scrolling with it. Scrolled out of view, one slim "Claude asks" line stands at
  the bottom (over the composer in a chat) and goes back to it; a digit picked from the
  keyboard while it is away scrolls it into view.
- **Motion**: the question rises with the transcript (280ms settle). Answered, the card folds
  away (180ms, height and fade, the column's gap with it) while its one-line record rises.

### Sidebar needs

What the agents need from the user lives in the sidebar rows, not in a mode of its own.

- **The stop word**: a row whose page stops says it in one word (Question, To review, PR
  ready, Blocked) before the colour word, `text-xs`. Unread, it is `font-medium` in the
  stop's ink (warn, critical, good); seen, `muted-foreground`.
- **The flash**: a row that finishes or waits flashes once in green or amber from its left
  edge (1.2s) and fades back to nothing; no lasting wash (Canvas keeps the ground clean).
- **Unread only**: the bold title lasts until the workspace is opened. Opening it
  marks it seen while it renders, so the row never flashes as the user arrives.
- **Needs you**, a nav row under Search: the plain `faint` `text-xs` count of unread rows, or ⌘0 as
  a `Kbd` when none. A click or ⌘0 goes to the next; with none, the label cross-fades to
  "Nothing needs you" in place for 1.6s.
- **Parked** rows close their project, under a "Parked N" label row with a chevron, folded by
  default (kept per window). Parked rows sit at half opacity and show only the working
  loader: no word, no flash, no count.
- **Sub-workspaces** sit under their parent, each level 18px in, a 1px `line-strong` elbow
  from the parent's mark column into the child's mark (rounded corner, rails running on past
  rows while a sibling follows); a child's flash starts at its indent. The parent's meta leads
  with its count and a 12px chevron (turned down while open); the hover tools hold the same
  count as the fold button. Folding slides each row's height (`FOLD`, 180ms); folded, a
  waiting dot and the count of what asks below, in warn ink, replace the plain count. The row
  on screen never hides: its parents stay open.

### The task page

A workspace's report is one page for its task, kept by its agent from the start of the work
to its end (`app/report-view.tsx`, from `report/from-report.ts`). It is the Report tab, which
leads the right panel; shown, it (like a published page) opens the panel split at 40 % of the
area right of the sidebar, never wider than 560px (`layout.splitWidth` once dragged; the chat keeps its minimum), the
other tabs keeping the narrow width (`layout.gitWidth`), so the
page reads from 340px up: below 560px its section labels go above their content.

- **Head**: the title (`text-title`), then one quiet line
  "project · colour · ticket" (`text-faint`, the ticket a link when the page links it) with
  Open chat at its end. The state line (the state's dot, word and step: "Working · code", then
  the age) sits at the title's right when there is room, above it when not.
- **Lead**: the summary, as a text block's lead. Blocked, the summary is the reason, drawn as a risk
  callout in its place. A question the page asks is not drawn: the chat beside it asks it.
- **Six sections, always in this order**: The ticket, What I understood, What I will do,
  Progress, Result, Left for you. Each is a row under a hairline (`border-t`, 20px above and
  below): its label (`text-sm` medium, with when it was set in `text-faint` beside it) in a
  132px column at the left from 560px of page width, above the content below that.
- **Progress** is one line that wraps (16px between steps, 8px between lines), each step its
  mark and its words: the checks' marks for done, failed (red ink) and skipped (struck,
  faint); a hollow ring for what is to come; the working loader on the current step while the
  chat works, a solid dot when it does not. The current step is `font-medium`.
- **Empty sections**: one not written yet keeps its row and its label in `muted-foreground`,
  with "Not yet" in `text-label` as its content, so the page has the same shape from its first
  call. When two or more empty ones close the page, they fold into a single row: "Still to
  come", then their labels joined by " · ". A page just started is a head and one quiet line,
  not a column of blanks.
- **A section set again** while on screen: its content rises in place (`block-in`) and a
  `bg-hover` wash fades from it over 1.6s, a little wider than the row, so the eye finds what
  changed. The page keeps the section the reader was looking at where it was (the scroll is
  corrected by hand: WKWebView has no scroll anchoring), so nothing jumps.
- **Never greyed**: a page whose state no longer holds (a stop the chat went on from) keeps
  every section as it was; only its state line gives the chat's own signal ("Working",
  "Waiting for you", "Finished", "Idle").

### Report blocks

A section is a column of blocks (`report/blocks/`), and `show` draws the same blocks inline
in a chat. One set of components serves the Report tab and the chat.

- **Kinds an agent may send**: text, callout, steps, table, decisions, screens and left.
  The others belong to logit. A question goes through AskUserQuestion, a PR is a link that
  becomes its card, and context (the feature and the problem side by side) is how a page
  written before sections shows its old fields. Each kind does one job:
  - text: paragraphs and links;
  - callout: a note, an assumption or a risk the reader must not miss;
  - steps: what was run and how it went (done, failed or skipped, with a detail);
  - table: a comparison;
  - decisions: choices already made, each with what was set aside;
  - screens: a before/after pair, one screen, or a numbered flow;
  - left: what the user still has to do.

  No new kinds without the owner.

- **Never decoration**: a block exists because prose would read worse. A list of three short
  facts stays a sentence. A callout is for a real risk, not for emphasis. One table, not one
  per fact.
- **In a chat** (`app/shown-blocks.tsx`), the blocks sit in the text column at the transcript's
  rhythm and rise with it. While the call runs, it is the usual tool row ("Showing…"). A
  refused call is the usual tool error row. A PR the blocks link gets its card under them,
  once per chat, by the chat's own rule; its link leaves the links line.
- **Screens in a chat** are files in the worktree, read on demand. While one loads, its frame
  holds the place as a `bg-active` pulse with the screen's aspect, so nothing jumps; the image
  fades in over it in 160ms. When a file can't be read, a dashed `chrome` box in the same frame
  says "Image not found" (or "Image not shown" for any other reason) and names the file in
  mono, with the full reason on hover. A report's screens are copied beside it and drawn at
  once.
- **Narrow**: the blocks follow their `@container/report` width. A pair of screens stacks
  below 420px. A table scrolls sideways inside its frame, never the page.

## Checking

Every UI change is checked in the browser preview (`bun run web:dev`, see CLAUDE.md) at
1000×600 and 1440×900: screenshot it, drive it by keyboard, watch the transitions. A change
is done when it looks finished in every state above, not when it works.
