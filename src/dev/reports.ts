// The browser preview's agent reports (`report_get`), one per state. amber (logit) asks a
// question (an open choice; `?report-ask` its chat waits on it, `?report-answered` it was
// answered), violet's PR is ready with a migration left to run (older than its chat, so it reads
// as "Earlier"; `?report-done` finished without a PR), basil is blocked, plum is done with what
// it did, coral (in amber's Agents tab) says everything at the limits, only with `?long`.
// `?merged`: amber's report is a ready PR, now merged. atlas's reports are in desk.ts. The
// screens are drawn here as SVG: a booking back-office (`shot`) and logit itself (`logitShot`).
import type { Report } from '../model/report'

const MIN = 60_000
const HOUR = 60 * MIN

/** A screen of a small back-office app, drawn as an SVG data URL. */
interface Screen {
  title: string
  /** The app's name, top left. */
  app?: string
  nav?: string
  /** The table's four column heads. */
  heads?: readonly string[]
  /** The table's rows, four cells each; the default is a list of bookings. */
  cells?: readonly (readonly string[])[]
  rows?: number
  /** A button at the heading's right; `new` rings it as the change. */
  button?: { label: string; new?: boolean }
  /** A search field in the top bar. */
  search?: { new?: boolean; text?: string }
  /** A strip under the heading (a notice, a filter bar). */
  strip?: { label: string; new?: boolean }
  /** A row badge on the first rows. */
  badge?: { label: string; new?: boolean }
  /** Rows greyed out from this one. */
  dimFrom?: number
  /** A drop-down of results over the page. */
  results?: string[]
}

