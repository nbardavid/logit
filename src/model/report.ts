// An agent's report (logit's MCP `report` tool): what it did, told for someone who has a
// minute. Product choices first: agents are usually right on the code, less often on what
// the person will see.

export type ReportState = 'question' | 'review' | 'ready' | 'done' | 'blocked'

export interface ReportChoice {
  /** What the agent chose (or, when `open`, the question it asks). */
  text: string
  /** The option it left out, if one was weighed. */
  setAside?: string
  /** The question asked in the chat: shown as its own card, never among the choices made. */
  open: boolean
}

export interface ReportScreen {
  step: string
  /** `data:` image URLs. */
  before?: string
  after?: string
}

export interface Report {
  workspaceId: string
  chatId: string
  /** When it was written (ms). */
  at: number
  state: ReportState
  ticket?: string
  title: string
  summary: string
  /** Left out when the work has no product context. */
  feature?: string
  problem?: string
  choices: ReportChoice[]
  screens: ReportScreen[]
  links: { label: string; url: string }[]
  left: string[]
}

/** The state's word and its status tone, as the sidebar's dots say it. */
export const REPORT_STATE = {
  blocked: { tone: 'failing', word: 'Blocked' },
  done: { tone: 'done', word: 'Done' },
  question: { tone: 'waiting', word: 'Question' },
  ready: { tone: 'done', word: 'PR ready' },
  review: { tone: 'waiting', word: 'Screens to review' },
} as const satisfies Record<ReportState, { tone: 'failing' | 'waiting' | 'done'; word: string }>

/** Most characters per text, as the host checks them (`report.rs`). */
export const REPORT_LIMITS = { choice: 120, context: 300, summary: 200, title: 60 } as const

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

/** The choices the agent made, in its order: the open one is a question, not a choice. */
export const madeChoices = (choices: readonly ReportChoice[]) => choices.filter((c) => !c.open)

/** The question the report asks, if any (the host allows one). */
export const openChoice = (choices: readonly ReportChoice[]) => choices.find((c) => c.open)

/** Only web links open (the host checks it too). */
export function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

/** The link that is the ticket: its label names it, or its address ends on its number. */
export function ticketLink(
  ticket: string | undefined,
  links: Report['links']
): Report['links'][number] | undefined {
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
