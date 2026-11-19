# logit desktop — design

The bar: a product, not a tool. Everything on screen is deliberate, aligned and finished;
everything that moves, moves smoothly and for a reason. If a detail looks "good enough", it
isn't. Reference for layout, density and feel: Conductor.build. For craft: Linear, Things.

## Principles

- **Calm.** White surfaces, warm neutrals, hairlines. Colour only says what needs attention
  (working, waiting, failing, done). No decoration, no gradients for show, no hatching.
- **Dense, not cramped.** Compact rows (28–36px), 13px chrome and 15px prose, generous outer
  margins. Show everything that matters without scrolling or hovering for it.
- **Square and aligned.** Every edge lines up with something: bar heights (40px), panel
  paddings, list insets, icon centres. Small radii (4–8px; 12px only for floating
  surfaces). A misaligned pixel is a bug.
- **Native.** System font, macOS shortcuts, no browser feel: no text selection outside text,
  no focus ring on click, no web-style hover delays, no page-like scroll jumps.
- **Keyboard first.** Every action reachable from the keyboard; the focused item is always
  visible and in view.

## Motion

Motion explains change: where something came from, what replaced what. Never ornamental,
never in the way. Every state change that would otherwise "pop" gets a transition.

| What                                            | Duration  | Curve       | Movement                                              |
| ----------------------------------------------- | --------- | ----------- | ----------------------------------------------------- |
| Hover / pressed colours                         | 120ms     | ease-out    | colour only                                           |
| Menus, popovers, combos, tooltips (enter)       | 140–160ms | ease-out    | fade + 2–4px slide from the anchor, scale 0.98 → 1    |
| Same (exit)                                     | 100–120ms | ease-in     | fade only                                             |
| Composer dialog                                 | 180ms     | ease-out    | fade + 6px rise; veil fades                           |
| New message / block / card                      | 200–280ms | ease-out    | fade + 6px rise                                       |
| Expand / collapse (tool rows, "Show all")       | 180ms     | ease-in-out | height + fade, no jump                                |
| A question answered (its card folds away)       | 180ms     | ease-in-out | height + fade; its one-line record rises in its place |
| Tabs: open, close, reorder                      | 160ms     | ease-out    | width and position slide; neighbours make room        |
| Panels (sidebar ⌘S, git ⌥⌘B)                    | 200ms     | ease-in-out | width slide, content does not reflow mid-way          |
| Status changes (dots, badges, counts)           | 160ms     | ease-out    | cross-fade; working dots breathe                      |
| Sidebar row finishes / waits (tint)             | 700ms     | ease-out    | opacity only: swell, hold, settle to a faint wash     |
| Inline confirmations (⌘W twice, discard, merge) | 120ms     | ease-out    | label cross-fade in place, no layout shift            |
| Clean up (a merged workspace leaves)            | 340–760ms | per style   | Dust, Brush or Glint (Settings › Appearance)          |
| Chat background (picked, or changed)            | 300ms     | ease-out    | fade in; the scene then plays at 24 fps, cell by cell |
| Sidebar: Code ↔ Desk                            | 160ms     | ease-out    | the two lists cross-fade, 4px slide toward the mode   |
| Desk: a row arrives                             | 240ms     | settle      | fade + 6px rise                                       |
| Desk: an answered row leaves                    | 300ms     | settle      | fade, 16px drift right, height folds                  |

- "settle" is `--ease-settle` (`cubic-bezier(0.2, 0, 0, 1)`): long, soft landings.
- Animate `opacity` and `transform`; animate size only where the layout must move.
- Nothing above 300ms, except Clean up's send-off, which plays once the worktree is gone and
  blocks nothing, a sidebar row's tint, a notification that moves nothing, and the chat
  background, a scene the user chose that plays behind everything and stops when motion is reduced. Nothing that delays an action the user already took.
- Respect `prefers-reduced-motion`: keep fades, drop movement.
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
`text-faint`, `bg-chrome`, `h-bar`, `shadow-popover`…). No raw hex in components; add a
token when one is missing (the exceptions: the workspace colours in `model/names.ts`, the
project avatar tones and the terminal theme). Light only for now; themes come from the same
variables. Change a value here and in `styles.css` together; `?gallery` in the browser preview
shows them all.

**Surfaces are neutral, inks are warm.** Fills carry no beige; the warmth is in the text.