const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
const svgUrl = (w: number, h: number, parts: string[]) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w * 2}" height="${h * 2}" viewBox="0 0 ${w} ${h}" font-family="-apple-system, BlinkMacSystemFont, system-ui, sans-serif">${parts.join('')}</svg>`
  )}`
/** Where each of the table's four columns starts. */
const COLUMNS = [26, 128, 222, 312] as const
const RING = 'stroke="#c29c87" stroke-width="2" fill="none" rx="5"'
const BOOKINGS = [
  ['Martin, Claire', 'B-2291', 'Lyon', '1 240 €'],
  ['Bernard, Hugo', 'B-2288', 'Nice', '860 €'],
  ['Dubois, Léa', 'B-2285', 'Paris', '2 015 €'],
  ['Moreau, Paul', 'B-2279', 'Bordeaux', '430 €'],
  ['Laurent, Inès', 'B-2276', 'Marseille', '1 780 €'],
  ['Simon, Jules', 'B-2270', 'Lille', '615 €'],
  ['Garcia, Emma', 'B-2266', 'Annecy', '990 €'],
] as const

export function shot(s: Screen): string {
  const w = 480
  const h = 300
  const parts: string[] = [
    `<rect width="${w}" height="${h}" fill="#fff"/>`,
    `<rect width="${w}" height="34" fill="#fafaf9"/><line x1="0" y1="34.5" x2="${w}" y2="34.5" stroke="#ebeae9"/>`,
    `<rect x="14" y="11" width="12" height="12" rx="3" fill="#3d6aa8"/>`,
    `<text x="32" y="21.5" font-size="11" font-weight="600" fill="#282725">${esc(s.app ?? 'Atlas')}</text>`,
    `<text x="84" y="21.5" font-size="10.5" fill="#6c6a69" xml:space="preserve">${esc(s.nav ?? 'Bookings    Customers    Planning')}</text>`,
  ]
  if (s.search) {
    parts.push(
      `<rect x="300" y="8" width="166" height="18" rx="4" fill="#fff" stroke="#dddbd9"/>`,
      `<text x="308" y="20.5" font-size="9.5" fill="${s.search.text === undefined ? '#a3a19f' : '#282725'}">${esc(s.search.text ?? 'Booking, customer…')}</text>`,
      `<text x="446" y="20.5" font-size="9" fill="#a3a19f">⌘K</text>`
    )
    if (s.search.new === true) parts.push(`<rect x="296" y="4" width="174" height="26" ${RING}/>`)
  }
  parts.push(
    `<text x="16" y="62" font-size="15" font-weight="600" fill="#282725">${esc(s.title)}</text>`
  )
  if (s.button) {
    const bw = 18 + s.button.label.length * 5.6
    const bx = w - 16 - bw
    parts.push(
      `<rect x="${bx}" y="47" width="${bw}" height="22" rx="5" fill="#282725"/>`,
      `<text x="${bx + 9}" y="61.5" font-size="10" font-weight="500" fill="#fff">${esc(s.button.label)}</text>`
    )
    if (s.button.new === true)
      parts.push(`<rect x="${bx - 4}" y="43" width="${bw + 8}" height="30" ${RING}/>`)
  }
  let y = 82
  if (s.strip) {
    parts.push(
      `<rect x="16" y="${y}" width="${w - 32}" height="24" rx="5" fill="#f3f8f3"/>`,
      `<text x="26" y="${y + 15.5}" font-size="10" fill="#2f6b3e" xml:space="preserve">${esc(s.strip.label)}</text>`
    )
    if (s.strip.new === true)
      parts.push(`<rect x="12" y="${y - 4}" width="${w - 24}" height="32" ${RING}/>`)
    y += 34
  }
  const cells = s.cells ?? BOOKINGS
  const rows = Math.min(s.rows ?? 6, cells.length)
  parts.push(`<rect x="16" y="${y}" width="${w - 32}" height="22" fill="#fafaf9"/>`)
  for (const [i, x] of COLUMNS.entries()) {
    const head = (s.heads ?? ['Customer', 'Booking', 'City', 'Total'])[i] ?? ''
    parts.push(
      `<text x="${x}" y="${y + 14.5}" font-size="9" font-weight="600" fill="#6c6a69">${esc(head)}</text>`
    )
  }
  for (let r = 0; r < rows; r++) {
    const ry = y + 22 + r * 24
    const dim = s.dimFrom !== undefined && r >= s.dimFrom
    parts.push(`<line x1="16" y1="${ry + 0.5}" x2="${w - 16}" y2="${ry + 0.5}" stroke="#ebeae9"/>`)
    for (const [i, x] of COLUMNS.entries()) {
      let ink = i === 0 ? '#282725' : '#5a5856'
      if (dim) ink = '#c9c6c3'
      parts.push(
        `<text x="${x}" y="${ry + 15.5}" font-size="10" fill="${ink}">${esc(cells[r]?.[i] ?? '')}</text>`
      )
    }
    if (s.badge && r < 2) {
      parts.push(
        `<rect x="392" y="${ry + 5}" width="70" height="14" rx="7" fill="#fbf3f2"/>`,
        `<text x="400" y="${ry + 15}" font-size="8" fill="#9e3324">${esc(s.badge.label)}</text>`
      )
      if (s.badge.new === true && r === 0)
        parts.push(`<rect x="388" y="${ry + 1}" width="78" height="46" ${RING}/>`)
    }
  }
  if (s.results) {
    parts.push(
      `<rect x="0" y="35" width="${w}" height="${h - 35}" fill="#282725" fill-opacity="0.18"/>`,
      `<rect x="230" y="30" width="240" height="${12 + s.results.length * 30}" rx="6" fill="#fff" stroke="#dddbd9"/>`
    )
    for (const [i, label] of s.results.entries()) {
      const ry = 36 + i * 30
      parts.push(
        `<text x="242" y="${ry + 17}" font-size="10" font-weight="${i === 0 ? 600 : 400}" fill="#282725">${esc(label)}</text>`,
        `<rect x="404" y="${ry + 6}" width="56" height="16" rx="4" fill="${i === 0 ? '#282725' : '#f4f4f3'}"/>`,
        `<text x="420" y="${ry + 17}" font-size="8.5" font-weight="500" fill="${i === 0 ? '#fff' : '#5a5856'}">Open</text>`
      )
    }
    parts.push(`<rect x="400" y="38" width="64" height="24" ${RING}/>`)
  }
  return svgUrl(w, h, parts)
}

/** A logit window: the sidebar, a chat, and a right-click menu over it. */
interface AppScreen {
  /** The menu: where it opens, its items, the one under the pointer, the submenu it opened. */
  menu?: { x: number; y: number; items: string[]; hover?: number; sub?: string[] }
  /** Rings what changed. */
  ring?: { x: number; y: number; w: number; h: number }
}

const SIDE_ROWS = [
  ['Port the menus to Base UI', true],
  ['Write the release notes', false],
  ['Hide child workspaces', false],
  ['Tests for the agent tree', false],
] as const

export function logitShot(s: AppScreen): string {
  const w = 480
  const h = 300
  const parts: string[] = [
    `<rect width="${w}" height="${h}" fill="#fff"/>`,
    // The sidebar: traffic lights, the project, its workspaces.
    `<rect width="128" height="${h}" fill="#f7f6f5"/><line x1="128.5" y1="0" x2="128.5" y2="${h}" stroke="#ebeae9"/>`,
    ...['#ec6a5e', '#f4bf4f', '#61c554'].map(
      (c, i) => `<circle cx="${12 + i * 12}" cy="13" r="3.5" fill="${c}"/>`
    ),
    `<rect x="10" y="34" width="10" height="10" rx="2.5" fill="#7c6f64"/>`,
    `<text x="25" y="42.5" font-size="9.5" font-weight="600" fill="#282725">logit</text>`,
  ]
  for (const [i, [label, on]] of SIDE_ROWS.entries()) {
    const y = 52 + i * 20
    if (on) parts.push(`<rect x="6" y="${y}" width="116" height="18" rx="4" fill="#ecebea"/>`)
    parts.push(
      `<text x="14" y="${y + 12.5}" font-size="8.5" fill="${on ? '#282725' : '#6c6a69'}" font-weight="${on ? 500 : 400}">${esc(label)}</text>`
    )
  }
  // The top bar and its tabs.
  parts.push(
    `<line x1="128" y1="28.5" x2="${w}" y2="28.5" stroke="#ebeae9"/>`,
    `<text x="140" y="18" font-size="9.5" font-weight="600" fill="#282725">amber</text>`,
    `<rect x="178" y="7" width="66" height="16" rx="4" fill="#ecebea"/>`,
    `<text x="186" y="18" font-size="8.5" fill="#282725">Menus</text>`,
    `<text x="256" y="18" font-size="8.5" fill="#6c6a69">Terminal</text>`
  )
  // The chat: a prompt, an answer.
  parts.push(
    `<rect x="300" y="44" width="164" height="22" rx="6" fill="#f4f4f3"/>`,
    `<text x="310" y="58.5" font-size="8.5" fill="#282725">Port the menus to Base UI.</text>`,
    `<text x="148" y="88" font-size="9" fill="#282725">Every menu now runs on Base UI: the tab menu, the</text>`,
    `<text x="148" y="101" font-size="9" fill="#282725">sidebar's right-click and the model picker.</text>`,
    `<text x="148" y="122" font-size="9" fill="#6c6a69">Edited src/components/ui/menu.tsx  +84 −131</text>`,
    `<rect x="140" y="${h - 46}" width="${w - 156}" height="34" rx="7" fill="#fff" stroke="#dddbd9"/>`,
    `<text x="152" y="${h - 25}" font-size="9" fill="#a3a19f">Ask Claude…</text>`
  )
  if (s.menu) {
    const m = s.menu
    const mw = 128
    const mh = 8 + m.items.length * 20
    parts.push(
      `<rect x="${m.x + 1}" y="${m.y + 3}" width="${mw}" height="${mh}" rx="7" fill="#282725" fill-opacity="0.08"/>`,
      `<rect x="${m.x}" y="${m.y}" width="${mw}" height="${mh}" rx="7" fill="#fff" stroke="#dddbd9"/>`
    )
    for (const [i, item] of m.items.entries()) {
      const iy = m.y + 4 + i * 20
      if (i === m.hover)
        parts.push(
          `<rect x="${m.x + 4}" y="${iy}" width="${mw - 8}" height="20" rx="4" fill="#f1f0ef"/>`
        )
      parts.push(
        `<text x="${m.x + 12}" y="${iy + 13.5}" font-size="9" fill="#282725">${esc(item)}</text>`
      )
      if (item.endsWith('…') || (m.sub !== undefined && i === m.hover))
        parts.push(
          `<text x="${m.x + mw - 16}" y="${iy + 13.5}" font-size="9" fill="#a3a19f">›</text>`
        )
    }
    if (m.sub !== undefined && m.hover !== undefined) {
      const sx = m.x + mw - 4
      const sy = m.y + m.hover * 20
      const sh = 8 + m.sub.length * 20
      parts.push(
        `<rect x="${sx + 1}" y="${sy + 3}" width="${mw}" height="${sh}" rx="7" fill="#282725" fill-opacity="0.08"/>`,
        `<rect x="${sx}" y="${sy}" width="${mw}" height="${sh}" rx="7" fill="#fff" stroke="#dddbd9"/>`
      )
      for (const [i, item] of m.sub.entries()) {
        parts.push(
          `<text x="${sx + 12}" y="${sy + 4 + i * 20 + 13.5}" font-size="9" fill="#282725">${esc(item)}</text>`
        )
      }
    }
  }
  if (s.ring)
    parts.push(
      `<rect x="${s.ring.x}" y="${s.ring.y}" width="${s.ring.w}" height="${s.ring.h}" ${RING}/>`
    )
  return svgUrl(w, h, parts)
}

