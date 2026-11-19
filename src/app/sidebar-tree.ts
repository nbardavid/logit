// Sub-workspaces: the workspaces a chat started with logit's MCP (`workspace_create`) sit in
// the sidebar right under the workspace that made them, indented, their children under them.
// Pure, so the order and the guides are tested apart from the screen.
import {
  type Catalog,
  childrenOf,
  descendants,
  parentOf,
  type Signal,
  strongest,
  type Workspace,
} from '../model/catalog'
import { chatSignal, type ChatTab } from './use-chats'

export interface TreeRow {
  ws: Workspace
  /** 0 for a workspace with no parent in the same list. */
  depth: number
  /** The last of its siblings: its guide stops at its own row. */
  last: boolean
  /** For each level above its parent's, whether a guide still runs past this row. */
  rails: boolean[]
  /** Its parent's id in this list, or null. */
  parent: string | null
  /** How many rows sit under it, at any depth. */
  below: number
}

/**
 * `list` in tree order: each workspace followed by its children, depth first, every level in
 * the list's own order. A child whose parent is not in `list` (parked apart, or deleted) is a
 * top row of its own.
 */
export function treeRows(
  list: readonly Workspace[],
  parents: Readonly<Record<string, string>>
): TreeRow[] {
  const ids = new Set(list.map((w) => w.id))
  const up = (w: Workspace) => {
    const p = parents[w.id]
    return p !== undefined && ids.has(p) && p !== w.id ? p : null
  }
  const kids: Record<string, Workspace[]> = {}
  for (const w of list) {
    const p = up(w)
    if (p !== null) (kids[p] ??= []).push(w)
  }
  const out: TreeRow[] = []
  const seen = new Set<string>()
  const walk = (ws: Workspace, depth: number, last: boolean, rails: boolean[]) => {
    if (seen.has(ws.id)) return
    seen.add(ws.id)
    const row: TreeRow = { below: 0, depth, last, parent: up(ws), rails, ws }
    out.push(row)
    const start = out.length
    const mine = (kids[ws.id] ?? []).filter((k) => !seen.has(k.id))
    const next = depth === 0 ? rails : [...rails, !last]
    for (const [i, k] of mine.entries()) walk(k, depth + 1, i === mine.length - 1, next)
    row.below = out.length - start
  }
  for (const w of list) if (up(w) === null) walk(w, 0, true, [])
  // A loop of parents has no top: its rows still show, at the top level.
  for (const w of list) walk(w, 0, true, [])
  return out
}

/** Each sub-workspace's parent, by id. */
export function parentsOf(catalog: Catalog): Record<string, string> {
  const out: Record<string, string> = {}
  for (const w of catalog.workspaces) {
    const p = parentOf(catalog, w)
    if (p !== null) out[w.id] = p
  }
  return out
}

/** `ws` and everything it started, at any depth: what Park takes along. */
export function withDescendants(catalog: Catalog, ws: Workspace): Workspace[] {
  return [ws, ...descendants(childrenOf(catalog), ws.id)]
}

/** What deleting `ws` does to the workspaces its agents started: they stay, as top rows. */
export function kidsNote(catalog: Catalog, ws: Workspace): string {
  const n = descendants(childrenOf(catalog), ws.id).length
  if (n === 0) return ''
  return ` The ${n} ${n === 1 ? 'workspace' : 'workspaces'} it started stay in the sidebar.`
}

/** What each workspace's own chats call attention to: a parent never speaks for its children. */
export function signalsOf(
  workspaces: readonly Workspace[],
  chats: readonly ChatTab[]
): Record<string, Signal | null> {
  const out: Record<string, Signal | null> = {}
  for (const w of workspaces) {
    out[w.id] = strongest(chats.filter((c) => c.record.workspaceId === w.id).map(chatSignal))
  }
  return out
}
