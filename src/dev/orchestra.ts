// An orchestrator's children: workspaces amber's first chat started with logit's MCP (and one
// coral's started in turn). They leave the sidebar for amber's Agents tab.
import type { Catalog, ChatRecord, Workspace } from '../model/catalog'

const MIN = 60_000

const KIDS = [
  { colour: 'coral', minutes: 30, parent: 'chat-menus', task: 'Agents tab in the right panel' },
  { colour: 'sage', minutes: 25, parent: 'chat-menus', task: 'workspace_stop in the MCP server' },
  { colour: 'ochre', minutes: 20, parent: 'chat-menus', task: 'Hide child workspaces' },
  { colour: 'plum', minutes: 8, parent: 'chat-coral', task: 'Tests for the agent tree' },
]

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

const kidWorkspaces = (now: number, amber: string): Workspace[] =>
  KIDS.map((k) => ({
    base: 'origin/main',
    branch: `logit/${k.colour}`,
    createdAt: now - (k.minutes + 5) * MIN,
    id: `ws-${k.colour}`,
    name: k.colour,
    parentChat: k.parent,
    parentWorkspace: k.parent === 'chat-menus' ? 'ws-amber' : 'ws-coral',
    path: amber.replace(/amber$/, k.colour),
    projectId: 'p-logit',
    setup: null,
  }))

/** Coral at work, sage finished and unread, ochre waiting on a question. */
export const KID_HOST_CHATS = [
  { alive: true, historyLen: 0, id: 'chat-coral', unread: false, waiting: false, working: true },
  { alive: true, historyLen: 0, id: 'chat-sage', unread: true, waiting: false, working: false },
  { alive: true, historyLen: 0, id: 'chat-ochre', unread: false, waiting: true, working: true },
]

/** The fixture catalog with amber's children added. */
export function withKids(catalog: Catalog, now: number): Catalog {
  const amber = catalog.workspaces.find((w) => w.id === 'ws-amber')
  if (amber === undefined) return catalog
  return {
    ...catalog,
    chats: [...catalog.chats, ...kidChats(now)],
    workspaces: [...catalog.workspaces, ...kidWorkspaces(now, amber.path)],
  }
}
