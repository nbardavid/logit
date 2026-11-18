// Desk (⌘0) across three projects, twelve workspaces, every group and state. A third project,
// atlas (a booking back-office): cobalt reported a question with screens and its chat waits on
// it (the first row Desk opens on; answering it moves the row), olive has three steps of screens
// to review, moss's PR is ready with its checks green, fern is at work. In logit, amber's chat
// lives in fixtures.ts (a Bash permission over a question report), and its children get their
// chats here: ochre waits on a question it never reported, sage finished a turn not read yet,
// coral is at work. pragma-once (in French): basil is blocked with its chat closed (Reopen
// resumes its session), violet's ready report is older than its chat. plum is done (its report
// is in reports.ts). `?no-desk` leaves atlas and these chats out.
import type { Catalog, ChatRecord, Workspace } from '../model/catalog'
import type { Report } from '../model/report'

import {
  assistant,
  initAnswer,
  LIVE,
  PATHS,
  result,
  sent,
  systemInit,
  toolResult,
  TREES,
} from './fixtures'
import { shot } from './reports'

const MIN = 60_000
const HOUR = 60 * MIN
const line = (value: unknown) => JSON.stringify(value)

const ATLAS = {
  cobalt: { minutes: 24, task: 'Refund flow for cancelled trips' },
  fern: { minutes: 2, task: 'Faster search on the bookings list' },
  moss: { minutes: 35, task: 'Seat map on the coach booking' },
  olive: { minutes: 12, task: 'Search the bookings list' },
} as const

type Colour = keyof typeof ATLAS

const COLOURS = Object.keys(ATLAS) as Colour[]

const chatRecords = (now: number): ChatRecord[] =>
  COLOURS.map((c) => {
    const { minutes, task } = ATLAS[c]
    return {
      activeAt: now - minutes * MIN,
      createdAt: now - (minutes + 40) * MIN,
      effort: 'high',
      id: `chat-${c}`,
      model: 'opus',
      sessionId: `session-${c}`,
      title: task,
      workspaceId: `ws-${c}`,
    }
  })

const workspaces = (now: number): Workspace[] =>
  COLOURS.map((c) => ({
    base: 'origin/main',
    branch: `logit/${c}`,
    createdAt: now - (ATLAS[c].minutes + 60) * MIN,
    id: `ws-${c}`,
    name: c,
    path: `${TREES}/atlas/${c}`,
    projectId: 'p-atlas',
    setup: null,
  }))

/** The catalog with atlas added. */
export function withDesk(catalog: Catalog, now: number): Catalog {
  return {
    chats: [...catalog.chats, ...chatRecords(now)],
    projects: [
      ...catalog.projects,
      { id: 'p-atlas', lastOpenedAt: now - 2 * HOUR, name: 'atlas', path: '/Users/dev/dev/atlas' },
    ],
    workspaces: [...catalog.workspaces, ...workspaces(now)],
  }
}

export const COBALT_QUESTION = {
  header: 'Refund',
  multiSelect: false,
  options: [
    {
      description: 'The customer gets the money back in 3 to 5 days, no agent involved.',
      label: 'Refund to the card automatically (Recommended)',
    },
    {
      description: 'An agent checks each refund first; slower, but nothing leaves unseen.',
      label: 'An agent approves each refund',
    },
    {
      description: 'A credit note the customer spends on their next trip.',
      label: 'Credit note only',
    },
  ],
  question: 'When a trip is cancelled, how does the customer get the money back?',
}

const OCHRE_QUESTION = {
  header: 'Children',
  multiSelect: false,
  options: [
    {
      description: 'One place to follow what an orchestrator started, the sidebar stays short.',
      label: 'Under their parent, in its Agents tab (Recommended)',
    },
    {
      description: 'Seen at a glance, but the list grows with every run.',
      label: 'In the sidebar, folded under the parent',
    },
  ],
  question: 'Once a child workspace leaves the sidebar, where does it show?',
}

const reportLines = (c: string, state: Report['state']) => [
  assistant(`m-${c}-report`, [
    { id: `tool-${c}-report`, input: { state }, name: 'mcp__logit__report', type: 'tool_use' },
  ]),
  toolResult(`tool-${c}-report`, `Reported (${state}).`),
]

const askLines = (id: string, question: unknown) => [
  assistant(`m-${id}-ask`, [
    {
      id: `tool-${id}-ask`,
      input: { questions: [question] },
      name: 'AskUserQuestion',
      type: 'tool_use',
    },
  ]),
  line({
    request: {
      input: { questions: [question] },
      permission_suggestions: [],
      subtype: 'can_use_tool',
      tool_name: 'AskUserQuestion',
      tool_use_id: `tool-${id}-ask`,
    },
    request_id: `perm-${id}-ask`,
    type: 'control_request',
  }),
]