**Surfaces are layers over the scene.** With a chat background on, the scene fills the window
and every pane sits on it. Panes around the chat take `glass` (`styles.css`): white at 50 %,
blurred 24px, and inside them `background`, `chrome` and `sidebar` turn translucent and
hairlines become ink at 8 %. The chat pane stays open, with a veil behind its column. Popups,
menus and dialogs stay opaque. A new pane is designed as a layer: glass, or open.

### Type

Every size in a component comes from this scale; no `text-[13.5px]` and the like. System
font; mono (`font-mono`, Geist Mono) only for code, tool commands, counts and branch names,
never for file names.

| Utility      | Size / line | Weight    | Use                                                                 |
| ------------ | ----------- | --------- | ------------------------------------------------------------------- |
| `text-2xs`   | 11 / 14     | 500       | badges and inbox counts only                                        |
| `text-xs`    | 12 / 16     | 400 / 500 | ages, hints, section labels, footers, counts, chips, shortcuts      |
| `text-sm`    | 13 / 18     | 400 / 500 | all chrome: sidebar, tabs, menus, file rows, buttons (the body)     |
| `text-base`  | 14 / 22     | 400 / 600 | user bubble, composer text, top-bar title, PR status, card titles   |
| `.md`        | 15 / 24     | 400       | Claude's answers (h1 18/26, h2 16/24, h3–h4 15/24, all 600)         |
| `text-md`    | 15 / 24     | 400 / 500 | prose outside markdown on a stage: Desk's question, choices (15/22) |
| `text-title` | 18 / 26     | 600       | a report's title on a stage (Desk's detail)                         |
| `text-lg`    | 20 / 28     | 600       | empty-state titles only                                             |
| mono         | 12.5 / 20   | 400       | code blocks; 13 for inline code in prose, 12 inline in chrome       |

`text-2xs` and `text-lg` carry their weight; the others take `font-medium` or
`font-semibold` where the table allows.

### Colour

| Token                                                        | Value                             | Use                                                                                           |
| ------------------------------------------------------------ | --------------------------------- | --------------------------------------------------------------------------------------------- |
| `background`, `card`, `popover`                              | `#ffffff`                         | the chat, popups, dialogs                                                                     |
| `foreground`, `primary`                                      | `#282725`                         | ink: text, the ink button                                                                     |
| `ink-soft`                                                   | `#3d3a38`                         | the user bubble's text, command output                                                        |
| `muted-foreground`                                           | `#6c6a69`                         | secondary text                                                                                |
| `faint`                                                      | `#8d8885`                         | icons, meta, hints, shortcuts                                                                 |
| `label`                                                      | `#a3a19f`                         | section labels, placeholders                                                                  |
| `chrome`                                                     | `#fafaf9`                         | the tab band, composer, code blocks, command cards                                            |
| `sidebar`                                                    | `#fdfcfc`                         | the sidebar                                                                                   |
| `bubble`                                                     | `#f7f6f4`                         | the user bubble                                                                               |
| `muted`, `accent`, `secondary`,`hover`                       | `#f4f4f3`                         | hover, a highlighted menu row, the secondary button                                           |
| `active`, `sidebar-accent`                                   | `#efefee`                         | the selected row                                                                              |
| `border`, `sidebar-border`                                   | `#ebeae9`                         | hairlines                                                                                     |
| `input`, `line-strong`                                       | `#dddbd9`                         | field borders, a focused composer, a disabled send                                            |
| `tick`                                                       | `#dcdbd9`                         | the turn ruler's ticks                                                                        |
| `line-ink`                                                   | `#4a4644`                         | the ink button's hover                                                                        |
| `tan`, `ring`                                                | `#c29c87`                         | only the active-tab underline, the caret, ::selection; focus ring                             |
| `good` / `good-ink` / `good-wash`                            | `#4d8a5b` / `#2f6b3e` / `#f3f8f3` | done, added; green text; PR head band (ready, merged)                                         |
| `warn` / `warn-ink` / `warn-wash`                            | `#c99a1e` / `#7a5a08` / `#fbf4e2` | waiting, modified; amber text; an assumption callout, a warning mark                          |
| `critical`, `destructive` / `critical-ink` / `critical-wash` | `#b8473a` / `#9e3324` / `#fbf3f2` | failing, deleted, destructive fills; red text; PR head band (blocked, failing), the error box |
| `merge` / `merge-hover`                                      | `#2f8a4c` / `#287a42`             | the Merge button                                                                              |
| `neutral`                                                    | `#b4b8bf`                         | a setup script never run                                                                      |