/** The tab's right-click menu, before (a click opens "Move to") and after (it opens on hover). */
export const MENU_STEP = {
  after: logitShot({
    menu: {
      hover: 2,
      items: ['Rename', 'Duplicate', 'Move to', 'Close tab'],
      sub: ['New window', 'amber · Terminal', 'teal · Notes'],
      x: 200,
      y: 30,
    },
    ring: { h: 76, w: 136, x: 320, y: 66 },
  }),
  before: logitShot({
    menu: { hover: 2, items: ['Rename', 'Duplicate', 'Move to…', 'Close tab'], x: 200, y: 30 },
  }),
  step: 'The tab menu: "Move to" opens on hover',
}

/** The question amber's chat asks with AskUserQuestion, as its report says it. */
export const REPORT_QUESTION = {
  header: 'Submenus',
  multiSelect: false,
  options: [
    {
      description: 'As macOS menus do: rest on the item a moment and it slides out.',
      label: 'On hover, after 150 ms (Recommended)',
    },
    {
      description: 'Nothing opens by accident, one more click every time.',
      label: 'Only on click or →',
    },
    { description: 'Hover for the mouse, → for the keyboard, click for both.', label: 'All three' },
  ],
  question: 'How should a submenu open: on hover, or only on click and →?',
}

const ask = (now: number): Report => ({
  at: now - 3 * MIN,
  chatId: 'chat-menus',
  choices: [
    {
      open: false,
      setAside: 'anchored under the row it belongs to',
      text: 'A right-click menu opens where the pointer is',
    },
    { open: true, text: REPORT_QUESTION.question },
    {
      open: false,
      setAside: 'Esc closing every level at once',
      text: 'Esc closes one level at a time',
    },
  ],
  feature:
    'Every menu in logit: the tab and sidebar right-click menus, the model picker, ⌘P. People open them dozens of times an hour.',
  left: [],
  links: [{ label: 'Issue #212', url: 'https://github.com/nbardavid/logit/issues/212' }],
  problem:
    'The old menus took the focus from the composer, so typing after a menu went nowhere, and a right-click on a tab sometimes opened two menus.',
  screens: [],
  state: 'question',
  summary:
    'Every menu now runs on Base UI and gives the focus back to the composer. One choice is left: how a submenu opens.',
  ticket: '#212',
  title: 'Port the menus to Base UI',
  workspaceId: 'ws-amber',
})

