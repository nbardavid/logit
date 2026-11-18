// A report as an ordered list of typed blocks an agent composes. Plain, serialisable data
// only (strings, numbers, arrays, image URLs): the same list draws on Desk's stage, in the
// right panel's Report tab, and later in a chat's transcript. DESIGN.md › Report blocks says
// when to reach for each; a new kind is added there, never improvised in a surface.

/** Lead and paragraphs. Inline: **bold**, `code`, [label](https://…). */
export interface TextBlock {
  kind: 'text'
  title?: string
  /** One sentence that reads first, larger. */
  lead?: string
  paragraphs?: string[]
  /** Links out, on one quiet line under the text (a GitHub PR among them becomes its card). */
  links?: { label: string; url: string }[]
}

/** Why the work exists: who it is for, and what they live today. */
export interface ContextBlock {
  kind: 'context'
  feature?: string
  problem?: string
}

/** Product choices made, each with what was set aside. */
export interface DecisionsBlock {
  kind: 'decisions'
  title?: string
  items: { text: string; setAside?: string }[]
}

/** The one question the agent waits on. Desk asks it in its dock; elsewhere it shows here. */
export interface QuestionBlock {
  kind: 'question'
  question: string
  header?: string
  options: { label: string; description?: string; recommended?: boolean }[]
  /** Where it stands in the chat: waiting, answered, or only asked. */
  status?: 'pending' | 'answered' | 'asked'
  /** The labels picked, once answered. */
  answer?: string[]
}

export interface ScreenStep {
  caption: string
  /** Image URLs (`data:` or https). One side alone is a single screen. */
  before?: string
  after?: string
}

/** Screens: a before/after pair, a single screen, or a flow of several steps. */
export interface ScreensBlock {
  kind: 'screens'
  title?: string
  steps: ScreenStep[]
}

/** A note, an assumption made, or a risk: one short paragraph with its own tint. */
export interface CalloutBlock {
  kind: 'callout'
  tone: 'note' | 'assumption' | 'risk'
  title?: string
  text: string
}

/** What was done, in order: a compact timeline. */
export interface StepsBlock {
  kind: 'steps'
  title?: string
  items: { text: string; status: 'done' | 'failed' | 'skipped'; detail?: string }[]
}

/** Key/value pairs (two columns) or a few columns; scrolls sideways when narrow. */
export interface TableBlock {
  kind: 'table'
  title?: string
  columns: string[]
  rows: string[][]
}

/** The pull request, where it stands, one action. */
export interface PullRequestBlock {
  kind: 'pr'
  number: number
  title: string
  url: string
  branch?: string
  ci: 'passing' | 'failing' | 'running' | 'none'
  review: 'approved' | 'changes' | 'waiting' | 'none'
}

/** What the user still has to do themselves. */
export interface LeftBlock {
  kind: 'left'
  title?: string
  items: string[]
}

export type ReportBlock =
  | TextBlock
  | ContextBlock
  | DecisionsBlock
  | QuestionBlock
  | ScreensBlock
  | CalloutBlock
  | StepsBlock
  | TableBlock
  | PullRequestBlock
  | LeftBlock

export type BlockKind = ReportBlock['kind']
