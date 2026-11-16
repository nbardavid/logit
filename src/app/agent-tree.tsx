// The right panel's Agents view: the workspaces an orchestrating chat started (with
// logit's MCP `workspace_create`), as a tree under the workspace that made them.
import { NetworkIcon } from 'lucide-react'
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
import { COLORS } from '../model/names'
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

interface Line {
  ws: Workspace
  depth: number
  /** The last of its siblings: its branch stops at its own row. */
  last: boolean
  /** For each level above it, whether a branch still runs past this row. */
  rails: boolean[]
  hasKids: boolean
}

/** The tree walked in order, with what each row needs to draw its branches. */
export function linesOf(root: Workspace, tree: Record<string, Workspace[]>): Line[] {
  const out: Line[] = []
  const seen = new Set<string>()
  const walk = (ws: Workspace, depth: number, last: boolean, rails: boolean[]) => {
    if (seen.has(ws.id)) return
    seen.add(ws.id)
    const kids = (tree[ws.id] ?? []).filter((k) => !seen.has(k.id))
    out.push({ depth, hasKids: kids.length > 0, last, rails, ws })
    const below = depth === 0 ? rails : [...rails, !last]
    for (const [i, k] of kids.entries()) walk(k, depth + 1, i === kids.length - 1, below)
  }
  walk(root, 0, true, [])
  return out
}

// Geometry: each level steps 18px; a branch runs through the centre of its row's dot column.
const STEP = 18
const PAD = 8
const DOT = 16
const rail = (level: number) => PAD + level * STEP + DOT / 2

const PLURAL: Record<Signal, string> = { done: 'done', waiting: 'waiting', working: 'working' }

export function AgentTree(props: AgentTreeProps) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  const lines = linesOf(props.root, props.tree)

  if (lines.length === 1) {
    return (
      <div className="animate-in fade-in flex flex-col items-center gap-3 px-8 pt-24 text-center duration-200">
        <span className="bg-muted text-faint grid size-9 place-items-center rounded-lg">
          <NetworkIcon className="size-4" />
        </span>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">No agents yet</span>
          <span className="text-faint text-xs">
            Ask Claude to split the work: each piece gets its own workspace, shown here as a tree.
          </span>
        </div>
      </div>
    )
  }

  const kids = lines.slice(1)
  const counts = { done: 0, waiting: 0, working: 0 }
  let add = 0
  let del = 0
  for (const l of kids) {
    const s = props.signals[l.ws.id]
    if (s) counts[s]++
    const d = props.diffs[l.ws.path]
    if (d) {
      add += d.add
      del += d.del
    }
  }
  const order: Signal[] = ['waiting', 'working', 'done']
  return (
    <div className="flex flex-col">
      <div className="text-muted-foreground flex h-8 items-center gap-3 px-3.5 text-xs">
        <span className="text-foreground font-medium tabular-nums">
          {kids.length} {kids.length === 1 ? 'agent' : 'agents'}
        </span>
        {order
          .filter((s) => counts[s] > 0)
          .map((s) => (
            <span
              key={s}
              className="animate-in fade-in inline-flex items-center gap-1.5 tabular-nums duration-160"
            >
              <StatusDot signal={s} />
              {counts[s]} {PLURAL[s]}
            </span>
          ))}
        {add + del > 0 && (
          <span className="ml-auto font-mono tabular-nums">
            <span className="text-good">+{add}</span> <span className="text-critical">−{del}</span>
          </span>
        )}
      </div>
      <ul className="flex flex-col px-1.5 pb-2" aria-label="Agents">
        {lines.map((line, i) => (
          <li
            key={line.ws.id}
            className="animate-in fade-in slide-in-from-top-[4px] relative fill-mode-backwards duration-200 ease-out"
            style={{ animationDelay: `${Math.min(i, 8) * 24}ms` }}
          >
            <Branches line={line} />
            <Row {...props} line={line} now={now} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The tree's lines: rails for the levels above, an elbow into this row, a stem to its kids. */
function Branches({ line }: { line: Line }) {
  const { depth } = line
  const cls = 'bg-line-strong pointer-events-none absolute w-px'
  return (
    <span aria-hidden>
      {line.rails.map((on, level) =>
        on ? (
          <span key={level} className={cn(cls, 'inset-y-0')} style={{ left: rail(level) }} />
        ) : null
      )}
      {depth > 0 && (
        <>
          <span
            className="border-line-strong pointer-events-none absolute top-0 h-6 rounded-bl-md border-b border-l"
            style={{ left: rail(depth - 1), width: STEP - 4 }}
          />
          {!line.last && (
            <span className={cn(cls, 'top-6 bottom-0')} style={{ left: rail(depth - 1) }} />
          )}
        </>
      )}
      {line.hasKids && <span className={cn(cls, 'top-8 bottom-0')} style={{ left: rail(depth) }} />}
    </span>
  )
}

function Row(props: AgentTreeProps & { line: Line; now: number }) {
  const { line, now } = props
  const { depth, ws } = line
  const facts = workspaceFacts(ws, props.chats)
  const word = colourWord(ws.path)
  const title = ws.name === word ? (facts.task ?? ws.name) : ws.name
  const signal = props.signals[ws.id] ?? null
  const diff = props.diffs[ws.path]
  const here = ws.id === props.currentId
  const root = depth === 0
  const box = 'relative flex h-12 w-full min-w-0 items-center gap-2.5 rounded-md pr-2.5 text-left'
  const indent = { paddingLeft: PAD + depth * STEP }
  const dot = (
    <span
      key={signal ?? 'idle'}
      className="animate-in fade-in grid size-4 flex-none place-items-center duration-160 ease-out"
    >
      {signal === null ? (
        <span
          className={cn('size-[7px] rounded-full', root ? 'bg-foreground' : 'bg-line-strong')}
        />
      ) : (
        <StatusDot signal={signal} />
      )}
    </span>
  )
  const meta = (
    <span className="text-faint flex min-w-0 items-center gap-1.5 text-xs">
      <span
        aria-hidden
        className="size-1.5 flex-none rounded-full"
        style={{ background: COLORS[word] ?? 'var(--color-neutral)' }}
      />
      <span className="truncate">{word}</span>
      <span aria-hidden>·</span>
      <span className="flex-none tabular-nums">
        {ws.paused === true ? 'Paused' : ageLabel(facts.activeAt, now)}
      </span>
    </span>
  )
  if (ws.id === props.renamingId) {
    return (
      <div className={cn(box, 'bg-active')} style={indent}>
        {dot}
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
      title={title}
      className={cn(
        box,
        'group hover:bg-hover transition-colors duration-120 ease-out',
        'focus-visible:ring-ring outline-none focus-visible:ring-2',
        here && 'bg-active hover:bg-active'
      )}
      style={indent}
      onClick={() => props.onOpen(ws)}
      onContextMenu={(e) => props.onMenu(ws, e)}
    >
      {dot}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            'truncate text-sm',
            root || signal === 'done' || here ? 'font-medium' : '',
            ws.paused === true && 'text-muted-foreground'
          )}
        >
          {title}
        </span>
        {meta}
      </span>
      {diff && diff.add + diff.del > 0 && (
        <span className="flex-none self-start pt-2 font-mono text-xs tabular-nums">
          <span className="text-good">+{diff.add}</span>{' '}
          <span className="text-critical">−{diff.del}</span>
        </span>
      )}
    </button>
  )
}