/** The lab's drafts list, for violet's screens (pragma-once's reports are in French). */
const DRAFTS = {
  app: 'Labo',
  cells: [
    ['Mme Roux', 'Bilan lipidique', 'Dr Faure', '12/08'],
    ['M. Petit', 'NFS', 'Dr Faure', '14/08'],
    ['Mme Blanc', 'TSH', 'Dr Chevalier', '02/09'],
    ['M. Henry', 'Glycémie', 'Dr Faure', '05/09'],
    ['Mme Perrin', 'Ferritine', 'Dr Chevalier', '11/09'],
    ['M. Morel', 'Bilan hépatique', 'Dr Faure', '18/09'],
  ],
  heads: ['Patient', 'Analyse', 'Biologiste', 'Créé le'],
  nav: 'Comptes-rendus    Réglages',
  title: 'Brouillons',
}

const ready = (now: number): Report => ({
  at: now - 26 * HOUR,
  chatId: 'chat-tiles',
  choices: [
    {
      open: false,
      setAside: 'suppression définitive tout de suite',
      text: 'Plus de 90 jours : à la corbeille, pas supprimés',
    },
    {
      open: false,
      setAside: 'aucun avertissement',
      text: 'Badge « Corbeille dans 12 j » sur les brouillons de 76 à 90 jours',
    },
    {
      open: false,
      setAside: 'seulement ceux qui vieillissent à partir d’aujourd’hui',
      text: 'Les 600 brouillons déjà anciens partent à la corbeille au déploiement',
    },
  ],
  feature:
    'Les brouillons de compte-rendu du labo, que les biologistes reprennent avant de valider.',
  left: [
    'Merger la PR',
    'Lancer la migration 0087_draft_trash en prod, après le merge (600 brouillons)',
  ],
  links: [
    {
      label: 'PR #412 · Brouillons à la corbeille après 90 jours',
      url: 'https://github.com/pragma/labo-app/pull/412',
    },
    { label: 'Ticket #48', url: 'https://pragma-once.fr/board/48' },
  ],
  problem:
    'La liste compte 1 900 brouillons, dont 600 de plus de trois mois que personne ne rouvrira.',
  screens: [
    {
      after: shot({ ...DRAFTS, badge: { label: 'Corbeille 12 j', new: true } }),
      before: shot(DRAFTS),
      step: 'La liste des brouillons',
    },
  ],
  state: 'ready',
  summary: 'Les brouillons de plus de 90 jours passent à la corbeille ; la PR est verte et relue.',
  ticket: '#48',
  title: 'Brouillons anciens à la corbeille',
  workspaceId: 'ws-violet',
})

