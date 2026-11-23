import {
  ChevronRightIcon,
  EllipsisIcon,
  FolderOpenIcon,
  InboxIcon,
  PanelLeftIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
} from 'lucide-react'
import { type MouseEvent, type ReactNode, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import type { Project, Signal, Workspace } from '../model/catalog'
import type { FileChange } from './use-git'

import { rowTone, type Stop, STOP_WORD } from './needs'
import { useReorder } from './reorder'
import { type TreeRow, treeRows } from './sidebar-tree'
import { Dot, type Tone } from './status-dot'
import { RenameField } from './tab-bar'

export interface DiffStat {
  add: number
  del: number
}

/** A file list's added and deleted lines, together. */
export function diffStat(changes: FileChange[] | null | undefined): DiffStat {
  let add = 0
  let del = 0
  for (const file of changes ?? []) {
    add += file.add ?? 0
    del += file.del ?? 0
  }
  return { add, del }
}

/** What a right-click (or a row's ··· button) asks a menu for. */
export type RowMenu =
  | { kind: 'project'; project: Project; x: number; y: number }
  | { kind: 'workspace'; project: Project; workspace: Workspace; x: number; y: number }

/** What the rows read of a chat: a `ChatRecord`, `activeAt` once it is kept. */
export interface ChatFacts {
  workspaceId: string
  title: string
  createdAt: number
  /** When a turn last started or ended (ms); 0 or absent before it was recorded. */
  activeAt?: number
}

/** Who needs the user: each row's page stop and whether it asks something unseen. */
export interface SidebarNeeds {
  /** How many rows ask something the user has not seen. */
  count: number
  /** Goes up each time ⌘0 found nothing: the row says so once. */
  nothing: number
  /** ⌘0: the next one. */
  onNext: () => void
  stops: Record<string, Stop | null>
  unread: Record<string, boolean>
}

interface Props {
  needs?: SidebarNeeds
  projects: Project[]
  workspaces: Record<string, Workspace[]>
  /** Each sub-workspace's parent (the workspace whose chat started it), by id. */
  parents?: Readonly<Record<string, string>>
  /** What each workspace's tabs call attention to. */
  signals: Record<string, Signal | null>
  diffs: Record<string, DiffStat>
  /** Every chat: a workspace's age and task title come from them. */
  chats?: readonly ChatFacts[]
  projectId: string | null
  workspaceId: string | null
  page: 'settings' | null
  onSelect: (projectId: string, workspaceId: string | null) => void
  onProjects: () => void
  onNewProject: () => void
  onNewWorkspace: (projectId: string) => void
  onMenu: (menu: RowMenu) => void
  /** Projects, or one project's workspaces, dragged into a new order. */
  onReorder: (ids: string[]) => void
  /** The workspace whose name is being edited in place. */
  renamingId: string | null
  onRename: (workspace: Workspace) => void
  /** A new name ('' gives the colour back), or null when renaming was dropped. */
  onRenamed: (workspace: Workspace, name: string | null) => void
  /** How many agents wait for an answer, and how many finished, in every project. */
  onSettings: () => void
  onHide: () => void
  /** Pixels once dragged, or a CSS width that follows the window. */
  width: number | string
  /** Quotas, at the left of the foot. */
  foot: ReactNode
  /** Floats just above the foot: the attention toast. */
  dock?: ReactNode
}

const AVATAR_TONES = ['#525890', '#5b7a5e', '#8a5a44', '#6b5b8a', '#44707f', '#8a6d2f']

/** A project's initial on a tone picked from its name, so it keeps its colour. */
export function ProjectAvatar({
  className,
  name,
  size = 'md',
}: {
  className?: string
  name: string
  /** `md` 18px (the sidebar's projects), `sm` 16px (inline in a row or a meta line). */
  size?: 'sm' | 'md'
}) {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return (
    <span
      className={cn(
        'grid flex-none place-items-center font-bold text-white shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)]',
        size === 'md' ? 'size-[18px] rounded-[5px] text-[10.5px]' : 'size-4 rounded-sm text-[10px]',
        className
      )}
      style={{ background: AVATAR_TONES[hash % AVATAR_TONES.length] }}
      aria-hidden="true"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}

/** How long ago, as the sidebar says it: "now", "4m", "3h", "2d", "5w". */
export function ageLabel(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return days < 7 ? `${days}d` : `${Math.floor(days / 7)}w`
}

/**
 * A workspace's last activity (the latest turn of its chats, else when they or it were
 * created) and its task: the first chat's title that isn't "New chat" (a first prompt names
 * its chat), or null.
 */
export function workspaceFacts(
  ws: Pick<Workspace, 'id' | 'createdAt'>,
  chats: readonly ChatFacts[]
): { activeAt: number; task: string | null } {
  const own = chats
    .filter((c) => c.workspaceId === ws.id)
    .toSorted((a, b) => a.createdAt - b.createdAt)
  let activeAt = ws.createdAt
  for (const c of own) activeAt = Math.max(activeAt, c.activeAt ?? 0, c.createdAt)
  const task = own.find((c) => c.title.trim() !== '' && c.title !== 'New chat')?.title ?? null
  return { activeAt, task }
}

/** The colour a workspace was made with: its folder's name (`…/amber` → amber). The branch
 * may have taken the name Claude gave it. */
export const colourWord = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** Ages move on by the minute. */
export function useNow(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

const NAV =
  'hover:bg-hover text-muted-foreground flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm whitespace-nowrap transition-[background-color,color] duration-120'
/** What the hover tools cover: gone while they show. */
const UNDER_TOOLS =
  'transition-opacity duration-120 group-focus-within/row:opacity-0 group-hover/row:opacity-0'
/** A section label: "Projects", and each project's name. */
const LABEL = 'text-label text-xs font-medium'
/**
 * The hover tools over a row's end: they fade in over a gradient of the row's own fill. Over a
 * chat background the fill is see-through and can't hide anything: no gradient, and what sits
 * under the tools fades out instead (`UNDER_TOOLS`).
 */
const HOVER_TOOLS =
  'pointer-events-none absolute right-1 flex items-center bg-linear-to-r from-transparent to-(--row) to-30% pl-6 opacity-0 [:root[data-wallpaper]_&]:bg-none transition-opacity duration-120 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100 group-hover/row:pointer-events-auto group-hover/row:opacity-100'

/** Folding a group slides its height; the rows inside don't reflow. */
const FOLD =
  'grid transition-[grid-template-rows,opacity] duration-180 ease-in-out motion-reduce:transition-[opacity]'

/** Where a menu opens: at the pointer for a right-click, under the button for a click. */
function at(e: MouseEvent) {
  if (e.type === 'contextmenu') return { x: e.clientX, y: e.clientY }
  const box = e.currentTarget.getBoundingClientRect()
  return { x: box.left, y: box.bottom + 4 }
}

const FOLDED_KEY = 'logit.sidebar.folded'
/** The workspaces whose sub-workspaces are folded (open by default). */
export const KIDS_FOLDED_KEY = 'logit.sidebar.kids-folded'
/** The projects whose Parked group is open (folded by default). */
const PARKED_KEY = 'logit.sidebar.parked-open'

/** The projects folded last time: a per-window convenience, empty when storage is refused. */
function loadFolded(key = FOLDED_KEY): ReadonlySet<string> {
  try {
    const raw = localStorage.getItem(key)
    const ids: unknown = raw === null ? [] : JSON.parse(raw)
    return new Set(Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

function saveFolded(ids: ReadonlySet<string>, key = FOLDED_KEY) {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]))
  } catch {
    // nothing to do: the next launch shows every project open
  }
}

export function Sidebar(props: Props) {
  const { onMenu, projectId, workspaceId } = props
  const now = useNow()
  const projectDrag = useReorder(props.onReorder)
  const workspaceDrag = useReorder(props.onReorder)
  const projects = props.projects
  const projectIds = projects.map((p) => p.id)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(loadFolded)
  const toggle = (id: string) =>
    setCollapsed((state) => {
      const next = new Set(state)
      if (!next.delete(id)) next.add(id)
      saveFolded(next)
      return next
    })
  const [parkedOpen, setParkedOpen] = useState<ReadonlySet<string>>(() => loadFolded(PARKED_KEY))
  const toggleParked = (id: string) =>
    setParkedOpen((state) => {
      const next = new Set(state)
      if (!next.delete(id)) next.add(id)
      saveFolded(next, PARKED_KEY)
      return next
    })
  const [kidsFolded, setKidsFolded] = useState<ReadonlySet<string>>(() =>
    loadFolded(KIDS_FOLDED_KEY)
  )
  const toggleKids = (id: string) =>
    setKidsFolded((state) => {
      const next = new Set(state)
      if (!next.delete(id)) next.add(id)
      saveFolded(next, KIDS_FOLDED_KEY)
      return next
    })
  const parents = props.parents ?? {}
  // The workspace on screen never hides: the parents above it stay open.
  const above = new Set<string>()
  for (let at = parents[workspaceId ?? '']; at !== undefined && !above.has(at); at = parents[at])
    above.add(at)
  const folded = (id: string) => kidsFolded.has(id) && !above.has(id)
  /** Each list's rows with what their tree needs: hidden under a folded parent, how many of
   * those below ask, and the toggle. */
  const tree = (rows: TreeRow[]) => {
    const hides = new Set<string>()
    return rows.map((row, i) => {
      const hidden = row.parent !== null && hides.has(row.parent)
      if (hidden || folded(row.ws.id)) hides.add(row.ws.id)
      const asking = rows
        .slice(i + 1, i + 1 + row.below)
        .filter((r) => r.ws.paused !== true && props.needs?.unread[r.ws.id] === true).length
      return {
        asking,
        folded: folded(row.ws.id),
        hidden,
        onFold: () => toggleKids(row.ws.id),
        row,
      }
    })
  }
  // ⌘1–9 go through every workspace in sidebar order, folded groups included.
  const order = projects.flatMap((p) => (props.workspaces[p.id] ?? []).map((w) => w.id))
  const needs = props.needs

  return (
    <nav
      className="bg-side glass @container flex min-h-0 flex-none flex-col"
      aria-label="Projects"
      style={{ width: props.width }}
    >
      {/* The window's traffic lights sit on the left of this row; the row drags the window. */}
      <div className="flex h-bar flex-none items-center pl-20" data-tauri-drag-region>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Hide the sidebar (⌘S)"
          data-tip="Hide sidebar · ⌘S"
          onClick={props.onHide}
        >
          <PanelLeftIcon className="size-4" />
        </Button>
      </div>
      <div className="border-border flex flex-none flex-col border-b px-1.5 pt-1 pb-2">
        <button
          type="button"
          className={NAV}
          data-tip="New workspace · ⌘N"
          onClick={() => projectId !== null && props.onNewWorkspace(projectId)}
        >
          <PlusIcon className="text-faint size-4 shrink-0" />
          <span className="min-w-0 flex-1 text-left">New workspace</span>
        </button>
        <button type="button" className={NAV} data-tip="Search · ⌘P" onClick={props.onProjects}>
          <SearchIcon className="text-faint size-4 shrink-0" />
          <span className="min-w-0 flex-1 text-left">Search</span>
        </button>
        {needs !== undefined && <NeedsEntry needs={needs} />}
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          className="absolute inset-0 overflow-auto px-1.5 pb-3"
          data-reorder
          onClickCapture={projectDrag.onClickCapture}
        >
          {/* ⌘O and ⌘P's Projects add one; with none yet, this row says how. */}
          {projects.length === 0 && (
            <button type="button" className={cn(NAV, 'mt-2 w-full')} onClick={props.onNewProject}>
              <FolderOpenIcon className="text-faint size-4 shrink-0" />
              Open a folder…
            </button>
          )}
          {projects.map((project, p) => {
            const open = !collapsed.has(project.id)
            const all = props.workspaces[project.id] ?? []
            const list = all.filter((w) => w.paused !== true)
            const parked = all.filter((w) => w.paused === true)
            const rows = tree(treeRows(list, parents))
            const parkedRows = tree(treeRows(parked, parents))
            // A row and its sub-workspaces drag together.
            const groups = rows.filter((r) => r.row.depth === 0)
            const listIds = groups.map((g) => g.row.ws.id)
            const parkedShown = parkedOpen.has(project.id)
            // With no workspace to select, the project itself is where you are (not in Settings).
            const here = project.id === projectId && workspaceId === null && props.page === null
            return (
              <section
                key={project.id}
                aria-label={project.name}
                data-reorder-id={project.id}
                className={cn(
                  'rounded-md transition-[box-shadow,background-color] duration-120',
                  projectDrag.dragging === project.id && 'bg-side shadow-popover'
                )}
              >
                <div
                  className={cn(
                    'group/row relative flex h-7 items-center rounded-md [--row:var(--sidebar)]',
                    p === 0 ? 'mt-2' : 'mt-4',
                    here && 'bg-active [--row:var(--active)]'
                  )}
                  data-reorder-measure
                  onPointerDown={(e) => projectDrag.start(project.id, projectIds, e)}
                  aria-current={here || undefined}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    onMenu({ kind: 'project', project, ...at(e) })
                  }}
                >
                  <button
                    type="button"
                    className={cn(
                      LABEL,
                      'hover:text-faint flex h-full min-w-0 flex-1 items-center gap-1 px-3 transition-[color] duration-120'
                    )}
                    aria-expanded={open}
                    onClick={() => toggle(project.id)}
                  >
                    <span className="min-w-0 flex-[0_1_auto] truncate">{project.name}</span>
                    <ChevronRightIcon
                      className={cn(
                        'size-3.5 opacity-0 transition-[opacity,rotate] duration-[120ms,150ms] ease-[ease,cubic-bezier(0.2,0,0,1)] group-hover/row:opacity-100',
                        open && 'rotate-90'
                      )}
                    />
                  </button>
                  {/* Over the name's end on hover or focus, on a fade: at rest the name has the
                    whole row. */}
                  <span className={cn(HOVER_TOOLS, 'inset-y-0')}>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`More for ${project.name}`}
                      onClick={(e) => onMenu({ kind: 'project', project, ...at(e) })}
                    >
                      <EllipsisIcon className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`New workspace in ${project.name}`}
                      onClick={() => props.onNewWorkspace(project.id)}
                    >
                      <PlusIcon className="size-4" />
                    </Button>
                  </span>
                </div>
                <div
                  className={cn(FOLD, open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr] opacity-0')}
                  inert={!open}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div
                      className="flex flex-col gap-0.5 pt-0.5"
                      data-reorder
                      onClickCapture={workspaceDrag.onClickCapture}
                    >
                      {all.length === 0 && (
                        <button
                          type="button"
                          className="text-label hover:bg-hover hover:text-muted-foreground flex h-8 items-center gap-2 rounded-md pl-3 text-sm transition-[background-color,color] duration-120"
                          onClick={() => props.onNewWorkspace(project.id)}
                        >
                          <PlusIcon className="size-3.5 flex-none" />
                          New workspace
                        </button>
                      )}
                      {groups.map((top) => {
                        const at = rows.indexOf(top)
                        const id = top.row.ws.id
                        return (
                          <div
                            key={id}
                            data-reorder-id={id}
                            className={cn(
                              'flex flex-col rounded-md transition-[box-shadow,background-color] duration-120',
                              workspaceDrag.dragging === id && 'bg-side shadow-popover'
                            )}
                            onPointerDown={(e) => workspaceDrag.start(id, listIds, e)}
                          >
                            {rows.slice(at, at + 1 + top.row.below).map((t) => (
                              <TreeFold key={t.row.ws.id} hidden={t.hidden} first={t === top}>
                                <WorkspaceRow
                                  {...props}
                                  ws={t.row.ws}
                                  tree={t}
                                  project={project}
                                  number={order.indexOf(t.row.ws.id)}
                                  now={now}
                                />
                              </TreeFold>
                            ))}
                          </div>
                        )
                      })}
                    </div>
                    {parked.length > 0 && (
                      <div className="flex flex-col">
                        <ParkedHead
                          count={parked.length}
                          open={parkedShown}
                          onToggle={() => toggleParked(project.id)}
                        />
                        <div
                          className={cn(
                            FOLD,
                            parkedShown ? 'grid-rows-[1fr]' : 'grid-rows-[0fr] opacity-0'
                          )}
                          inert={!parkedShown}
                        >
                          <div className="flex min-h-0 flex-col overflow-hidden">
                            {parkedRows.map((t, i) => (
                              <TreeFold key={t.row.ws.id} hidden={t.hidden} first={i === 0}>
                                <WorkspaceRow
                                  {...props}
                                  ws={t.row.ws}
                                  tree={t}
                                  project={project}
                                  number={order.indexOf(t.row.ws.id)}
                                  now={now}
                                />
                              </TreeFold>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )
          })}
        </div>
      </div>
      <div className="border-border relative flex h-bar flex-none items-center gap-1.5 border-t pr-2 pl-2.5">
        {props.dock}
        {props.foot}
        <span className="min-w-0 flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className={cn(props.page === 'settings' && 'bg-active text-foreground hover:bg-active')}
          aria-label="Settings"
          aria-pressed={props.page === 'settings'}
          data-tip="Settings"
          data-tip-side="top"
          data-tip-align="end"
          onClick={props.onSettings}
        >
          <SettingsIcon className="size-4" />
        </Button>
      </div>
    </nav>
  )
}

const TONE_LABEL: Record<Tone, string> = {
  done: 'Done',
  failing: 'Blocked',
  idle: 'Idle',
  waiting: 'Waiting for you',
  working: 'Working',
}

const TINT = {
  done: '[--tone:var(--good)]',
  failing: '[--tone:var(--critical)]',
  waiting: '[--tone:var(--warn)]',
}

/** How long after a row first draws its signal counts as found rather than new. */
const SETTLE_MS = 1500

/**
 * The aimux TUI's row tint: a workspace that finished or waits for you lights up once in its
 * colour, then keeps a faint wash from the left edge while it stays so. `flash` is read when
 * the tint appears: a row already finished or waiting when the sidebar drew it doesn't flash.
 */
function RowTint({
  flash,
  left = 0,
  signal,
}: {
  signal: 'done' | 'waiting' | 'failing'
  flash: boolean
  /** A sub-workspace's wash starts at its own indent, past its parent's guides. */
  left?: number
}) {
  const [play] = useState(flash)
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 -z-10 rounded-md opacity-30',
        'bg-[linear-gradient(90deg,color-mix(in_srgb,var(--tone)_40%,transparent),transparent_60%)]',
        TINT[signal],
        play && 'animate-[tint_0.7s_cubic-bezier(0.2,0,0,1)]'
      )}
      style={left > 0 ? { left } : undefined}
    />
  )
}

/** What a page's stop reads in, while it asks something unseen. */
const STOP_INK: Record<Stop, string> = {
  blocked: 'text-critical-ink',
  question: 'text-warn-ink',
  ready: 'text-good-ink',
  review: 'text-warn-ink',
}

/**
 * A workspace: what its agent is doing (the working loader, the waiting dot, the done dot
 * while unread, nothing while idle), its task (the first chat's title; a name the user chose
 * outranks it, and with neither, the colour word), bold while a finished turn is unread; at
 * the right its page's stop in one word, its colour word and age. While it asks something the
 * user has not seen, a tint washes it. Parked, it is muted and asks nothing. On hover, its
 * menu button and, in a tooltip, its diff, branch and ⌘ number.
 */
function WorkspaceRow(
  props: Props & {
    ws: Workspace
    tree: RowTree
    project: Project
    number: number
    now: number
  }
) {
  const { now, number, project, tree, ws } = props
  const { depth } = tree.row
  const kids = tree.row.below
  // Settings on screen: no row is where you are.
  const active =
    project.id === props.projectId && ws.id === props.workspaceId && props.page === null
  const paused = ws.paused === true
  // Working and waiting show on the row you are on too; what it finished, you are reading.
  const reported = props.signals[ws.id] ?? null
  const signal = active && reported === 'done' ? null : reported
  const asks = !paused && props.needs?.unread[ws.id] === true
  const unread = !paused && signal === 'done'
  // The mark says why it needs you: the chat's live signal, else its page's stop. Parked, only
  // the working loader shows.
  const stop = paused ? null : (props.needs?.stops[ws.id] ?? null)
  const parkedTone = signal === 'working' ? 'working' : null
  const tone = paused ? parkedTone : rowTone(signal, stop)
  // The signals settle while the chats load and replay: what a row shows then, it shows
  // without a flash. A tint that comes after has news to tell.
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), SETTLE_MS)
    return () => clearTimeout(timer)
  }, [])
  const diff = props.diffs[ws.path]
  const facts = workspaceFacts(ws, props.chats ?? [])
  const renaming = ws.id === props.renamingId
  const word = colourWord(ws.path)
  const title = ws.name === word ? (facts.task ?? ws.name) : ws.name

  const menu = (e: MouseEvent) => {
    e.preventDefault()
    props.onMenu({ kind: 'workspace', project, workspace: ws, ...at(e) })
  }
  const status = ageLabel(facts.activeAt, now)
  // Keyed by the signal, so a change cross-fades in place.
  const icon = (
    <span
      key={tone ?? 'idle'}
      className="animate-in fade-in flex size-3.5 flex-none items-center justify-center duration-160 ease-out"
    >
      {tone !== null && <Dot tone={tone} label={TONE_LABEL[tone]} />}
    </span>
  )
  const tip = [
    paused ? 'Parked' : null,
    diff && diff.add + diff.del > 0 ? `+${diff.add} −${diff.del}` : null,
    ws.branch,
  ].filter((part) => part !== null)
  const row = 'flex h-9 w-full items-center gap-2 pr-2'
  const indent = { paddingLeft: PAD + depth * STEP }

  return (
    <div
      className={cn(
        'group/row text-muted-foreground relative isolate rounded-md text-sm transition-[background-color] duration-120 [--row:var(--sidebar)]',
        active ? 'bg-active [--row:var(--active)]' : 'hover:bg-hover hover:[--row:var(--hover)]'
      )}
      onContextMenu={menu}
    >
      <Guides tree={tree} />
      {asks && (tone === 'done' || tone === 'waiting' || tone === 'failing') && (
        <RowTint key={tone} signal={tone} flash={settled} left={depth * STEP} />
      )}
      {renaming ? (
        // In place of the row's button: a field inside a button would click it.
        <div className={row} style={indent}>
          {icon}
          <RenameField
            className="-ml-0.5 pl-0.5 text-sm"
            label="Workspace name"
            value={ws.name}
            onDone={(name) => props.onRenamed(ws, name)}
          />
        </div>
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className={cn(
                  row,
                  'transition-opacity duration-160 ease-out',
                  paused && 'opacity-50'
                )}
                style={indent}
                aria-current={active}
                data-workspace={ws.id}
                onClick={() => props.onSelect(project.id, ws.id)}
                onDoubleClick={() => props.onRename(ws)}
              />
            }
          >
            {icon}
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-left',
                active && 'text-foreground font-medium',
                !active && (unread || asks) && 'text-foreground font-semibold'
              )}
            >
              {title}
            </span>
            <span
              className={cn(
                UNDER_TOOLS,
                'text-faint flex flex-none items-center gap-1 text-xs tabular-nums'
              )}
            >
              {kids > 0 && <KidsCount tree={tree} />}
              {/* Below 240px of sidebar the task keeps the room; the tooltip has the branch. */}
              {stop !== null && (
                <span
                  key={stop}
                  className={cn(
                    'animate-in fade-in flex items-center gap-1 transition-[color] duration-160',
                    asks ? cn(STOP_INK[stop], 'font-medium') : 'text-muted-foreground'
                  )}
                >
                  <span>{STOP_WORD[stop]}</span>
                  <span aria-hidden="true" className="text-faint font-normal">
                    ·
                  </span>
                </span>
              )}
              {title !== word && (
                <span className="flex items-center gap-1 @max-[240px]:hidden">
                  <span>{word}</span>
                  <span aria-hidden="true">·</span>
                </span>
              )}
              {status}
            </span>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            <span className="font-mono">{tip.join(' · ')}</span>
            {number >= 0 && number < 9 && <Kbd className="text-white/60">⌘{number + 1}</Kbd>}
          </TooltipContent>
        </Tooltip>
      )}
      {!renaming && (
        <span className={cn(HOVER_TOOLS, 'top-0 h-9')}>
          {kids > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-faint h-7 gap-0.5 px-1.5 text-xs font-normal tabular-nums"
              aria-expanded={!tree.folded}
              aria-label={`${tree.folded ? 'Show' : 'Hide'} the ${kids} ${kids === 1 ? 'workspace' : 'workspaces'} ${ws.name} started`}
              onClick={tree.onFold}
            >
              {kids}
              <ChevronRightIcon
                className={cn(
                  'size-3.5 transition-[rotate] duration-150 ease-[cubic-bezier(0.2,0,0,1)]',
                  !tree.folded && 'rotate-90'
                )}
              />
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" aria-label={`More for ${ws.name}`} onClick={menu}>
            <EllipsisIcon className="size-4" />
          </Button>
        </span>
      )}
    </div>
  )
}