const opening = (c: string, prompt: string) => [
  initAnswer(`chat-${c}`),
  systemInit(`session-${c}`, 'claude-opus-5-5'),
  sent(`u-${c}-1`, prompt),
]

/** What the host replays of the Desk's running chats. */
export const DESK_LINES: Record<string, string[]> = {
  'chat-cobalt': [
    ...opening('cobalt', 'Cancelled trips need a refund flow; see ticket ATL-88.'),
    assistant('m-cobalt-1', [{ text: 'The cancellation screen is in place.', type: 'text' }]),
    ...reportLines('cobalt', 'question'),
    ...askLines('cobalt', COBALT_QUESTION),
    LIVE,
  ],
  'chat-coral': [
    ...opening('coral', 'Add an Agents tab to the right panel: the workspaces this chat started.'),
    assistant('m-coral-1', [
      { text: 'The tree is drawn; wiring the stop button.', type: 'text' },
      {
        id: 'tool-coral-edit',
        input: { file_path: 'src/app/agents.tsx', new_string: '', old_string: '' },
        name: 'Edit',
        type: 'tool_use',
      },
    ]),
    LIVE,
  ],
  'chat-fern': [
    ...opening('fern', 'The bookings list takes 4 s to search; make it instant.'),
    assistant('m-fern-1', [
      { text: 'Profiling the search query first.', type: 'text' },
      {
        id: 'tool-fern-grep',
        input: { pattern: 'searchBookings' },
        name: 'Grep',
        type: 'tool_use',
      },
    ]),
    LIVE,
  ],
  'chat-moss': [
    ...opening('moss', 'Coach bookings need a seat map; ticket ATL-79.'),
    assistant('m-moss-1', [{ text: 'The PR is open and green.', type: 'text' }]),
    ...reportLines('moss', 'ready'),
    result(1.84, 600_000),
    LIVE,
  ],
  'chat-ochre': [
    ...opening('ochre', 'Child workspaces should leave the sidebar; find them a place.'),
    assistant('m-ochre-1', [
      {
        text: 'Children are filtered out of the sidebar now. One thing to settle first.',
        type: 'text',
      },
    ]),
    ...askLines('ochre', OCHRE_QUESTION),
    LIVE,
  ],
  'chat-olive': [
    ...opening('olive', 'Agents need to search the bookings list; ticket ATL-93.'),
    assistant('m-olive-1', [{ text: 'The search bar is in, with screens.', type: 'text' }]),
    ...reportLines('olive', 'review'),
    result(1.12, 420_000),
    LIVE,
  ],
  'chat-sage': [
    ...opening('sage', 'Add workspace_stop to the MCP server.'),
    assistant('m-sage-1', [
      {
        text: 'Added `workspace_stop`: it interrupts the workspace’s chats and leaves its worktree as it is.\n\nThe tool is listed in the server’s instructions; tests pass.',
        type: 'text',
      },
    ]),
    result(0.42, 180_000),
    LIVE,
  ],
}

/** basil's chat, closed: its session, which Reopen resumes. */
export const DESK_SESSIONS = (now: number) => [
  {
    cwd: PATHS.basil,
    firstPrompt: 'Le médecin veut le compte-rendu en PDF ; ticket #63.',
    id: 'session-basil',
    sizeBytes: 210_000,
    title: 'Compte-rendu en PDF',
    updatedAt: now - 50 * MIN,
  },
]

export const DESK_TRANSCRIPTS: Record<string, string[]> = {
  'session-basil': [
    initAnswer('chat-basil'),
    systemInit('session-basil', 'claude-opus-5-5'),
    sent('u-basil-1', 'Le médecin veut le compte-rendu en PDF ; ticket #63.'),
    assistant('m-basil-1', [
      {
        text: 'Bloqué : il faut se connecter au labo de test pour vérifier le PDF à l’écran.',
        type: 'text',
      },
    ]),
    result(0.9, 300_000),
  ],
}

/** Their states in the host's list (amber's children are in orchestra.ts). */
export const DESK_HOST_CHATS = [
  { alive: true, historyLen: 0, id: 'chat-cobalt', unread: false, waiting: true, working: true },
  { alive: true, historyLen: 0, id: 'chat-olive', unread: false, waiting: false, working: false },
  { alive: true, historyLen: 0, id: 'chat-moss', unread: false, waiting: false, working: false },
  { alive: true, historyLen: 0, id: 'chat-fern', unread: false, waiting: false, working: true },
]

/** The pending questions, so answering one in the preview gets a reply. */
export const DESK_ASKED: [string, { chatId: string; prompt: string; toolId: string }][] = [
  ['perm-cobalt-ask', { chatId: 'chat-cobalt', prompt: 'the refund', toolId: 'tool-cobalt-ask' }],
  ['perm-ochre-ask', { chatId: 'chat-ochre', prompt: 'the children', toolId: 'tool-ochre-ask' }],
]

