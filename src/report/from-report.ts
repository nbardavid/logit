// A task's page as what it draws: a lead (the summary, or why it is blocked), the question it
// waits on, then its six sections in their fixed order, each as blocks (src/report/blocks). A
// PR the page links anywhere becomes its card once, under the block that names it first.
import type { Question } from '../chat/model'
import type { ReportAsk } from '../chat/reports'
import type { PrRef } from '../git/pr-link'
import type { QuestionBlock, ReportBlock } from './blocks/types'

import { splitRecommended } from '../app/question-card'
import {
  clampText,
  leftAfterMerge,
  type Report,
  REPORT_LIMITS,
  type ReportProgress,
  type SectionName,
  SECTIONS,
} from '../model/report'
import { placePrCards } from './pr-cards'

/** Each section's label, as the page says it. */
export const SECTION_LABEL: Record<SectionName, string> = {
  left: 'Left for you',
  plan: 'What I will do',
  progress: 'Progress',
  result: 'Result',
  ticket: 'The ticket',
  understood: 'What I understood',
}

/** A chat's question as a block, with where it stands. */
function questionBlock(q: Question, ask: ReportAsk): QuestionBlock {
  const said = ask.kind === 'answered' ? (ask.answers[q.question] ?? '') : ''
  return {
    answer: said === '' ? [] : said.split(', ').map((a) => splitRecommended(a).text),
    header: q.header,
    kind: 'question',
    options: q.options.map((o) => {
      const { recommended, text } = splitRecommended(o.label)
      return { description: o.description, label: text, recommended }
    }),
    question: q.question,
    status: ask.kind === 'unknown' ? 'asked' : ask.kind,
  }
}

/** What the page asks: the chat's live question when there is one, else the one it wrote. */
export function questionsOf(report: Report, ask: ReportAsk): QuestionBlock[] {
  if (ask.kind !== 'unknown') return ask.questions.map((q) => questionBlock(q, ask))
  const asked = report.question?.trim() ?? ''
  if (asked === '') return []
  return [
    {
      kind: 'question',
      options: [],
      question: clampText(asked, REPORT_LIMITS.choice),
      status: 'asked',
    },
  ]
}

/** One section of the page, ready to draw. */
export interface PageSection {
  name: SectionName
  label: string
  /** Not written yet (or cleared): a faint line in its place. */
  empty: boolean
  /** Its blocks (the left section as one left block without its head). */
  blocks: ReportBlock[]
  /** The cards under each of its blocks. */
  cards: PrRef[][]
  /** Progress only: the agent's steps. */
  progress: ReportProgress[]
  /** When it was last set (ms), when the page says it. */
  at?: number
}

export interface Page {
  /** Under the head: the summary, or the reason it is blocked as a risk callout. */
  lead: ReportBlock[]
  /** The question it waits on, drawn after the lead (empty where the surface asks it). */
  asks: ReportBlock[]
  sections: PageSection[]
}

export function pageOf(
  report: Report,
  o: {
    ask?: ReportAsk
    merged?: boolean
    /** Draw the question here (false where it is asked elsewhere: the Report tab leaves it to the chat's card). */
    question?: boolean
  } = {}
): Page {
  const { ask = { kind: 'unknown' }, merged = false, question = true } = o
  const summary = clampText(report.summary.trim(), REPORT_LIMITS.summary)
  let lead: ReportBlock[] = []
  if (summary !== '')
    lead =
      report.state === 'blocked'
        ? [{ kind: 'callout', text: summary, title: 'Blocked', tone: 'risk' }]
        : [{ kind: 'text', lead: summary }]
  // A question asked of the user only stands while it is the page's state.
  const asks = question && report.state === 'question' ? questionsOf(report, ask) : []
  const s = report.sections
  const left = merged ? leftAfterMerge(s.left ?? []) : (s.left ?? [])
  const listed: Record<SectionName, ReportBlock[]> = {
    left: left.length === 0 ? [] : [{ items: left, kind: 'left', title: '' }],
    plan: s.plan ?? [],
    progress: [],
    result: (s.result ?? []).map((b) =>
      b.kind === 'left' && merged ? { ...b, items: leftAfterMerge(b.items) } : b
    ),
    ticket: s.ticket ?? [],
    understood: s.understood ?? [],
  }
  // Each PR once, across the whole page: under the first block that names it.
  const placed = placePrCards(SECTIONS.flatMap((name) => listed[name]))
  let at = 0
  const sections = SECTIONS.map((name): PageSection => {
    const n = listed[name].length
    const blocks = placed.blocks.slice(at, at + n)
    const cards = placed.cards.slice(at, at + n)
    at += n
    const progress = name === 'progress' ? (s.progress ?? []) : []
    return {
      at: report.updated?.[name],
      blocks,
      cards,
      empty: name === 'progress' ? progress.length === 0 : n === 0,
      label: SECTION_LABEL[name],
      name,
      progress,
    }
  })
  return { asks, lead, sections }
}

/**
 * The empty sections that close the page, from the last one written on: two or more read as
 * one faint line ("Still to come"), so a page just started is not a column of blanks.
 */
export function trailingEmpty(sections: readonly PageSection[]): number {
  const last = sections.findLastIndex((s) => !s.empty)
  const trailing = sections.length - 1 - last
  return trailing >= 2 ? trailing : 0
}