/** A row in its tree: hidden under a folded parent, how many of those below it ask. */
interface RowTree {
  row: TreeRow
  hidden: boolean
  folded: boolean
  /** How many rows below it ask something unseen. */
  asking: number
  onFold: () => void
}

// The tree's geometry: each level steps 18px; a guide runs down the centre of its parent's
// mark column (10px of padding, then the 14px mark).
const PAD = 10
const STEP = 18
const rail = (level: number) => PAD + 7 + level * STEP

/** A sub-workspace's hairlines: the guides of the levels above that run on past it, an elbow
 * from its parent into its own mark, and a stem down to its children while they show. */
function Guides({ tree }: { tree: RowTree }) {
  const { depth, last, rails } = tree.row
  const line = 'bg-line-strong pointer-events-none absolute w-px'
  return (
    <span aria-hidden>
      {rails.map((on, level) =>
        on ? (
          <span
            key={level}
            className={cn(line, '-top-0.5 bottom-0')}
            style={{ left: rail(level) }}
          />
        ) : null
      )}
      {depth > 0 && (
        <>
          <span
            className="border-line-strong pointer-events-none absolute -top-0.5 h-5 rounded-bl-md border-b border-l"
            style={{ left: rail(depth - 1), width: STEP - 6 }}
          />
          {!last && (
            <span className={cn(line, 'top-4.5 bottom-0')} style={{ left: rail(depth - 1) }} />
          )}
        </>
      )}
      {tree.row.below > 0 && !tree.folded && (
        <span className={cn(line, 'top-6 bottom-0')} style={{ left: rail(depth) }} />
      )}
    </span>
  )
}