const base = (c: Colour) => ({
  chatId: `chat-${c}`,
  choices: [],
  left: [],
  links: [],
  screens: [],
  workspaceId: `ws-${c}`,
})

/** atlas's reports: cobalt's question, olive's review, moss's ready PR. */
export function deskReports(now: number): Record<string, Report> {
  const reports: Report[] = [
    {
      ...base('cobalt'),
      at: now - 24 * MIN,
      choices: [
        {
          open: false,
          setAside: 'a separate cancellations page',
          text: 'Cancel from the booking page itself',
        },
        { open: true, text: COBALT_QUESTION.question },
        {
          open: false,
          setAside: 'only the agent who took the booking',
          text: 'Any agent can cancel, the log says who',
        },
      ],
      feature: 'Agents cancel a trip from the booking page while the customer is on the phone.',
      problem:
        'Today a cancelled trip keeps the customer’s money until someone remembers to refund it by hand, sometimes weeks later.',
      screens: [
        {
          after: shot({
            button: { label: 'Cancel trip', new: true },
            rows: 5,
            title: 'Booking B-2291',
          }),
          before: shot({ button: { label: 'Edit' }, rows: 5, title: 'Booking B-2291' }),
          step: 'The booking page',
        },
      ],
      state: 'question',
      summary: 'Cancelling works from the booking page; how the money goes back is yours to pick.',
      ticket: 'ATL-88',
      title: 'Refund flow for cancelled trips',
    },
    {
      ...base('olive'),
      at: now - 12 * MIN,
      choices: [
        {
          open: false,
          setAside: 'a field over the bookings list only',
          text: 'Search sits in the top bar, on every page (⌘K)',
        },
        {
          open: false,
          setAside: '"New quote" first',
          text: 'Each result has two buttons: "Open" first, "New quote" after',
        },
        {
          open: false,
          setAside: 'internal notes too, too much noise',
          text: 'It searches booking number, customer name and destination',
        },
        { open: false, setAside: 'hidden', text: 'Cancelled bookings come last, greyed out' },
      ],
      feature: 'Agents find a booking by name, number or city while a customer is on the line.',
      problem: 'Today they scroll the list or filter column by column: about a minute per call.',
      screens: [
        {
          after: shot({ button: { label: 'New quote' }, search: { new: true }, title: 'Bookings' }),
          before: shot({ button: { label: 'New quote' }, title: 'Bookings' }),
          step: 'The top bar',
        },
        {
          after: shot({
            results: ['B-2291 · Martin, Claire', 'B-2304 · Martinez, Noé', 'B-2187 · Martel, Ana'],
            rows: 5,
            search: { text: 'mart' },
            title: 'Bookings',
          }),
          before: shot({
            rows: 4,
            strip: { label: 'Booking    ·    Customer    ·    City    ·    Filter' },
            title: 'Bookings',
          }),
          step: 'Finding a booking',
        },
        {
          after: shot({ dimFrom: 4, search: {}, title: 'Bookings' }),
          before: shot({ search: {}, title: 'Bookings' }),
          step: 'Cancelled bookings',
        },
      ],
      state: 'review',
      summary:
        'A search in the top bar finds a booking in three letters, from any page. Three screens to check before the PR.',
      ticket: 'ATL-93',
      title: 'Search the bookings list',
    },
    {
      ...base('moss'),
      at: now - 35 * MIN,
      blocks: [
        { items: ['Run the seat migration on production after the merge'], kind: 'left' },
        {
          branch: 'feat/coach-seat-map',
          ci: 'passing',
          kind: 'pr',
          number: 418,
          review: 'approved',
          title: 'Seat map on the coach booking',
          url: 'https://github.com/atlas/booking/pull/418',
        },
        {
          items: [
            { detail: '412 of 412', status: 'done', text: 'Unit tests pass' },
            { detail: '18 of 18', status: 'done', text: 'Booking flow passes end to end' },
            { status: 'done', text: 'Lint and types pass' },
          ],
          kind: 'steps',
        },
        {
          items: [
            {
              setAside: 'a list of seat numbers',
              text: 'The customer picks a seat on a drawn map',
            },
            { setAside: 'no hold', text: 'A seat is held 10 minutes while the customer pays' },
          ],
          kind: 'decisions',
        },
      ],
      links: [
        {
          label: 'PR #418 · Seat map on the coach booking',
          url: 'https://github.com/atlas/booking/pull/418',
        },
      ],
      state: 'ready',
      summary: 'Checks are green and the PR is reviewed; the migration on production stays yours.',
      ticket: 'ATL-79',
      title: 'Seat map on the coach booking',
    },
  ]
  return Object.fromEntries(reports.map((r) => [r.workspaceId, r]))
}
