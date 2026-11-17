// The browser preview's agent reports (`report_get`), one per state: amber asks a question
// (an open choice; `?report-ask` its chat waits on it, `?report-answered` it was answered),
// teal has three steps of screens to review, violet's PR is ready with a migration left to run
// (and the report is older than its chat; `?report-done` finished without a PR), basil is
// blocked, coral (in amber's Agents tab) says everything at the limits. `?merged`: amber's
// report is a ready PR, now merged. The others have none.
import type { Report } from '../model/report'

const MIN = 60_000
const HOUR = 60 * MIN

/** A screen of a small back-office app, drawn as an SVG data URL. */
interface Screen {
  title: string
  nav?: string
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
/** The table's columns: where each starts, and its cells' width. */
const COLUMNS = [
  [26, 52],
  [120, 90],
  [250, 70],
  [360, 44],
] as const
const RING = 'stroke="#c29c87" stroke-width="2" fill="none" rx="5"'

export function shot(s: Screen): string {
  const w = 480
  const h = 300
  const parts: string[] = [
    `<rect width="${w}" height="${h}" fill="#fff"/>`,
    `<rect width="${w}" height="34" fill="#fafaf9"/><line x1="0" y1="34" x2="${w}" y2="34" stroke="#ebeae9"/>`,
    `<rect x="14" y="11" width="12" height="12" rx="3" fill="#3d6aa8"/>`,
    `<text x="32" y="21.5" font-size="11" font-weight="600" fill="#282725">Agence</text>`,
    `<text x="92" y="21.5" font-size="10.5" fill="#6c6a69">${esc(s.nav ?? 'Dossiers   Clients   Planning')}</text>`,
  ]
  if (s.search) {
    parts.push(
      `<rect x="300" y="8" width="166" height="18" rx="4" fill="#fff" stroke="#dddbd9"/>`,
      `<text x="308" y="20.5" font-size="9.5" fill="${s.search.text === undefined ? '#a3a19f' : '#282725'}">${esc(s.search.text ?? 'Dossier, client…')}</text>`,
      `<text x="446" y="20.5" font-size="9" fill="#a3a19f">⌘K</text>`
    )
    if (s.search.new === true) parts.push(`<rect x="296" y="4" width="174" height="26" ${RING}/>`)
  }
  parts.push(
    `<text x="16" y="62" font-size="15" font-weight="600" fill="#282725">${esc(s.title)}</text>`
  )
  if (s.button) {
    const bw = 18 + s.button.label.length * 6
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
      `<text x="26" y="${y + 15.5}" font-size="10" fill="#2f6b3e">${esc(s.strip.label)}</text>`
    )
    if (s.strip.new === true)
      parts.push(`<rect x="12" y="${y - 4}" width="${w - 24}" height="32" ${RING}/>`)
    y += 34
  }
  const rows = s.rows ?? 6
  parts.push(`<rect x="16" y="${y}" width="${w - 32}" height="22" fill="#fafaf9"/>`)
  for (const [x, width] of COLUMNS) {
    parts.push(
      `<rect x="${x}" y="${y + 8}" width="${width * 0.7}" height="6" rx="2" fill="#c9c6c3"/>`
    )
  }
  for (let r = 0; r < rows; r++) {
    const ry = y + 22 + r * 24
    const dim = s.dimFrom !== undefined && r >= s.dimFrom
    const ink = dim ? '#e6e4e1' : '#a3a19f'
    parts.push(`<line x1="16" y1="${ry}" x2="${w - 16}" y2="${ry}" stroke="#ebeae9"/>`)
    for (const [i, [x, width]] of COLUMNS.entries()) {
      parts.push(
        `<rect x="${x}" y="${ry + 9}" width="${width - ((r * 7 + i * 5) % 20)}" height="6" rx="2" fill="${ink}"/>`
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
        `<text x="242" y="${ry + 17}" font-size="10" font-weight="${i === 0 ? 600 : 400}" fill="#282725">${esc(label)}</text>`
      )
      parts.push(
        `<rect x="412" y="${ry + 6}" width="48" height="16" rx="4" fill="${i === 0 ? '#282725' : '#f4f4f3'}"/>`
      )
    }
    parts.push(`<rect x="408" y="38" width="56" height="24" ${RING}/>`)
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * 2}" height="${h * 2}" viewBox="0 0 ${w} ${h}" font-family="-apple-system, system-ui, sans-serif">${parts.join('')}</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const ask = (now: number): Report => ({
  at: now - 3 * MIN,
  chatId: 'chat-menus',
  choices: [
    {
      open: false,
      setAside: 'un bandeau qui leur demande de vérifier chaque fiche',
      text: 'Les totaux faux sont corrigés sans rien demander aux secrétaires',
    },
    {
      open: true,
      text: 'Comment réparer les 212 dossiers déjà faux : en base, ou par un bouton dans la fiche ?',
    },
    {
      open: false,
      setAside: 'aucune trace visible',
      text: 'Une ligne « Total recalculé le 18/11 » sur la fiche, pendant 30 jours',
    },
  ],
  feature:
    'La fiche facture d’un dossier patient. Les secrétaires y lisent le total à encaisser et la part de la mutuelle, au guichet, patient en face.',
  left: [],
  links: [{ label: 'RAI-2051 on Linear', url: 'https://linear.app/labo/issue/RAI-2051' }],
  problem:
    'Une secrétaire ouvre un dossier de septembre : total 0,00 € alors que trois analyses ont été faites. Elle refait le calcul à la main, ou laisse partir le patient sans encaisser.',
  screens: [],
  state: 'question',
  summary:
    'Le total était remis à zéro quand une analyse était ajoutée après la validation. Le calcul est corrigé ; reste à savoir comment réparer les dossiers déjà faux.',
  ticket: 'RAI-2051',
  title: 'Totaux de facture à 0 €',
  workspaceId: 'ws-amber',
})

