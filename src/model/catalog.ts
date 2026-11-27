// What the app keeps on disk (store.rs): projects, their worktrees, the chats open in them.

export interface Project {
  id: string
  name: string
  path: string
  lastOpenedAt: number
  /** The tone picked in Settings › Projects; absent follows the name. */
  color?: string
  /** The avatar's icon picked there; absent shows the initial. */
  icon?: string
  /** The Claude accounts its chats run as, picked in its settings; absent is the default one. */
  accounts?: string[]
  /** Its workspaces may run on Boat, billed to this wallet; absent is off. */
  boat?: BoatTarget | null
}

/** Where a Boat sandbox is billed: an organization, or the user's own wallet (no org). */
export interface BoatTarget {
  org?: string | null
}

export interface Workspace {
  id: string
  projectId: string
  name: string
  branch: string
  /** What it forked from: `origin/<base>` when the base was refreshed first. */
  base: string
  path: string
  createdAt: number
  setup?: { exitCode: number | null; ranAt: number } | null
  /** What its chats published with Claude Code's `Artifact` tool: the right panel's tabs. */
  artifacts?: Artifact[]
  /** The chat whose agent created it through logit's MCP server. */
  parentChat?: string
  /** That chat's workspace, kept at creation: the tree holds once the chat is closed. */
  parentWorkspace?: string
  /** Put aside by the user: muted in the sidebar until a message is sent in it. */
  paused?: boolean
  /** Its Claude runs on a Boat sandbox of its own. */
  boat?: BoatTarget | null
}

/** A published artifact: its claude.ai page, a tab of the right panel until closed. */
export interface Artifact {
  url: string
  title: string
  chatId: string
  /** When it was last published (ms). */
  at: number
  seenAt?: number | null
  /** Kept when closed, so a replayed history doesn't bring it back. */
  closed?: boolean
}

/** Published again (or never opened) since it was last on screen. */
export const isNew = (a: Artifact) => a.seenAt == null || a.seenAt < a.at

export interface ChatRecord {
  id: string
  workspaceId: string
  title: string
  sessionId: string | null
  model: string
  effort: string
  createdAt: number
  /** When a turn last started or ended (ms): the sidebar's age. Absent in older catalogs. */
  activeAt?: number
  /** The Claude account picked for this chat (`chatAccount`); absent, its project's pick. */
  account?: string
}

export interface Catalog {
  projects: Project[]
  workspaces: Workspace[]
  chats: ChatRecord[]
}

export type Signal = 'waiting' | 'working' | 'done'

/** Each project's workspaces in the catalog's order: the sidebar's, as the user dragged it. */
export function byProject(catalog: Catalog): Record<string, Workspace[]> {
  const out: Record<string, Workspace[]> = {}
  for (const project of catalog.projects) out[project.id] = []
  for (const ws of catalog.workspaces) {
    out[ws.projectId]?.push(ws)
  }
  return out
}

/** What a row should call attention to: a question beats work in progress beats a finished turn. */
export function strongest(signals: readonly (Signal | null)[]): Signal | null {
  if (signals.includes('waiting')) return 'waiting'
  if (signals.includes('working')) return 'working'
  if (signals.includes('done')) return 'done'
  return null
}

/** `list` with the items `ids` names in that order, the others after them as they were. */
export function arrange<T extends { id: string }>(list: readonly T[], ids: readonly string[]): T[] {
  const rank = (id: string) => (ids.includes(id) ? ids.indexOf(id) : ids.length)
  return list.toSorted((a, b) => rank(a.id) - rank(b.id))
}

/** The workspace a workspace was created from: the one holding the chat whose agent made it. */
export function parentOf(catalog: Catalog, ws: Workspace): string | null {
  const parent =
    ws.parentWorkspace ?? catalog.chats.find((c) => c.id === ws.parentChat)?.workspaceId
  // A deleted parent gives its children back to the sidebar.
  return parent !== undefined && parent !== ws.id && catalog.workspaces.some((w) => w.id === parent)
    ? parent
    : null
}

/** Each workspace's children (made by an agent of one of its chats), in the catalog's order. */
export function childrenOf(catalog: Catalog): Record<string, Workspace[]> {
  const out: Record<string, Workspace[]> = {}
  for (const ws of catalog.workspaces) {
    const parent = parentOf(catalog, ws)
    if (parent !== null) (out[parent] ??= []).push(ws)
  }
  return out
}

/** Everything under `id`, at any depth. */
export function descendants(children: Record<string, Workspace[]>, id: string): Workspace[] {
  const out: Workspace[] = []
  const seen = new Set([id])
  const walk = (at: string) => {
    for (const child of children[at] ?? []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      out.push(child)
      walk(child.id)
    }
  }
  walk(id)
  return out
}
