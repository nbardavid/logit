import {
  ChevronRightIcon,
  CircleAlertIcon,
  CodeIcon,
  EllipsisIcon,
  FolderOpenIcon,
  InboxIcon,
  type LucideIcon,
  PanelLeftIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
} from 'lucide-react'
import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import type { Project, Signal, Workspace } from '../model/catalog'
import type { FileChange } from './use-git'

import { type DeskGhost, type DeskGroup, type DeskRow, rowTone } from './desk-model'
import { useReorder } from './reorder'
import { Dot, type Tone } from './status-dot'
import { RenameField } from './tab-bar'
import { useServerPort } from './use-servers'

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

/**
 * Desk (⌘0), the sidebar's other mode: the same rows, grouped by what they need from the user
 * instead of by project (desk.tsx keeps the state).
 */
export interface DeskSide {
  on: boolean
  /** Code (false) or Desk (true). */
  onMode: (desk: boolean) => void
  groups: Record<DeskGroup, DeskRow[]>
  /** Rows that just left "Needs you", folding out. */
  ghosts: readonly DeskGhost[]
  onGhostDone: (ghost: DeskGhost) => void
  selected: string | null
  onPick: (id: string) => void
  quietOpen: boolean
  onQuiet: () => void
  loading: boolean
  /** The reports failed to load. */
  error: string | null
  onRetry: () => void
  /** Any workspace, agents' included: a row is drawn from it. */
  workspace: (id: string) => Workspace | undefined
}

