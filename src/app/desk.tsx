// Desk (⌘0): one queue of what every agent needs from the user, across every project. A mode
// of the sidebar: its list turns into every workspace in three groups (needs you, working,
// quiet), and the content area shows the selected one's report with, pinned under it, what
// answers it. This file holds the queue's state (`useDesk`) and that content (`Desk`).
import { invoke } from '@tauri-apps/api/core'
import { CheckIcon } from 'lucide-react'
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import type { Catalog, Project, Signal, Workspace } from '../model/catalog'
import type { CardHandle } from './question-card'
import type { ChatTab } from './use-chats'
import type { Reports } from './use-reports'

import { type ChatState, liveStep, questionsOf, toolSummary } from '../chat/model'
import { reportAsk } from '../chat/reports'
import { openChoice, type Report } from '../model/report'
import { signalsOf } from './agent-tree'
import { Answer, type DockKeys, type Hub, replyChat, waitingChat, waitOf } from './desk-dock'
import {
  type DeskGhost,
  deskGroups,
  type DeskInput,
  deskOrder,
  type DeskRow,
  movedOn,
  nextNeed,
} from './desk-model'
import { Calm, NoReport, StageHead } from './desk-stage'
import { ReportPane } from './report-view'
import { listable, type Session } from './resume'
import { colourWord, type DeskSide, useNow, workspaceFacts } from './sidebar'
import { errorText } from './toast'

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** The last line of the last thing Claude said in a chat, without its markdown. */
function lastSaid(state: ChatState): string {
  for (const turn of state.turns.toReversed()) {
    if (turn.role !== 'assistant') continue
    const text = turn.blocks.findLast((b) => b.kind === 'text')
    if (text?.kind === 'text' && text.text.trim() !== '')
      // Its last line: where a turn ends is what it says to the user.
      return (text.text.trim().split('\n').at(-1) ?? '')
        .replace(/^[#>*\-\s]+/, '')
        .replaceAll(/\*\*|`/g, '')
  }
  return ''
}

/** What a row that needs the user says under its title: the question, the tool, the block. */
function sayOf(chats: readonly ChatTab[], wsId: string, report: Report | null): string {
  const chat = waitingChat(chats, wsId)
  const wait = waitOf(chat)
  if (wait !== undefined && chat !== undefined) {
    const asked = questionsOf(wait)?.[0]?.question
    if (asked !== undefined) return asked
    return `${wait.toolName} ${toolSummary(wait.toolName, wait.input, chat.cwd)}`.trim()
  }
  const open = report?.state === 'question' ? openChoice(report.choices)?.text : undefined
  if (open !== undefined && open !== '') return open
  if (report !== null && report.summary !== '') return report.summary
  const latest = chats
    .filter((c) => c.record.workspaceId === wsId)
    .toSorted((a, b) => (b.record.activeAt ?? 0) - (a.record.activeAt ?? 0))[0]
  return latest === undefined ? '' : lastSaid(latest.state)
}

/** Every workspace of every project, as Desk sorts them. */
export function deskInputs(o: {
  catalog: Catalog
  projects: readonly Project[]
  /** Each project's workspaces in sidebar order. */
  workspaces: Record<string, readonly Workspace[]>
  chats: { chats: readonly ChatTab[] }
  reports: Pick<Reports, 'reportOf'>
  signals: Record<string, Signal | null>
  /** Whether a worktree's PR is merged, as far as the app knows. */
  merged?: (path: string) => boolean
}): (DeskInput & { path: string })[] {
  const order = o.projects.flatMap((p) => (o.workspaces[p.id] ?? []).map((w) => w.id))
  // Ages and task titles: the open chats' live records over the saved ones.
  const live = new Map(o.chats.chats.map((c) => [c.record.id, c.record]))
  const records = [...o.catalog.chats.filter((r) => !live.has(r.id)), ...live.values()]
  return o.catalog.workspaces.flatMap((ws) => {
    const project = o.projects.find((p) => p.id === ws.projectId)
    if (project === undefined) return []
    const own = o.chats.chats.filter((c) => c.record.workspaceId === ws.id)
    const waits = own.flatMap((c) => c.state.pending)
    let pending: DeskInput['pending'] = null
    if (waits.some((p) => p.toolName === 'AskUserQuestion')) pending = 'question'
    else if (waits.length > 0) pending = 'permission'
    const report = o.reports.reportOf(ws.id)
    const writer = own.find((c) => c.record.id === report?.chatId)
    const working = own.find((c) => c.state.status === 'working')
    const step = working === undefined ? null : liveStep(working.state, working.cwd)
    const facts = workspaceFacts(ws, records)
    // A chat opened or resumed is not activity: only turns move a report out of date.
    const turnAt = Math.max(
      ws.createdAt,
      ...records.filter((r) => r.workspaceId === ws.id).map((r) => r.activeAt ?? 0)
    )
    const word = colourWord(ws.path)
    const at = order.indexOf(ws.id)
    return [
      {
        activeAt: turnAt,
        answered: writer !== undefined && movedOn(writer.state),
        colour: word,
        doing: step === null ? undefined : `${step.verb} ${step.target}`.trim(),
        id: ws.id,
        merged: o.merged?.(ws.path) === true,
        order: at === -1 ? order.length : at,
        path: ws.path,
        pending,
        project: project.name,
        projectId: project.id,
        report,
        say: sayOf(own, ws.id, report),
        signal: o.signals[ws.id] ?? null,
        title: ws.name === word ? (facts.task ?? ws.name) : ws.name,
      },
    ]
  })
}

/** The answer dock, where the keyboard goes to answer: leaving it hands the keys back to the list. */
const DOCK_ATTR = 'data-desk-dock'
const leaveDock = () => {
  const el = document.activeElement
  if (el instanceof HTMLElement && el.closest(`[${DOCK_ATTR}]`) !== null) el.blur()
}

/**
 * Desk's queue and its state, alive whatever the mode so the sidebar can draw it: the groups,
 * the selection, Quiet folded or not, the rows folding out of "Needs you", and the answer
 * being sent.
 */
export function useDesk(
  o: Omit<Parameters<typeof deskInputs>[0], 'merged' | 'reports' | 'signals'> & {
    reports: Reports
    mode: string
    git: { mergedOf: (path: string) => boolean }
  }
) {
  const on = o.mode === 'desk'
  const signals = signalsOf(o.catalog.workspaces, o.chats.chats)
  const inputs = deskInputs({ ...o, merged: o.git.mergedOf, signals })
  const groups = deskGroups(inputs)
  const rows = deskOrder(groups)
  const needIds = groups.needs.map((r) => r.id)
  const loading = o.reports.list.reports === null && o.reports.list.error === null

  // Quiet folds by default once it is long; the user's toggle wins after.
  const [quietOpen, setQuietOpen] = useState<boolean | null>(null)
  const quietShown = quietOpen ?? groups.quiet.length <= 3

  // Each time Desk opens, on the first that needs you, once the reports are in.
  const [sel, setSel] = useState<string | null>(null)
  const [started, setStarted] = useState(false)
  const [wasOn, setWasOn] = useState(on)
  if (on !== wasOn) {
    setWasOn(on)
    setStarted(false)
  }
  if (on && !started && !loading) {
    setStarted(true)
    setSel(groups.needs[0]?.id ?? null)
  }
  const row = rows.find((r) => r.id === sel) ?? null
  if (sel !== null && row === null && started) setSel(null)

  // After an answer went, once its row has left "Needs you": the next one that needs you.
  const leaving = useRef<{ id: string; before: string[] } | null>(null)
  const away = leaving.current
  if (away !== null && !needIds.includes(away.id)) {
    leaving.current = null
    if (sel === away.id) setSel(nextNeed(away.before, needIds, away.id))
  }

  // A send goes at once, through the chat's own command, and confirms on its card (a check, a
  // beat); then the next need is selected. One that fails keeps its row, its error in the dock.
  const [sent, setSent] = useState<string | null>(null)
  const [failed, setFailed] = useState<{ id: string; error: string } | null>(null)
  const deliver = (r: DeskRow) => (run: () => Promise<void>) => {
    if (sent !== null) return
    const before = needIds
    setFailed(null)
    setSent(r.id)
    const beat = new Promise((resolve) => setTimeout(resolve, reduced() ? 0 : 420))
    Promise.all([run(), beat])
      .then(() => {
        if (before.includes(r.id)) leaving.current = { before, id: r.id }
        setSent(null)
        requestAnimationFrame(leaveDock)
      })
      .catch((error: unknown) => {
        setSent(null)
        setFailed({ error: errorText(error), id: r.id })
      })
  }

  // Rows that leave "Needs you" while Desk shows fold away where they were.
  const [ghosts, setGhosts] = useState<readonly DeskGhost[]>([])
  const lastNeeds = useRef(groups.needs)
  const needsKey = needIds.join('\n')
  useLayoutEffect(() => {
    const before = lastNeeds.current
    lastNeeds.current = groups.needs
    if (!on || reduced()) return
    const gone = before.flatMap((r, at) => (needIds.includes(r.id) ? [] : [{ at, row: r }]))
    if (gone.length > 0) setGhosts((g) => [...g, ...gone])
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- runs when the needs change
  }, [needsKey])
  if (!on && ghosts.length > 0) setGhosts([])

  return {
    deliver,
    dropGhost: (g: DeskGhost) => setGhosts((all) => all.filter((x) => x !== g)),
    failed,
    ghosts,
    groups,
    loading,
    on,
    quietShown,
    row,
    rows,
    sel,
    select: setSel,
    sent,
    toggleQuiet: () => setQuietOpen(!quietShown),
  }
}

export type DeskState = ReturnType<typeof useDesk>

/** What the sidebar draws of Desk: its list, and the Code / Desk switch (`onMode`). */
export function deskSide(
  desk: DeskState,
  catalog: Catalog,
  reports: Reports,
  setMode: (mode: 'desk') => void,
  /** Back to Code, on the workspace selected there. */
  leave: () => void
): DeskSide {
  return {
    error: reports.list.error,
    ghosts: desk.ghosts,
    groups: desk.groups,
    loading: desk.loading,
    on: desk.on,
    onGhostDone: desk.dropGhost,
    onMode: (on) => (on ? setMode('desk') : desk.on && leave()),
    onPick: desk.select,
    onQuiet: desk.toggleQuiet,
    onRetry: reports.list.retry,
    quietOpen: desk.quietShown,
    selected: desk.on ? desk.sel : null,
    workspace: (id) => catalog.workspaces.find((w) => w.id === id),
  }
}

/** The chat Desk sends you to for a row: the one waiting, else where a reply would go. */
export function deskChat(chats: readonly ChatTab[], r: DeskRow): string | null {
  const waiting = waitingChat(chats, r.id)
  if (waiting !== undefined) return waiting.record.id
  return replyChat(chats, r)?.record.id ?? null
}

/** The workspace's newest Claude session, resumed in a new chat. */
async function reopenChat(row: DeskRow, hub: Hub): Promise<boolean> {
  const sessions = await invoke<Session[]>('claude_sessions', { projectId: row.projectId })
  const path = row.path ?? ''
  const latest = sessions
    .filter((s) => listable(s) && (s.cwd === path || s.cwd.startsWith(`${path}/`)))
    .toSorted((a, b) => b.updatedAt - a.updatedAt)[0]
  if (latest === undefined) return false
  hub.openSession(row.id, latest.cwd, latest.id, latest.title || latest.firstPrompt)
  return true
}

interface Props {
  desk: DeskState
  /** The app's chats: Desk answers and writes to them itself. */
  hub: Hub
  reports: Reports
  /** Back to Code, on the row's workspace and that chat when one is given (no row: as it was). */
  onOpen: (row: DeskRow | null, chatId: string | null) => void
  onNew: () => void
}

/** Desk's content: the selected workspace's report, the answer pinned under it, and its keys. */
export function Desk({ desk, hub, onNew, onOpen, reports }: Props) {
  const { chats } = hub
  const { deliver, failed, groups, loading, row, sent } = desk
  const now = useNow()
  const dock = useRef<HTMLDivElement>(null)
  const card = useRef<CardHandle | null>(null)
  const dockKeys = useRef<DockKeys>({})

  // Its report: read when selected (the list has it without images), and read once shown.
  const entry = row === null ? undefined : reports.entryOf(row.id)
  const { load, see } = reports
  const selId = row?.id
  useEffect(() => {
    if (selId !== undefined) load(selId)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- once per selection
  }, [selId])
  const shownAt = entry?.report?.at
  useEffect(() => {
    if (selId !== undefined && shownAt !== undefined) see(selId, shownAt)
  }, [selId, shownAt, see])

  const [reopening, setReopening] = useState<string | null>(null)
  const reopen = (r: DeskRow) => {
    if (reopening !== null) return
    setReopening(r.id)
    reopenChat(r, hub)
      .then((ok) => {
        if (!ok) onOpen(r, null)
      })
      .catch(() => onOpen(r, null))
      .finally(() => setReopening(null))
  }

  /** ↑↓ through the rows the sidebar shows (Quiet's only while it is open). */
  const move = (by: 1 | -1) => {
    const shown = desk.rows.filter((r) => desk.quietShown || r.group !== 'quiet')
    if (shown.length === 0) return
    const at = shown.findIndex((r) => r.id === desk.sel)
    let next = at === -1 ? 0 : Math.min(Math.max(at + by, 0), shown.length - 1)
    if (at === -1 && by === -1) next = shown.length - 1
    desk.select(shown[next]?.id ?? null)
  }
  const focusAnswer = () => {
    const target = dock.current?.querySelector<HTMLElement>(
      '[role="alertdialog"], [data-answer]:not(:disabled), button:not(:disabled)'
    )
    target?.focus()
  }
  const inCard = (el: Element | null) => el?.closest('[role="alertdialog"][data-request]') != null

  const keys = useRef({ desk, focusAnswer, move, onOpen })
  keys.current = { desk, focusAnswer, move, onOpen }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const k = keys.current
      const r = k.desk.row
      const el = e.target instanceof HTMLElement ? e.target : null
      // A dialog over Desk (a zoomed screen, ⌘P, the composer) keeps its keys.
      if (el?.closest('[role="dialog"]') != null) return
      const inDock = el !== null && dock.current?.contains(el) === true
      const typing = el?.matches('input, textarea, [contenteditable="true"]') === true
      // The sidebar's Desk rows are the list: keys there are the list's.
      const onRow = el?.closest('[data-desk-row]') != null
      const done = () => {
        e.preventDefault()
        e.stopPropagation()
      }
      // ⌘0 goes back to Code, as Esc does from the list (app.tsx).
      if (e.metaKey && e.code === 'Digit0') {
        k.onOpen(r, r && deskChat(hub.chats, r))
        done()
        return
      }
      if (e.key === 'Escape' && inDock) {
        // Out of the answer, back to the list; Esc again goes back to Code.
        leaveDock()
        done()
        return
      }
      if (e.metaKey && e.key === 'Enter' && r !== null) {
        if (!inDock) {
          k.onOpen(r, deskChat(hub.chats, r))
          done()
          return
        }
        // The question card and a written reply send themselves.
        if (inCard(el) || el?.dataset.draft === 'full') return
        const primary = dockKeys.current.primary
        if (primary === undefined) return
        primary.run()
        done()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey || typing) return
      if (inDock) {
        if (e.key !== 'ArrowLeft' || inCard(el)) return
        leaveDock()
      } else if (e.key === 'ArrowDown') k.move(1)
      else if (e.key === 'ArrowUp') k.move(-1)
      else if (/^[1-9]$/.test(e.key) && r?.pending === 'question' && card.current !== null) {
        // A digit from the list picks in the card, and hands it the keyboard.
        card.current.digit(Number(e.key))
        k.focusAnswer()
      } else if (
        (e.key === 'Enter' || e.key === 'ArrowRight') &&
        (onRow || el?.closest('button, a') == null)
      )
        k.focusAnswer()
      else return
      done()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- reads the latest through `keys`
  }, [])

  const open = (r: DeskRow) => onOpen(r, deskChat(chats, r))
  const report = entry?.report ?? null
  const waiting = row === null ? undefined : waitingChat(chats, row.id)
  const writer = chats.find((c) => c.record.id === report?.chatId)
  const ask = reportAsk(writer?.state)
  const showReport =
    row !== null && (report !== null || entry?.error != null || row.report !== null)

  let detail: ReactNode = <Calm groups={groups} onNew={onNew} />
  if (loading) {
    detail = (
      <div
        className="mx-auto flex w-full max-w-[784px] flex-col gap-3 px-8 pt-7"
        aria-label="Reading the reports"
      >
        <span className="bg-active h-3 w-24 animate-pulse rounded-sm" />
        <span className="bg-active h-5 w-2/3 animate-pulse rounded-sm" />
        <span className="bg-hover mt-3 h-3.5 w-full animate-pulse rounded-sm" />
        <span className="bg-hover h-3.5 w-1/2 animate-pulse rounded-sm" />
      </div>
    )
  } else if (row !== null) {
    const chatId = deskChat(chats, row)
    const openChat = chatId === null ? null : () => onOpen(row, chatId)
    const head = (
      <StageHead row={row} report={report ?? row.report} now={now} onOpenChat={openChat} />
    )
    detail = (
      <div
        key={row.id}
        className="animate-in fade-in flex min-h-0 flex-1 flex-col duration-160 ease-out"
      >
        {showReport ? (
          <ReportPane
            entry={entry?.loading === true && report === null ? undefined : entry}
            className="px-8 pt-6 pb-8 [&>*]:mx-auto [&>*]:max-w-[720px]"
            ask={ask}
            chatActiveAt={row.activeAt}
            merged={row.merged}
            showAsk={ask.kind === 'answered'}
            head={head}
            onOpenChat={openChat}
            onRetry={() => reports.retryOf(row.id)}
          />
        ) : (
          <NoReport row={row} now={now} onOpen={() => open(row)} />
        )}
        <div className="relative flex max-h-[58%] flex-none flex-col px-5 pb-4">
          {/* The report runs under the card's top edge, fading out: no seam. */}
          <div
            aria-hidden
            className="from-background pointer-events-none absolute inset-x-0 -top-8 h-8 bg-linear-to-t to-transparent"
          />
          <div
            ref={dock}
            {...{ [DOCK_ATTR]: '' }}
            className="relative -mx-3 -mb-3 min-h-0 overflow-y-auto px-3 pt-1 pb-3"
          >
            <div
              key={`${row.id}:${waiting?.record.id ?? ''}`}
              className="block-in relative mx-auto max-w-[744px]"
              style={{ '--i': 3 } as CSSProperties}
            >
              {failed?.id === row.id && (
                <p
                  role="alert"
                  className="bg-critical-wash text-critical-ink mb-2 rounded-md px-2.5 py-1.5 text-xs break-words select-text"
                >
                  Couldn’t send it ({failed.error}). Open its chat to answer there.
                </p>
              )}
              <Answer
                row={row}
                report={report ?? row.report}
                chats={chats}
                hub={hub}
                card={card}
                keys={dockKeys}
                deliver={deliver(row)}
                reopening={reopening === row.id}
                onReopen={() => reopen(row)}
                onOpen={(id) => onOpen(row, id)}
              />
              {sent === row.id && (
                <div className="bg-background/90 animate-in fade-in absolute inset-0 z-10 grid place-items-center rounded-lg duration-120">
                  <span className="text-good-ink flex items-center gap-1.5 text-sm font-medium">
                    <span className="animate-in zoom-in-75 duration-160 ease-out">
                      <CheckIcon className="size-4" strokeWidth={2.4} />
                    </span>
                    Sent
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <section
      className="glass bg-background relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      aria-label="Desk"
      data-zoom-host
    >
      {detail}
    </section>
  )
}