/** A parent's quiet count of what sits under it; folded, what asks below shows as a dot. */
function KidsCount({ tree }: { tree: RowTree }) {
  const n = tree.row.below
  const asks = tree.folded && tree.asking > 0
  return (
    <span
      className={cn(
        'flex items-center gap-1 transition-[color] duration-160',
        asks && 'text-warn-ink font-medium'
      )}
      title={asks ? `${tree.asking} below need you` : undefined}
    >
      {asks && <Dot tone="waiting" label={`${tree.asking} below need you`} />}
      <span className="flex items-center">
        {asks ? tree.asking : n}
        <ChevronRightIcon
          className={cn(
            'size-3 transition-[rotate] duration-150 ease-[cubic-bezier(0.2,0,0,1)]',
            !tree.folded && 'rotate-90'
          )}
        />
      </span>
      <span aria-hidden="true" className="text-faint font-normal">
        ·
      </span>
    </span>
  )
}

/** A row in its group, folding away under a folded parent: its height slides, nothing
 * reflows. Every row but a group's first keeps the 2px between rows inside its fold. */
function TreeFold({
  children,
  first,
  hidden,
}: {
  children: ReactNode
  first: boolean
  hidden: boolean
}) {
  return (
    <div
      className={cn(FOLD, hidden ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr]')}
      inert={hidden}
    >
      <div className={cn('min-h-0 overflow-hidden', !first && 'pt-0.5')}>{children}</div>
    </div>
  )
}

/** "Needs you" under Search: how many rows ask something unseen, and ⌘0's way to the next.
 * Pressed with none, it says so for a moment in place of its label. */
function NeedsEntry({ needs }: { needs: SidebarNeeds }) {
  const [quiet, setQuiet] = useState(false)
  const [seenNothing, setSeenNothing] = useState(needs.nothing)
  if (needs.nothing !== seenNothing) {
    setSeenNothing(needs.nothing)
    setQuiet(true)
  }
  useEffect(() => {
    if (!quiet) return
    const timer = setTimeout(() => setQuiet(false), 1600)
    return () => clearTimeout(timer)
  }, [quiet, seenNothing])
  const { count } = needs
  return (
    <button
      type="button"
      className={NAV}
      data-tip="Next that needs you · ⌘0"
      aria-keyshortcuts="Meta+0"
      onClick={needs.onNext}
    >
      <InboxIcon className="text-faint size-4 shrink-0" />
      {/* The two labels share one cell: the swap cross-fades with no shift. */}
      <span className="grid min-w-0 flex-1 text-left">
        <span
          className={cn(
            'col-start-1 row-start-1 truncate transition-opacity duration-120 ease-out',
            quiet && 'opacity-0'
          )}
        >
          Needs you
        </span>
        <span
          aria-live="polite"
          className={cn(
            'text-faint col-start-1 row-start-1 truncate transition-opacity duration-120 ease-out',
            !quiet && 'opacity-0'
          )}
        >
          {quiet ? 'Nothing needs you' : ''}
        </span>
      </span>
      {count > 0 ? (
        <span
          key={count}
          className="bg-foreground animate-in fade-in text-2xs grid h-[18px] min-w-[18px] place-items-center rounded-full px-[5px] text-white tabular-nums duration-160"
          aria-label={`${count} need you`}
        >
          {count}
        </span>
      ) : (
        <Kbd>⌘0</Kbd>
      )}
    </button>
  )
}

/** A project's Parked group head: its label and count, folded by default. */
function ParkedHead({
  count,
  onToggle,
  open,
}: {
  count: number
  open: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={cn(
        LABEL,
        'group/parked hover:text-faint mt-0.5 flex h-7 items-center gap-1 rounded-md pl-8 transition-[color] duration-120'
      )}
      aria-expanded={open}
      onClick={onToggle}
    >
      <span>Parked</span>
      <span className="font-normal tabular-nums">{count}</span>
      <ChevronRightIcon
        className={cn(
          'size-3.5 transition-[rotate] duration-150 ease-[cubic-bezier(0.2,0,0,1)]',
          open && 'rotate-90'
        )}
      />
    </button>
  )
}