const blocked = (now: number): Report => ({
  at: now - 50 * MIN,
  chatId: '',
  choices: [],
  feature: 'Le compte-rendu imprimable d’un bilan, envoyé au médecin traitant.',
  left: ['Se connecter au labo de test (code reçu par SMS), puis dire « c’est bon » dans le chat'],
  links: [{ label: 'Labo de test', url: 'https://test.labo-app.fr/login' }],
  problem: 'Le médecin reçoit le compte-rendu par fax ; il le veut en PDF.',
  screens: [],
  state: 'blocked',
  summary:
    'Le bouton PDF est écrit ; je ne peux pas le vérifier à l’écran sans me connecter au labo de test.',
  ticket: '#63',
  title: 'Compte-rendu en PDF',
  workspaceId: 'ws-basil',
})

const LONG =
  'Une phrase très longue écrite par un agent qui n’a pas su s’arrêter, avec des mots composés-interminables-et-collés et une URL https://example.com/un/chemin/tres/long/qui/ne/se/coupe/pas/naturellement?avec=des&parametres=nombreux pour voir comment le texte se replie dans un panneau étroit. '

/** `LONG`, cut to exactly `n` characters (the host's limits). */
// oxlint-disable-next-line typescript/no-misused-spread -- code points, as the host counts
const upTo = (n: number) => [...LONG.repeat(3)].slice(0, n).join('')

const long = (now: number): Report => ({
  at: now - 31 * MIN,
  chatId: 'chat-coral',
  choices: Array.from({ length: 6 }, (_, i) => ({
    open: i === 3,
    setAside: i % 2 === 0 ? LONG : undefined,
    text: upTo(i === 3 ? 120 : 60 + i * 12),
  })),
  feature: upTo(300),
  left: [LONG, 'Rien d’autre'],
  links: [
    { label: LONG.slice(0, 120), url: 'https://github.com/nbardavid/logit/pull/999' },
    // Older reports, written before the host checked links: never opened.
    { label: 'Courte', url: 'not a url' },
  ],
  problem: upTo(300),
  screens: [
    { after: shot({ title: 'Un écran tout neuf' }), step: 'Un écran qui n’existait pas' },
    { before: shot({ title: 'Ancien écran' }), step: `Un écran qui disparaît. ${LONG}` },
    {
      after: shot({ button: { label: 'Exporter CSV', new: true }, title: 'Réservations' }),
      before: shot({ title: 'Réservations' }),
      step: 'La liste des réservations',
    },
  ],
  state: 'question',
  summary: upTo(200),
  ticket: 'RAI-20551-AVEC-UN-NUMERO-TRES-LONG',
  title: upTo(60),
  workspaceId: 'ws-coral',
})