interface Props {
  desk?: DeskSide
  projects: Project[]
  workspaces: Record<string, Workspace[]>
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
/** The mode on screen (Code or Desk): the selected row's fill. */
const NAV_ON = 'bg-active hover:bg-active text-foreground font-medium'
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

/** The two lists under the entries (by project, and Desk's), one over the other. */
const LIST =
  'absolute inset-0 overflow-auto px-1.5 pb-3 transition-[opacity,translate,visibility] duration-160 ease-out motion-reduce:transition-[opacity,visibility]'
/** A list put away: faded out, a few pixels toward the side its entry sits on. */
const LIST_OFF_LEFT = 'invisible -translate-x-1 opacity-0'
const LIST_OFF_RIGHT = 'invisible translate-x-1 opacity-0'

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Where a menu opens: at the pointer for a right-click, under the button for a click. */
function at(e: MouseEvent) {
  if (e.type === 'contextmenu') return { x: e.clientX, y: e.clientY }
  const box = e.currentTarget.getBoundingClientRect()
  return { x: box.left, y: box.bottom + 4 }
}

const FOLDED_KEY = 'logit.sidebar.folded'

/** The projects folded last time: a per-window convenience, empty when storage is refused. */
function loadFolded(): ReadonlySet<string> {
  try {
    const raw = localStorage.getItem(FOLDED_KEY)
    const ids: unknown = raw === null ? [] : JSON.parse(raw)
    return new Set(Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

function saveFolded(ids: ReadonlySet<string>) {
  try {
    localStorage.setItem(FOLDED_KEY, JSON.stringify([...ids]))
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
  // ⌘1–9 go through every workspace in sidebar order, folded groups included.
  const order = projects.flatMap((p) => (props.workspaces[p.id] ?? []).map((w) => w.id))
  const desk = props.desk
  const needs = desk?.groups.needs.length ?? 0

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
        {desk !== undefined && (
          <div role="tablist" aria-label="Sidebar" className="contents">
            <ModeTab
              on={!desk.on}
              tip="Code · ⌘0"
              icon={CodeIcon}
              label="Code"
              onClick={() => desk.onMode(false)}
            />
            <ModeTab
              on={desk.on}
              tip="Desk · ⌘0"
              icon={InboxIcon}
              label="Desk"
              onClick={() => desk.onMode(true)}
            >
              {needs > 0 && (
                <span
                  key={needs}
                  className="bg-warn animate-in fade-in grid h-[18px] min-w-[18px] place-items-center rounded-full px-[5px] text-[11px] leading-[14px] font-medium text-white tabular-nums duration-160"
                  aria-label={`${needs} need you`}
                >
                  {needs}
                </span>
              )}
            </ModeTab>
          </div>
        )}
      </div>
      {/* The two lists, one over the other: switching cross-fades them in place, and each
          keeps its scroll and its rows' state while the other shows. */}
      <div className="relative min-h-0 flex-1">
        {desk !== undefined && <DeskList {...props} desk={desk} now={now} />}
        <div
          className={cn(LIST, desk?.on === true && LIST_OFF_LEFT)}
          inert={desk?.on === true}
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
            const list = props.workspaces[project.id] ?? []
            const listIds = list.map((w) => w.id)
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
                {/* Folding slides the group's height; the rows inside don't reflow. */}
                <div
                  className={cn(
                    'grid transition-[grid-template-rows,opacity] duration-180 ease-in-out motion-reduce:transition-[opacity]',
                    open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr] opacity-0'
                  )}
                  inert={!open}
                >
                  <div
                    className="flex min-h-0 flex-col gap-0.5 overflow-hidden pt-0.5"
                    data-reorder
                    onClickCapture={workspaceDrag.onClickCapture}
                  >
                    {list.length === 0 && (
                      <button
                        type="button"
                        className="text-label hover:bg-hover hover:text-muted-foreground flex h-8 items-center gap-2 rounded-md pl-3 text-sm transition-[background-color,color] duration-120"
                        onClick={() => props.onNewWorkspace(project.id)}
                      >
                        <PlusIcon className="size-3.5 flex-none" />
                        New workspace
                      </button>
                    )}
                    {list.map((ws) => (
                      <div
                        key={ws.id}
                        data-reorder-id={ws.id}
                        className={cn(
                          'rounded-md transition-[box-shadow,background-color] duration-120',
                          workspaceDrag.dragging === ws.id && 'bg-side shadow-popover'
                        )}
                        onPointerDown={(e) => workspaceDrag.start(ws.id, listIds, e)}
                      >
                        <WorkspaceRow
                          {...props}
                          ws={ws}
                          project={project}
                          number={order.indexOf(ws.id)}
                          now={now}
                        />
                      </div>
                    ))}
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
function RowTint({ flash, signal }: { signal: 'done' | 'waiting' | 'failing'; flash: boolean }) {
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
    />
  )
}

/**
 * A workspace: what its agent is doing (the working loader, the waiting dot, the done dot
 * while unread, nothing while idle) over its tint, its task (the first chat's title; a name the user chose
 * outranks it, and with neither, the colour word), bold while a finished turn is unread; at
 * the right its colour word and age. On hover, its menu button and, in a tooltip, its diff,
 * branch and ⌘ number.
 */
function WorkspaceRow(
  props: Props & {
    ws: Workspace
    project: Project
    number: number
    now: number
    /** On Desk: selected there, picked there, and its project's name when there are several. */
    pick?: { selected: boolean; onPick: () => void; where: string | null }
  }
) {
  const { now, number, pick, project, ws } = props
  // Settings on screen: no row is where you are.
  const active =
    pick?.selected ??
    (project.id === props.projectId && ws.id === props.workspaceId && props.page === null)
  // Working and waiting show on the row you are on too; what it finished, you are reading.
  const reported = props.signals[ws.id] ?? null
  const signal = active && reported === 'done' ? null : reported
  const unread = signal === 'done'
  // The mark says why it needs you: the chat's live signal, else its report (sidebar and Desk
  // agree, desk-model.ts).
  const deskRow = props.desk?.groups.needs.find((r) => r.id === ws.id)
  const tone = rowTone(signal, deskRow)
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
  // Its dev servers' first port while they run: which slot it holds.
  const port = useServerPort(ws.id)
  const title = ws.name === word ? (facts.task ?? ws.name) : ws.name

  const menu = (e: MouseEvent) => {
    e.preventDefault()
    props.onMenu({ kind: 'workspace', project, workspace: ws, ...at(e) })
  }
  const paused = ws.paused === true
  // Put aside: muted, and says so where its age was.
  const status = paused ? 'Paused' : ageLabel(facts.activeAt, now)
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
    pick?.where ?? null,
    diff && diff.add + diff.del > 0 ? `+${diff.add} −${diff.del}` : null,
    ws.branch,
  ].filter((part) => part !== null)
  const row = 'flex h-9 w-full items-center gap-2 pr-2 pl-2.5'

  return (
    <div
      className={cn(
        'group/row text-muted-foreground relative isolate rounded-md text-sm transition-[background-color] duration-120 [--row:var(--sidebar)]',
        active ? 'bg-active [--row:var(--active)]' : 'hover:bg-hover hover:[--row:var(--hover)]'
      )}
      onContextMenu={menu}
    >
      {(tone === 'done' || tone === 'waiting' || tone === 'failing') && (
        <RowTint key={tone} signal={tone} flash={settled} />
      )}
      {renaming ? (
        // In place of the row's button: a field inside a button would click it.
        <div className={row}>
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
                aria-current={active}
                data-workspace={ws.id}
                onClick={() => (pick ? pick.onPick() : props.onSelect(project.id, ws.id))}
                onDoubleClick={() => props.onRename(ws)}
              />
            }
          >
            {icon}
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-left',
                active && 'text-foreground font-medium',
                !active && unread && 'text-foreground font-semibold'
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
              {/* Below 240px of sidebar the task keeps the room; the tooltip has the branch. */}
              {/* Its project, on Desk across several: the name in a wide sidebar, else its
                  initial; the tooltip has it whole. */}
              {pick?.where != null && (
                <span className="text-label flex min-w-0 items-center gap-1">
                  <span className="max-w-24 truncate @max-[340px]:hidden">{pick.where}</span>
                  <span aria-hidden="true" className="text-faint @max-[340px]:hidden">
                    ·
                  </span>
                  <span
                    aria-hidden="true"
                    className="text-2xs ring-foreground/12 mr-0.5 grid size-4 place-items-center rounded-sm ring-1 ring-inset @min-[340px]:hidden"
                  >
                    {pick.where.slice(0, 1).toUpperCase()}
                  </span>
                </span>
              )}
              {title !== word && (
                <span className="flex items-center gap-1 @max-[240px]:hidden">
                  <span>{word}</span>
                  <span aria-hidden="true">·</span>
                </span>
              )}
              {port !== null && (
                <span className="text-foreground/70 font-mono">
                  :{port}
                  <span className="text-faint" aria-hidden="true">
                    {' '}
                    ·
                  </span>
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
          <Button variant="ghost" size="icon-sm" aria-label={`More for ${ws.name}`} onClick={menu}>
            <EllipsisIcon className="size-4" />
          </Button>
        </span>
      )}
    </div>
  )
}

/** Code or Desk, at the top of the sidebar: the mode on screen takes the selected fill. */
function ModeTab({
  children,
  icon: Icon,
  label,
  on,
  onClick,
  tip,
}: {
  on: boolean
  icon: LucideIcon
  label: string
  tip: string
  onClick: () => void
  children?: ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      className={cn(NAV, on && NAV_ON)}
      data-tip={tip}
      onClick={onClick}
    >
      <Icon
        className={cn(
          'size-4 shrink-0 transition-[color] duration-120',
          on ? 'text-foreground' : 'text-faint'
        )}
      />
      <span className="min-w-0 flex-1 text-left">{label}</span>
      {children}
    </button>
  )
}

/** A Desk group's head, drawn as a project's: its label and count; Quiet folds. */
function DeskHead({
  count,
  first,
  label,
  onToggle,
  open,
}: {
  label: string
  count: number
  first: boolean
  onToggle?: () => void
  open?: boolean
}) {
  const inner = (
    <>
      <span className="min-w-0 flex-[0_1_auto] truncate">{label}</span>
      <span className="ml-0.5 font-normal tabular-nums">{count}</span>
    </>
  )
  return (
    <div
      className={cn('group/row relative flex h-7 items-center rounded-md', first ? 'mt-2' : 'mt-4')}
    >
      {onToggle === undefined ? (
        <h3 className={cn(LABEL, 'flex h-full min-w-0 flex-1 items-center gap-1 px-3')}>{inner}</h3>
      ) : (
        <button
          type="button"
          className={cn(
            LABEL,
            'hover:text-faint flex h-full min-w-0 flex-1 items-center gap-1 px-3 transition-[color] duration-120'
          )}
          aria-expanded={open}
          onClick={onToggle}
        >
          {inner}
          <ChevronRightIcon
            className={cn(
              'size-3.5 transition-[opacity,rotate] duration-[120ms,150ms] ease-[ease,cubic-bezier(0.2,0,0,1)] group-hover/row:opacity-100',
              // Folded, it shows at rest: the group has rows to open.
              open === true ? 'rotate-90 opacity-0' : 'opacity-100'
            )}
          />
        </button>
      )}
    </div>
  )
}

/** A row put in the list after it was drawn: it rises in (a row there from the start doesn't). */
function Arrive({ children, id, ready }: { id: string; ready: boolean; children: ReactNode }) {
  const [rise] = useState(ready)
  return (
    <div
      data-desk-row={id}
      className={cn(
        rise &&
          'animate-in fade-in slide-in-from-bottom-1.5 duration-240 ease-[var(--ease-settle)] motion-reduce:slide-in-from-bottom-0'
      )}
    >
      {children}
    </div>
  )
}

/** A row that just stopped needing the user: itself, folding away where it was. */
function Leaving({ children, onDone }: { children: ReactNode; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const done = useRef(onDone)
  done.current = onDone
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    if (reduced()) {
      done.current()
      return
    }
    const h = `${el.offsetHeight}px`
    const anim = el.animate(
      [
        { height: h, opacity: 1, transform: 'translateX(0)' },
        { height: h, offset: 0.35, opacity: 0.5, transform: 'translateX(10px)' },
        { height: '0px', opacity: 0, transform: 'translateX(16px)' },
      ],
      { duration: 300, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'forwards' }
    )
    anim.onfinish = () => done.current()
    return () => anim.cancel()
  }, [])
  return (
    <div ref={ref} aria-hidden className="pointer-events-none overflow-hidden" inert>
      {children}
    </div>
  )
}

/**
 * Desk's list: the sidebar's own rows, grouped by what they need from the user (desk-model.ts's
 * order) instead of by project. Selecting one shows its report in the content area.
 */
function DeskList(props: Props & { desk: DeskSide; now: number }) {
  const { desk, now } = props
  const list = useRef<HTMLDivElement>(null)
  // Rows drawn after the first moment rise in; the ones there from the start don't.
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 400)
    return () => clearTimeout(timer)
  }, [])
  // The selected row stays in view as it moves.
  useEffect(() => {
    if (!desk.on || desk.selected === null) return
    list.current
      ?.querySelector(`[data-desk-row="${CSS.escape(desk.selected)}"]`)
      ?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'nearest' })
  }, [desk.on, desk.selected])

  const { needs, quiet, working } = desk.groups
  const order = props.projects.flatMap((p) => (props.workspaces[p.id] ?? []).map((w) => w.id))
  const many = new Set([...needs, ...working, ...quiet].map((r) => r.projectId)).size > 1
  const rowOf = (r: DeskRow, picked: boolean) => {
    const ws = desk.workspace(r.id)
    const project = props.projects.find((p) => p.id === r.projectId)
    if (ws === undefined || project === undefined) return null
    return (
      <WorkspaceRow
        {...props}
        ws={ws}
        project={project}
        number={order.indexOf(ws.id)}
        now={now}
        pick={{
          onPick: () => desk.onPick(r.id),
          selected: picked && desk.selected === r.id,
          where: many ? project.name : null,
        }}
      />
    )
  }
  const live = (r: DeskRow) => (
    <Arrive key={r.id} id={r.id} ready={ready}>
      {rowOf(r, true)}
    </Arrive>
  )
  // Rows that just left stay a moment where they were, folding.
  let needsRows: ReactNode[] = needs.map(live)
  for (const g of desk.ghosts.toSorted((a, b) => a.at - b.at)) {
    const ghost = (
      <Leaving key={`leaving-${g.row.id}`} onDone={() => desk.onGhostDone(g)}>
        {rowOf(g.row, false)}
      </Leaving>
    )
    needsRows = needsRows.toSpliced(Math.min(g.at, needsRows.length), 0, ghost)
  }
  const rows = (children: ReactNode) => (
    <div className="flex flex-col gap-0.5 pt-0.5">{children}</div>
  )

  return (
    <div
      ref={list}
      className={cn(LIST, !desk.on && LIST_OFF_RIGHT)}
      inert={!desk.on}
      aria-label="Desk"
    >
      {desk.error !== null && (
        <div
          className="bg-critical-wash text-critical-ink mt-2 flex items-center gap-2 rounded-md py-1.5 pr-1.5 pl-2.5 text-xs"
          title={desk.error}
        >
          <CircleAlertIcon className="size-3.5 flex-none" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 font-medium">Couldn&rsquo;t load the reports</span>
          <Button variant="ghost" size="xs" onClick={desk.onRetry}>
            Retry
          </Button>
        </div>
      )}
      {desk.loading ? (
        <div aria-label="Reading the reports">
          <div className={cn(LABEL, 'mt-2 flex h-7 items-center px-3')}>Reading the reports…</div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex h-9 items-center gap-2 pr-2 pl-8">
              <span
                className="bg-active h-3 animate-pulse rounded-sm"
                style={{ opacity: 1 - i * 0.25, width: `${70 - i * 12}%` }}
              />
            </div>
          ))}
        </div>
      ) : (
        <>
          {needs.length + desk.ghosts.length > 0 && (
            <>
              <DeskHead first label="Needs you" count={needs.length} />
              {rows(needsRows)}
            </>
          )}
          {working.length > 0 && (
            <>
              <DeskHead first={needs.length === 0} label="Working" count={working.length} />
              {rows(working.map(live))}
            </>
          )}
          {quiet.length > 0 && (
            <>
              <DeskHead
                first={needs.length + working.length === 0}
                label="Quiet"
                count={quiet.length}
                open={desk.quietOpen}
                onToggle={desk.onQuiet}
              />
              {/* Folding slides the group's height, as a project's does. */}
              <div
                className={cn(
                  'grid transition-[grid-template-rows,opacity] duration-180 ease-in-out motion-reduce:transition-[opacity]',
                  desk.quietOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr] opacity-0'
                )}
                inert={!desk.quietOpen}
              >
                <div className="min-h-0 overflow-hidden">{rows(quiet.map(live))}</div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
