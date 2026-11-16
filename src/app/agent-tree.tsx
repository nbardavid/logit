// The right panel's Agents view: the workspaces an orchestrating chat started (with
// logit's MCP `workspace_create`), as a tree under the workspace that made them.
import { BotIcon } from 'lucide-react'
import { type MouseEvent, useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

import {
  type Catalog,
  childrenOf,
  descendants,
  parentOf,
  type Project,
  type Signal,
  strongest,
  withoutChildren,
  type Workspace,
} from '../model/catalog'
import { ageLabel, type ChatFacts, type DiffStat, workspaceFacts } from './sidebar'
import { StatusDot } from './status-dot'
import { RenameField } from './tab-bar'
import { chatSignal, type ChatTab } from './use-chats'

export interface AgentTreeProps {
  /** The top of the tree: the workspace with no parent above the one on screen. */
  root: Workspace
  tree: Record<string, Workspace[]>
  /** The workspace on screen. */
  currentId: string
  signals: Record<string, Signal | null>
  diffs: Record<string, DiffStat>
  chats: readonly ChatFacts[]
  onOpen: (ws: Workspace) => void
  /** Its right-click menu, the sidebar row's: rename, pause, delete… */
  onMenu: (ws: Workspace, e: MouseEvent) => void
  /** The workspace whose name is being edited in place. */
  renamingId: string | null
  onRenamed: (ws: Workspace, name: string | null) => void
}

const colourWord = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** What each workspace's own chats call attention to. */
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

/** Each workspace's signal with its whole tree's: a child at work or waiting shows on its
 * parent's row. */
export function rollUp(
  workspaces: readonly Workspace[],
  tree: Record<string, Workspace[]>,
  signals: Record<string, Signal | null>
): Record<string, Signal | null> {
  const out: Record<string, Signal | null> = {}
  for (const w of workspaces) {
    const below = descendants(tree, w.id).map((d) => signals[d.id] ?? null)
    out[w.id] = strongest([signals[w.id] ?? null, ...below])
  }
  return out
}

/** What deleting `ws` does to the workspaces its agents made: they stay, back in the sidebar. */
export function kidsNote(catalog: Catalog, ws: Workspace): string {
  const n = descendants(childrenOf(catalog), ws.id).length
  if (n === 0) return ''
  return ` The ${n} ${n === 1 ? 'workspace' : 'workspaces'} its agents started stay, back in the sidebar.`
}

/** The top of `ws`'s tree: its parent's parent's…, or itself. */
export function rootOf(catalog: Catalog, ws: Workspace): Workspace {
  let at = ws
  for (let hops = 0; hops < 32; hops++) {
    const up = parentOf(catalog, at)
    const parent = catalog.workspaces.find((x) => x.id === up)
    if (parent === undefined) break
    at = parent
  }
  return at
}

/**
 * The workspace tree around the one on screen: the sidebar's signals (a row speaks for its
 * whole tree, so a child at work or waiting shows on its parent), the row it highlights (the
 * tree's top), and the right panel's Agents tab.
 */
export function agentTree(at: {
  catalog: Catalog
  /** Each project's workspaces, in sidebar order. */
  workspaces: Record<string, Workspace[]>
  ws: Workspace | undefined
  signals: Record<string, Signal | null>
  diffs: Record<string, DiffStat>
  chats: readonly ChatFacts[]
  onOpen: (projectId: string, workspaceId: string) => void
  projects: readonly Project[]
  /** The sidebar's row menu. */
  menu: (row: {
    kind: 'workspace'
    project: Project
    workspace: Workspace
    x: number
    y: number
  }) => void
  renamingId: string | null
  onRenamed: (ws: Workspace, name: string | null) => void
  /** Sets a workspace's right panel view before it comes on screen. */
  setViewOf: (workspaceId: string, view: 'agents') => void
}) {
  const { catalog, signals, ws } = at
  const tree = childrenOf(catalog)
  const root = ws === undefined ? undefined : rootOf(catalog, ws)
  return {
    agents: {
      count: root ? descendants(tree, root.id).length : 0,
      tree: root && ws && (
        <AgentTree
          root={root}
          tree={tree}
          currentId={ws.id}
          signals={signals}
          diffs={at.diffs}
          chats={at.chats}
          renamingId={at.renamingId}
          onRenamed={at.onRenamed}
          onMenu={(w, e) => {
            e.preventDefault()
            const project = at.projects.find((p) => p.id === w.projectId)
            if (project)
              at.menu({ kind: 'workspace', project, workspace: w, x: e.clientX, y: e.clientY })
          }}
          onOpen={(w) => {
            at.setViewOf(w.id, 'agents')
            at.onOpen(w.projectId, w.id)
          }}
        />
      ),
    },
    /** The sidebar's lists: a workspace an agent made shows in its parent's tab instead. */
    lists: withoutChildren(at.workspaces, catalog),
    rootId: root?.id ?? null,
    signals: rollUp(catalog.workspaces, tree, signals),
  }
}

export function AgentTree(props: AgentTreeProps) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  const rows: { ws: Workspace; depth: number }[] = []
  const seen = new Set<string>()
  const walk = (ws: Workspace, depth: number) => {
    if (seen.has(ws.id)) return
    seen.add(ws.id)
    rows.push({ depth, ws })
    for (const c of props.tree[ws.id] ?? []) walk(c, depth + 1)
  }
  walk(props.root, 0)

  if (rows.length === 1) {
    return (
      <div className="text-faint flex flex-col items-center gap-2 px-6 pt-24 text-center">
        <BotIcon className="size-5" />
        <span>Workspaces this chat&apos;s Claude starts show here, as a tree.</span>
      </div>
    )
  }
  return (
    <ul className="flex flex-col gap-0.5 pt-0.5" aria-label="Agents">
      {rows.map(({ depth, ws }) => (
        <li key={ws.id} className="animate-in fade-in slide-in-from-top-1 duration-180 ease-out">
          <Row {...props} ws={ws} depth={depth} now={now} />
        </li>
      ))}
    </ul>
  )
}

