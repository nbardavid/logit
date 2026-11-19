// Desk's queue: every workspace of every project, sorted into what needs the user, what is
// at work, and what is quiet. Pure, so the rules are tested apart from the screen.
import type { ChatState } from '../chat/model'
import type { Signal } from '../model/catalog'
import type { Tone } from './status-dot'

import { REPORT_TOOL } from '../chat/reports'
import { isOutdated, type Report } from '../model/report'

export type DeskGroup = 'needs' | 'working' | 'quiet'

/** Why a row sits where it does: the word its detail shows. */
export type DeskKind =
  | 'question'
  | 'permission'
  | 'blocked'
  | 'working'
  | 'review'
  | 'ready'
  | 'finished'
  | 'done'
  | 'idle'

export interface DeskInput {
  id: string
  projectId: string
  project: string
  /** The workspace's task, as the sidebar shows it (the row takes the report's when current). */
  title: string
  /** The colour word it was made with. */
  colour: string
  report: Report | null
  /** Its chats together: waiting, working, done (unread) or nothing. */
  signal: Signal | null
  /** What a chat waits on right now: AskUserQuestion, another tool's permission, or nothing. */
  pending: 'question' | 'permission' | null
  /** The report's question was answered in its chat already. */
  answered: boolean
  /** The latest turn of its chats (ms). */
  activeAt: number
  /** Its place in the sidebar, across projects. */
  order: number
  /** Its PR is merged: the report is history. */
  merged?: boolean
  /** What a waiting row says under its title: the question, the tool and what it runs. */
  say?: string
  /** What a working chat does right now ("Reading src/app.tsx"). */
  doing?: string
  /** The worktree's folder. */
  path?: string
}

export interface DeskRow extends DeskInput {
  group: DeskGroup
  kind: DeskKind
  /** Since when it is in its state (ms): how long it has waited, or how long ago it went quiet. */
  since: number
}

/** The page still describes the workspace: it does not stop on a state its chats moved on from
 * long after, its PR is not merged, and the user has not answered past it. */
export const isCurrent = (i: DeskInput) =>
  i.report !== null && !isOutdated(i.report, i.activeAt) && i.merged !== true && !i.answered

export function placeOf(i: DeskInput): Pick<DeskRow, 'group' | 'kind' | 'since'> {
  const reportAt = i.report?.at ?? i.activeAt
  if (i.pending !== null) return { group: 'needs', kind: i.pending, since: reportAt }
  if (i.signal === 'working') return { group: 'working', kind: 'working', since: i.activeAt }
  const current = isCurrent(i)
  // A page at work says nothing the chat's own signal does not: the row goes where it puts it.
  const working = i.report?.state === 'working'
  const state = current && !working ? (i.report?.state ?? null) : null
  if (state !== null && state !== 'done') return { group: 'needs', kind: state, since: reportAt }
  // A turn ended with a result not read yet, and no stop written in it: "Finished".
  if (i.signal === 'done' && (state === null || (i.report?.at ?? 0) < i.activeAt))
    return { group: 'needs', kind: 'finished', since: i.activeAt }
  return {
    group: 'quiet',
    kind: state ?? 'idle',
    since: Math.max(i.activeAt, i.report?.at ?? 0),
  }
}

/** A row's title: the report's while it is current, else the workspace's task; never the bare
 * colour word when a report has a title to give. */
export function rowTitle(i: DeskInput): string {
  const report = i.report
  if (report !== null && (isCurrent(i) || i.title === i.colour)) return report.title
  return i.title
}

/** What needs the user, in the order to answer it: questions first, a finished turn last. */
const NEED_RANK: Partial<Record<DeskKind, number>> = {
  blocked: 2,
  finished: 5,
  permission: 4,
  question: 0,
  ready: 3,
  review: 1,
}

/** The mark for each state, the same in the sidebar and on Desk: the loader, waiting and done
 * dots, red when blocked. */
export const KIND_TONE: Record<DeskKind, Tone | null> = {
  blocked: 'failing',
  done: 'done',
  finished: 'done',
  idle: null,
  permission: 'waiting',
  question: 'waiting',
  ready: 'done',
  review: 'waiting',
  working: 'working',
}

/** A sidebar row's mark: the chat's live signal (working, waiting) first, then a current
 * report that needs the user, then the chat's done. A row's "finished" is its chat's done, so
 * it follows the signal (hidden on the row you are reading). */
export function rowTone(signal: Signal | null, row: DeskRow | undefined): Tone | null {
  if (signal === 'working' || signal === 'waiting') return signal
  if (row !== undefined && row.group === 'needs' && row.kind !== 'finished')
    return KIND_TONE[row.kind]
  return signal
}

/** Each group in its order: needs by kind then longest waiting, working as the sidebar has
 * them, quiet newest first. */
export function deskGroups(inputs: readonly DeskInput[]): Record<DeskGroup, DeskRow[]> {
  const rows = inputs.map((i): DeskRow => ({ ...i, ...placeOf(i), title: rowTitle(i) }))
  const of = (g: DeskGroup) => rows.filter((r) => r.group === g)
  return {
    needs: of('needs').toSorted(
      (a, b) => (NEED_RANK[a.kind] ?? 9) - (NEED_RANK[b.kind] ?? 9) || a.since - b.since
    ),
    quiet: of('quiet').toSorted((a, b) => b.since - a.since || a.order - b.order),
    working: of('working').toSorted((a, b) => a.order - b.order),
  }
}

/** The rows in list order. */
export const deskOrder = (groups: Record<DeskGroup, DeskRow[]>) => [
  ...groups.needs,
  ...groups.working,
  ...groups.quiet,
]

/**
 * Where selection goes once `left` stops needing the user: the next one that needs them
 * (in the order before it left), else the one before it, else null (nothing needs them).
 * `before` is the needs list as it was; `now` as it is.
 */
export function nextNeed(
  before: readonly string[],
  now: readonly string[],
  left: string
): string | null {
  const at = before.indexOf(left)
  const after = before.slice(at + 1).find((id) => now.includes(id))
  if (after !== undefined) return after
  const earlier = before.slice(0, Math.max(at, 0)).findLast((id) => now.includes(id) && id !== left)
  return earlier ?? now.find((id) => id !== left) ?? null
}

/**
 * The chat went on past its last report: the user answered a question asked after it (or
 * skipped it), or wrote to it. Its report's question then no longer waits on them, even
 * before Claude says how it took the answer.
 */
export function movedOn(state: Pick<ChatState, 'turns' | 'pending' | 'queued'>): boolean {
  if (state.queued.length > 0) return true
  const steps = state.turns.flatMap((t) =>
    t.role === 'user'
      ? [{ asked: false, report: false, user: true }]
      : t.blocks.map((b) => ({
          asked:
            b.kind === 'tool' &&
            b.name === 'AskUserQuestion' &&
            !state.pending.some((p) => p.toolUseId === b.id),
          report: b.kind === 'tool' && b.name === REPORT_TOOL && b.result?.isError === false,
          user: false,
        }))
  )
  const last = steps.findLastIndex((s) => s.report)
  if (last === -1) return false
  return steps.slice(last + 1).some((s) => s.user || s.asked)
}

/** A row that just left "Needs you", drawn a moment where it was (`at`) while it folds out. */
export interface DeskGhost {
  row: DeskRow
  at: number
}
