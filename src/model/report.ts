// A task's page (logit's MCP `report` tool): one per workspace, kept from the start of the
// work to its end and filled in by its agent as it goes, so someone with a minute knows where
// it stands. Its head says the state; six sections in a fixed order say the rest. A page
// written before sections loads already mapped onto them (`report.rs`).
import type { ReportBlock } from '../report/blocks/types'

export type ReportState = 'working' | 'question' | 'review' | 'ready' | 'done' | 'blocked'

/** The states where the agent stopped for the user. */
export const STOP_STATES: readonly ReportState[] = ['question', 'review', 'ready', 'blocked']

export type ProgressStatus = 'done' | 'current' | 'todo' | 'failed' | 'skipped'

export interface ReportProgress {
  text: string
  status: ProgressStatus
}

/** The page's sections, in reading order. */
export const SECTIONS = ['ticket', 'understood', 'plan', 'progress', 'result', 'left'] as const

export type SectionName = (typeof SECTIONS)[number]

/** Each section, absent while not written (or cleared). Images are `data:` URLs. */
export interface ReportSections {
  /** What was asked, as written. */
  ticket?: ReportBlock[]
  /** What the work is for, the problem, what was assumed. */
  understood?: ReportBlock[]
  /** The solution, the product choices, today beside the mockup. */
  plan?: ReportBlock[]
  /** The agent's own steps for this task. */
  progress?: ReportProgress[]
  /** The real screens, what was run, the PR. */
  result?: ReportBlock[]
  /** What the user still has to do. */
  left?: string[]
}

export interface Report {
  workspaceId: string
  chatId: string
  /** The last call (ms). */
  at: number
  state: ReportState
  ticket?: string
  title: string
  /** The one sentence lists read: where it stands, the question, why blocked. */
  summary: string
  /** A word or two for the current step: "Working · code". */
  step?: string
  /** A page written the old way: the question its open choice asked. */
  question?: string
  sections: ReportSections
  /** When each section was last set (ms). */
  updated?: Partial<Record<SectionName, number>>
}

/** The state's word and its status tone, as the sidebar's dots say it. */
export const REPORT_STATE = {
  blocked: { tone: 'failing', word: 'Blocked' },
  done: { tone: 'done', word: 'Done' },
  question: { tone: 'waiting', word: 'Question' },
  ready: { tone: 'done', word: 'PR ready' },
  review: { tone: 'waiting', word: 'Screens to review' },
  working: { tone: 'working', word: 'Working' },
} as const satisfies Record<
  ReportState,
  { tone: 'failing' | 'waiting' | 'done' | 'working'; word: string }
>

/** Most characters per text, as the host checks them (`report.rs`). */
export const REPORT_LIMITS = {
  choice: 120,
  context: 300,
  step: 24,
  summary: 200,
  title: 60,
} as const

/** A text cut to `max` characters (not UTF-16 units), with an ellipsis when cut. */
export function clampText(text: string, max: number): string {
  // oxlint-disable-next-line typescript/no-misused-spread -- code points, as the host counts
  const chars = [...text]
  return chars.length <= max
    ? text
    : `${chars
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`
}

/** Only web links open (the host checks it too). */
export function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

export interface ReportLink {
  label: string
  url: string
}

/** Every link the page's text blocks give, the ticket's section first. */
export const linksOf = (report: Pick<Report, 'sections'>): ReportLink[] =>
  (['ticket', 'understood', 'plan', 'result'] as const).flatMap((name) =>
    (report.sections[name] ?? []).flatMap((b) => (b.kind === 'text' ? (b.links ?? []) : []))
  )

/** The link that is the ticket: its label names it, or its address ends on its number. */
export function ticketLink(
  ticket: string | undefined,
  links: readonly ReportLink[]
): ReportLink | undefined {
  const id = ticket?.trim().toLowerCase() ?? ''
  if (id === '') return undefined
  const bare = id.replace(/^#/, '')
  const named = (label: string) => {
    const at = label.toLowerCase().indexOf(id)
    // A whole id: "#48" is not "#480".
    return at >= 0 && !/[\p{L}\p{N}]/u.test(label.charAt(at + id.length))
  }
  const addressed = (url: string) => {
    try {
      const parts = new URL(url).pathname.toLowerCase().split('/')
      return parts.includes(bare)
    } catch {
      return false
    }
  }
  return links.find((l) => isWebUrl(l.url) && (named(l.label) || addressed(l.url)))
}

/**
 * What is left once the PR is merged: an item that only asks to merge is done. Anything
 * more ("merge, then run the migration") stays.
 */
const MERGE_ONLY =
  /^(merge|merger|merges|fusionner)( (the|this|la|le|cette))? ?(pr|pull request|branch|branche)?( #?\d+)?[.!]?$/i
export const leftAfterMerge = (left: readonly string[]) =>
  left.filter((item) => !MERGE_ONLY.test(item.trim()))

/** The chat moved on this long after its report: the report may no longer tell it all. */
const STALE_MS = 5 * 60_000

/** The workspace's chats were active well after the report was written. */
export const isStale = (at: number, chatActiveAt: number | undefined) =>
  chatActiveAt !== undefined && chatActiveAt - at > STALE_MS

/**
 * The page's state no longer says where the work stands: the agent stopped for the user
 * (question, review, ready, blocked) and its chat clearly went on since. Working and done
 * never are; the page itself stays as it is, only its state line changes.
 */
export const isOutdated = (
  report: Pick<Report, 'at' | 'state'>,
  chatActiveAt: number | undefined
) => STOP_STATES.includes(report.state) && isStale(report.at, chatActiveAt)

/** "just now", "4m ago", "3h ago", "2d ago", "5w ago". */
export function reportAge(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days < 7 ? `${days}d ago` : `${Math.floor(days / 7)}w ago`
}