function Row(props: AgentTreeProps & { ws: Workspace; depth: number; now: number }) {
  const { depth, now, ws } = props
  const facts = workspaceFacts(ws, props.chats)
  const word = colourWord(ws.path)
  const title = ws.name === word ? (facts.task ?? ws.name) : ws.name
  const signal = props.signals[ws.id] ?? null
  const diff = props.diffs[ws.path]
  const here = ws.id === props.currentId
  const row = 'flex h-9 w-full min-w-0 items-center gap-2 rounded-md pr-2 text-left'
  const indent = { paddingLeft: 10 + depth * 16 }
  const branch = depth > 0 && (
    <span
      aria-hidden
      className="border-line-strong -mt-3 h-3 w-2 flex-none rounded-bl-[3px] border-b border-l"
    />
  )
  if (ws.id === props.renamingId) {
    return (
      <div className={cn(row, 'bg-active')} style={indent}>
        {branch}
        <span className="size-3.5 flex-none" />
        <RenameField
          className="-ml-0.5 pl-0.5 text-sm"
          label="Workspace name"
          value={ws.name}
          onDone={(name) => props.onRenamed(ws, name)}
        />
      </div>
    )
  }
  return (
    <button
      type="button"
      aria-current={here || undefined}
      className={cn(
        row,
        'hover:bg-hover transition-colors duration-120 ease-out',
        here && 'bg-active hover:bg-active'
      )}
      style={indent}
      onClick={() => props.onOpen(ws)}
      onContextMenu={(e) => props.onMenu(ws, e)}
    >
      {branch}
      <span
        key={signal ?? 'idle'}
        className="animate-in fade-in flex size-3.5 flex-none items-center justify-center duration-160 ease-out"
      >
        {signal !== null && <StatusDot signal={signal} />}
      </span>
      <span className={cn('min-w-0 flex-1 truncate', signal === 'done' && 'font-semibold')}>
        {title}
      </span>
      {diff && diff.add + diff.del > 0 && (
        <span className="flex-none font-mono text-xs tabular-nums">
          <span className="text-good">+{diff.add}</span>{' '}
          <span className="text-critical">−{diff.del}</span>
        </span>
      )}
      <span className="text-faint flex-none text-xs tabular-nums">
        {word} · {ageLabel(facts.activeAt, now)}
      </span>
    </button>
  )
}