const review = (now: number): Report => ({
  at: now - 41 * MIN,
  chatId: 'chat-notes',
  choices: [
    {
      open: false,
      setAside: 'un champ en haut de la liste Dossiers seulement',
      text: 'La recherche est dans la barre du haut, sur toutes les pages (⌘K)',
    },
    {
      open: false,
      setAside: '« Nouveau devis » d’abord',
      text: 'Chaque résultat a deux boutons : « Ouvrir » d’abord, « Nouveau devis » ensuite',
    },
    {
      open: false,
      setAside: 'aussi dans les notes internes, trop de bruit',
      text: 'On cherche dans le n° de dossier, le nom du client et la destination',
    },
    { open: false, setAside: 'masqués', text: 'Les dossiers annulés sortent en dernier, grisés' },
  ],
  feature: 'La liste des dossiers du back-office, où les agents retrouvent un voyage en cours.',
  left: [],
  links: [],
  problem:
    'Pour retrouver un dossier, un agent fait défiler la liste ou filtre colonne par colonne : une minute par appel client.',
  screens: [
    {
      after: shot({ button: { label: 'Nouveau devis' }, search: { new: true }, title: 'Dossiers' }),
      before: shot({ button: { label: 'Nouveau devis' }, title: 'Dossiers' }),
      step: 'La barre du haut',
    },
    {
      after: shot({
        results: ['D-0412 · Famille Morel', 'D-0405 · Famille Moreau', 'C-1187 · Mme Morin'],
        rows: 5,
        search: { text: 'mor' },
        title: 'Dossiers',
      }),
      before: shot({
        rows: 4,
        strip: { label: 'N° dossier   ·   Client   ·   Destination   ·   Filtrer' },
        title: 'Dossiers',
      }),
      step: 'Trouver un dossier',
    },
    {
      after: shot({ dimFrom: 4, search: {}, title: 'Dossiers · annulés en dernier' }),
      before: shot({ search: {}, title: 'Dossiers · annulés en dernier' }),
      step: 'Les dossiers annulés',
    },
  ],
  state: 'review',
  summary:
    'Une recherche dans la barre du haut retrouve un dossier en trois lettres, de n’importe quelle page.',
  ticket: '#335',
  title: 'Recherche de dossier',
  workspaceId: 'ws-teal',
})

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
      after: shot({
        badge: { label: 'Corbeille 12 j', new: true },
        nav: 'Comptes-rendus   Réglages',
        title: 'Brouillons',
      }),
      before: shot({ nav: 'Comptes-rendus   Réglages', title: 'Brouillons' }),
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
  left: ['Merger la PR', 'Vérifier lundi la caisse du guichet 2'],
  links: [
    { label: 'PR #128', url: 'https://github.com/nbardavid/logit/pull/128' },
    { label: 'RAI-2051 on Linear', url: 'https://linear.app/labo/issue/RAI-2051' },
  ],
  state: 'ready',
  summary: 'Le total est juste à nouveau, et les 212 dossiers faux sont réparés en base.',
})

/** Every fixture report, by workspace. */
export function reportFixtures(now: number, flags: URLSearchParams): Record<string, Report> {
  return Object.fromEntries(
    [
      flags.has('merged') ? shipped(now) : ask(now),
      review(now),
      flags.has('report-done') ? done(now) : ready(now),
      blocked(now),
      long(now),
    ].map((r) => [r.workspaceId, r])
  )
}

/** The question amber's chat asks with AskUserQuestion, as its report says it. */
export const REPORT_QUESTION = {
  header: 'Réparation',
  multiSelect: false,
  options: [
    {
      description: 'Une migration ponctuelle : les 212 fiches sont justes demain matin.',
      label: 'Réparer en base (Recommended)',
    },
    {
      description: 'La secrétaire corrige quand elle ouvre un dossier à 0 €.',
      label: 'Bouton « Recalculer » dans la fiche',
    },
    { description: 'Migration maintenant, bouton pour les cas à venir.', label: 'Les deux' },
  ],
  question: 'Comment réparer les 212 dossiers déjà faux : en base, ou par un bouton ?',
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
    screens: [review(now).screens[0] ?? { step: '' }],
    state: 'review',
    summary: 'Les 212 dossiers sont réparés en base ; voici la fiche avant et après.',
  }
}