Text on a wash uses the ink, never the plain status colour.

### Radii

`--radius` is 8px. `rounded-sm` 4 (inline code, key caps), `rounded-md` 6 (rows, chips,
small buttons), `rounded-lg` 8 (buttons, cards, the composer, code blocks), `rounded-xl` 12
(menus, popovers, ⌘P, the ⌘N dialog). Nothing else: `rounded-2xl` and up don't exist.
`rounded-full` for dots, bars and ticks.

### Heights

`h-bar` 40 for every bar on the top edge (and the bottom strips), so their hairlines line
up. Rows: menus 28 (`h-7`), tool and group rows 28, nav 32, file and check rows 32, popover
rows 32, ⌘P rows 36 (one line) or 48 (two), sidebar workspace rows 36 (48 with a subtitle).
Controls inside bars: `h-7`.

### Shadows

- `shadow-popover`: menus, popovers, ⌘P (a 1px ring and a soft drop).
- `shadow-dialog`: the ⌘N dialog.
- `shadow-composer`: the chat composer, `0 1px 2px` + `0 4px 12px -6px` at 4–8 % ink.
- Cards (the permission card, command cards) have none.

### Primitives

- `Kbd` (`components/ui/kbd.tsx`): a shortcut as a plain glyph, `text-xs text-faint`,
  sans, no box. On the ink button, add `text-white/60`. Two boxed key caps only: ⌘P's footer
  legend (`KbdBox`, local to picker.tsx) and an option row's number (below).
- Menus (`components/ui/menu.tsx`, `context-menu.tsx`, the app's `context-menu.tsx`): one
  look from `lib/menu-styles.ts`: 28px rows, 14px faint icons that ink on highlight,
  shortcuts as glyphs (`MenuShortcut`, `ContextMenuShortcut`, or `shortcut` on a
  `MenuAction`), destructive rows in `critical-ink`, edge-to-edge separators, 24px group
  labels. Popovers that list things (the inbox, the combobox) share the popup.
- `Dialog`: a light veil (`foreground` at 8 %), `rounded-xl`, 180ms rise. ⌘P uses it with
  no veil and a 4px drop.
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
  around it in a chat; in Desk the card is the box.
- **The options** are one grouped list, a hairline between rows, in the cards' frame
  (`rounded-lg` hairline on `background`); in Desk's card, rows run flush under a hairline. Each
  row is padded 14 / 10: a 20px number cap (`rounded-sm` hairline, `text-xs` faint), the label
  `text-base` regular ink, the description under it `text-sm` muted. Both wrap, never cut.
  "Recommended" is a `text-xs` faint word at the row's right, on the label's line.
- **States**: hover `hover` (120ms); pressed `active`; picked, the cap inks (`foreground`
  fill, white number, 160ms) on a `chrome` wash, the mark stays; focus the inset tan ring.
- **No form in a chat**: the composer is the free answer, so the card has no field. One
  single-choice question answers on click; a hint line under it says so, with Skip as a quiet
  text action. Several questions or a multi-select add a progress count and one Send. A free
  answer typed while other questions wait shows as a picked row of its own (a pencil cap).
  Desk has no composer: the card's foot is its free answer, as the reply line ends every dock
  state.
- **Where it stands**: the last item of the transcript (Desk: of the report, 40px under it, in
  its column), scrolling with it. Scrolled out of view, one slim "Claude asks" line stands at
  the bottom (over the composer in a chat) and goes back to it; a digit picked from the
  keyboard while it is away scrolls it into view.
- **Motion**: the question rises with the transcript (280ms settle). Answered, the card folds
  away (180ms, height and fade, the column's gap with it) while its one-line record rises.

### The task page

A workspace's report is one page for its task, kept by its agent from the start of the work
to its end (`app/report-view.tsx`, from `report/from-report.ts`). The Report tab and Desk draw
the same component; only the surface around it differs.

- **Head**: the title (`text-title`), then one quiet line
  "project · colour · ticket" (`text-faint`, the ticket a link when the page links it) with
  Open chat at its end. The state line (the state's dot, word and step: "Working · code", then
  the age) sits at the title's right when there is room, above it when not.
- **Lead**: the summary, as a text block's lead. Blocked, the summary is the reason, drawn as a risk
  callout in its place. A question the page asks comes next in the Report tab; Desk writes it
  once, as the card at the page's end.
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
in a chat. One set of components serves Desk, the Report tab and the chat.

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
