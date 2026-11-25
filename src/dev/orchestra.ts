// An orchestrator's children: workspaces amber's first chat started with logit's MCP (and one
// coral's started in turn). They sit in the sidebar under amber, plum under coral, which is
// folded (`KIDS_FOLDED`) so its row says that plum, below, asks.
import type { Catalog, ChatRecord, Workspace } from '../model/catalog'
import type { Report } from '../model/report'

const MIN = 60_000

const KIDS = [
  { colour: 'coral', minutes: 30, parent: 'chat-menus', task: 'Agents tab in the right panel' },
  { colour: 'sage', minutes: 25, parent: 'chat-menus', task: 'workspace_stop in the MCP server' },
  { colour: 'ochre', minutes: 20, parent: 'chat-menus', task: 'Hide child workspaces' },
  { colour: 'plum', minutes: 8, parent: 'chat-coral', task: 'Tests for the agent tree' },
  // In atlas, under cobalt: a second folder, in cobalt's blue.
  { colour: 'iris', minutes: 14, parent: 'chat-cobalt', task: 'Refund emails' },
]

/** Each starting chat's workspace and project. */
const PARENTS: Record<string, { workspace: string; project: string }> = {
  'chat-cobalt': { project: 'p-atlas', workspace: 'ws-cobalt' },
  'chat-coral': { project: 'p-logit', workspace: 'ws-coral' },
  'chat-menus': { project: 'p-logit', workspace: 'ws-amber' },
}

const kidChats = (now: number): ChatRecord[] =>
  KIDS.map((k) => ({
    activeAt: now - k.minutes * MIN,
    createdAt: now - (k.minutes + 5) * MIN,
    effort: 'high',
    id: `chat-${k.colour}`,
    model: 'sonnet',
    sessionId: null,
    title: k.task,
    workspaceId: `ws-${k.colour}`,
  }))

const kidWorkspaces = (now: number, catalog: Catalog): Workspace[] =>
  KIDS.map((k) => ({
    base: 'origin/main',
    branch: `logit/${k.colour}`,
    createdAt: now - (k.minutes + 5) * MIN,
    id: `ws-${k.colour}`,
    name: k.colour,
    parentChat: k.parent,
    parentWorkspace: PARENTS[k.parent]?.workspace,
    path: (
      catalog.workspaces.find((w) => w.id === PARENTS[k.parent]?.workspace)?.path ?? ''
    ).replace(/[^/]+$/, k.colour),
    projectId: PARENTS[k.parent]?.project ?? 'p-logit',
    setup: null,
  }))

/** Coral at work, sage finished with its PR ready, ochre waiting on a question, plum (folded
 * under coral) finished and unread. */
export const KID_HOST_CHATS = [
  { alive: true, historyLen: 0, id: 'chat-coral', unread: false, waiting: false, working: true },
  { alive: true, historyLen: 0, id: 'chat-sage', unread: true, waiting: false, working: false },
  { alive: true, historyLen: 0, id: 'chat-ochre', unread: false, waiting: true, working: true },
  { alive: true, historyLen: 0, id: 'chat-plum', unread: true, waiting: false, working: false },
  { alive: true, historyLen: 0, id: 'chat-iris', unread: false, waiting: false, working: true },
]

/** The parents folded on a first visit (until the viewer unfolds one). */
export const KIDS_FOLDED = ['ws-coral']

/** The fixture catalog with amber's children added. */
export function withKids(catalog: Catalog, now: number): Catalog {
  const amber = catalog.workspaces.find((w) => w.id === 'ws-amber')
  if (amber === undefined) return catalog
  return {
    ...catalog,
    chats: [...catalog.chats, ...kidChats(now)],
    workspaces: [...catalog.workspaces, ...kidWorkspaces(now, catalog)],
  }
}

/** ochre's page asks a question, sage's has its PR ready (coral's and plum's are in
 * reports.ts). */
export function kidReports(now: number): Record<string, Report> {
  const at = (colour: string) => now - (KIDS.find((k) => k.colour === colour)?.minutes ?? 0) * MIN
  return {
    'ws-ochre': {
      at: at('ochre'),
      chatId: 'chat-ochre',
      sections: {},
      state: 'question',
      summary: 'How do sub-workspaces first show in the sidebar?',
      title: 'Hide child workspaces',
      workspaceId: 'ws-ochre',
    },
    'ws-sage': {
      at: at('sage'),
      chatId: 'chat-sage',
      sections: {},
      state: 'ready',
      summary: 'workspace_stop is in, its PR open and green.',
      title: 'workspace_stop in the MCP server',
      workspaceId: 'ws-sage',
    },
  }
}
