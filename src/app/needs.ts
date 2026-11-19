// What each sidebar row asks of the user, and whether they have seen it: a page stopped on a
// question, a review, a ready PR or a block; a chat waiting on an answer; a turn finished.
// A row asks only while there is something new: once the user opens its workspace, it is
// quiet until the agent writes something that waits on them again. Pure, so the rules are
// tested apart from the screen; what was seen is kept in localStorage.
import type { ChatState } from '../chat/model'
import type { Signal } from '../model/catalog'
import type { Tone } from './status-dot'

import { REPORT_TOOL } from '../chat/reports'
import { isOutdated, type Report, STOP_STATES } from '../model/report'

/** A page's states that wait on the user. */
export type Stop = 'question' | 'review' | 'ready' | 'blocked'

/** The quiet word a row says for its page's stop. */
export const STOP_WORD: Record<Stop, string> = {
  blocked: 'Blocked',
  question: 'Question',
  ready: 'PR ready',
  review: 'To review',
}

/** The mark for each stop: the waiting dot, the done dot for a ready PR, red when blocked. */
const STOP_TONE: Record<Stop, Tone> = {
  blocked: 'failing',
  question: 'waiting',
  ready: 'done',
  review: 'waiting',
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

/**
 * The stop a page still stands on: not a state its chats moved on from long after, not a
 * merged PR's history, not a question the user answered past.
 */
export function pageStop(
  report: Pick<Report, 'at' | 'state'> | null,
  o: { activeAt: number; merged?: boolean; answered?: boolean }
): Stop | null {
  if (report === null || o.merged === true || o.answered === true) return null
  if (!STOP_STATES.includes(report.state) || isOutdated(report, o.activeAt)) return null
  return report.state as Stop
}

export interface NeedFacts {
  /** Parked by the user: never asks. */
  parked: boolean
  /** Its own chats together: working, waiting, done unread, nothing. */
  signal: Signal | null
  /** The request a chat of it waits on (a question or a permission), or null. */
  waiting: string | null
  stop: Stop | null
  /** When its page was written (ms). */
  reportAt: number
  /** When a turn of its chats last ended or started (ms). */
  activeAt: number
}

/**
 * What the row asks right now, as a key that changes with each new ask (a new wait, a new
 * page that stops, a new finished turn), or null when it asks nothing.
 */
export function needKey(f: NeedFacts): string | null {
  if (f.parked) return null
  if (f.waiting !== null) return `wait:${f.waiting}`
  if (f.signal === 'waiting') return `wait:${f.activeAt}`
  if (f.stop !== null) return `page:${f.reportAt}`
  if (f.signal === 'done') return `done:${f.activeAt}`
  return null
}

/** A row's mark: the chat's live signal (working, waiting) first, then its page's stop, then
 * the chat's done. */
export function rowTone(signal: Signal | null, stop: Stop | null): Tone | null {
  if (signal === 'working' || signal === 'waiting') return signal
  if (stop !== null) return STOP_TONE[stop]
  return signal
}

/** What the user has seen of each row: the need key it had when they last opened it. */
export type NeedsSeen = Readonly<Record<string, string>>

/** Whether a row asks something the user has not seen. */
export const isUnread = (key: string | null, seen: NeedsSeen, id: string) =>
  key !== null && seen[id] !== key

/** ⌘0: the next row after `current`, in sidebar order and wrapping, that asks something
 * unseen; null when none does (`current` itself is never the answer). */
export function nextNeed(
  order: readonly string[],
  current: string | null,
  unread: (id: string) => boolean
): string | null {
  const at = current === null ? -1 : order.indexOf(current)
  const after = [...order.slice(at + 1), ...order.slice(0, Math.max(at, 0))]
  return after.find((id) => id !== current && unread(id)) ?? null
}

const KEY = 'logit.needs.seen'

/** What localStorage holds, or nothing seen (storage empty, unreadable or refused). */
export function loadNeedsSeen(storage: Pick<Storage, 'getItem'> | null): NeedsSeen {
  try {
    const raw = storage?.getItem(KEY)
    const parsed: unknown = raw === null || raw === undefined ? {} : JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string')
    )
  } catch {
    return {}
  }
}

export function saveNeedsSeen(seen: NeedsSeen, storage: Pick<Storage, 'setItem'> | null) {
  try {
    storage?.setItem(KEY, JSON.stringify(seen))
  } catch {
    // Full or blocked: it lives in memory until the next launch.
  }
}