/** `?report-done`: violet's work, finished without a PR (a setting changed on the server). */
const done = (now: number): Report => ({
  ...ready(now),
  choices: [
    {
      open: false,
      setAside: 'suppression définitive tout de suite',
      text: 'Plus de 90 jours : à la corbeille, pas supprimés',
    },
  ],
  feature: undefined,
  left: ['Vérifier demain matin que la liste ne compte plus que 1 300 brouillons'],
  links: [{ label: 'Ticket #48', url: 'https://pragma-once.fr/board/48' }],
  problem: undefined,
  screens: [],
  state: 'done',
  summary: 'Le délai est passé à 90 jours dans les réglages du labo de prod ; aucun code à merger.',
})

/** `?merged`: amber's PR is ready, then merged; merging was all that was left, and a check. */
const shipped = (now: number): Report => ({
  ...ask(now),
  choices: ask(now).choices.filter((c) => !c.open),
  left: ['Merge the PR', 'Try the tab menu on a second display'],
  links: [
    { label: 'PR #128', url: 'https://github.com/nbardavid/logit/pull/128' },
    { label: 'Issue #212', url: 'https://github.com/nbardavid/logit/issues/212' },
  ],
  state: 'ready',
  summary: 'Every menu runs on Base UI, and a submenu opens on hover after 150 ms.',
})

/** plum, done: the agent tree's tests, with what it did and what it found on the way. */
const tested = (now: number): Report => ({
  at: now - 7 * MIN,
  blocks: [
    {
      items: [
        { detail: 'agent-tree.test.ts, 14 tests', status: 'done', text: 'Wrote the tree’s tests' },
        { status: 'done', text: 'Fixed the child that lost its parent' },
        { detail: '611 of 611', status: 'done', text: 'Ran the whole suite' },
        { status: 'done', text: 'Lint and format pass' },
      ],
      kind: 'steps',
    },
    {
      kind: 'callout',
      text: 'A child whose parent chat was closed showed at the top level of the tree. It now stays under its workspace; one of the new tests holds it.',
      title: 'Found on the way',
      tone: 'note',
    },
  ],
  chatId: 'chat-plum',
  choices: [],
  left: [],
  links: [],
  screens: [],
  state: 'done',
  summary:
    'The agent tree has its tests: 14 new ones, all green, and the bug they caught is fixed.',
  title: 'Tests for the agent tree',
  workspaceId: 'ws-plum',
})

/** Every fixture report, by workspace. */
export function reportFixtures(now: number, flags: URLSearchParams): Record<string, Report> {
  return Object.fromEntries(
    [
      flags.has('merged') ? shipped(now) : ask(now),
      flags.has('report-done') ? done(now) : ready(now),
      blocked(now),
      tested(now),
      // The stress report only with `?long`: it must not be the first thing Desk shows.
      ...(flags.has('long') ? [long(now)] : []),
    ].map((r) => [r.workspaceId, r])
  )
}

/** What Claude Code says once AskUserQuestion is answered. */
export const answeredText = (answers: Record<string, string>) =>
  `User has answered your questions: ${Object.entries(answers)
    .map(([q, a]) => `"${q}"="${a}"`)
    .join(', ')}. You can now continue with the user's answers in mind.`

/** A newer report for amber, as `?report-live` writes it a few seconds in: screens to review. */
export function liveReport(now: number, asks = false): Report {
  const was = ask(now)
  // `?report-live-ask`: a new question, written while you are elsewhere.
  if (asks) return { ...was, at: now }
  const choices = was.choices.map((c) => ({ ...c, open: false }))
  return {
    ...was,
    at: now,
    choices,
    screens: [MENU_STEP],
    state: 'review',
    summary: 'A submenu now opens on hover after 150 ms; here is the tab menu before and after.',
  }
}
