// A report as the blocks it draws: the summary as the lead, then the agent's own blocks when
// it composed them, else today's fixed fields mapped onto blocks in their reading order.
import type { Question } from '../chat/model'
import type { ReportAsk } from '../chat/reports'
import type { QuestionBlock, ReportBlock } from './blocks/types'

import { splitRecommended } from '../app/question-card'
import {
  clampText,
  leftAfterMerge,
  madeChoices,
  openChoice,
  type Report,
  REPORT_LIMITS,
} from '../model/report'

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

/** What the report asks: the chat's live question when there is one, else its open choice. */
export function questionsOf(report: Report, ask: ReportAsk): QuestionBlock[] {
  if (ask.kind !== 'unknown') return ask.questions.map((q) => questionBlock(q, ask))
  const open = openChoice(report.choices)
  const own = report.blocks?.filter((b): b is QuestionBlock => b.kind === 'question') ?? []
  if (own.length > 0) return own
  if (open === undefined) return []
  return [
    {
      kind: 'question',
      options: [],
      question: clampText(open.text, REPORT_LIMITS.choice),
      status: 'asked',
    },
  ]
}

export function blocksOf(
  report: Report,
  o: {
    ask?: ReportAsk
    merged?: boolean
    /** Draw the question here (false where the surface asks it itself, as Desk's dock does). */
    question?: boolean
  } = {}
): ReportBlock[] {
  const { ask = { kind: 'unknown' }, merged = false, question = true } = o
  const lead: ReportBlock[] =
    report.summary.trim() === ''
      ? []
      : [{ kind: 'text', lead: clampText(report.summary, REPORT_LIMITS.summary) }]
  // A question asked of the user only stands while it is the report's state.
  const asks = question && report.state === 'question' ? questionsOf(report, ask) : []
  const left = merged ? leftAfterMerge(report.left) : report.left
  // The links close the report, one quiet line; its PRs become cards there.
  const linksBlock: ReportBlock = { kind: 'text', links: report.links }
  if (report.blocks !== undefined) {
    const own = report.blocks
      .filter((b) => b.kind !== 'question')
      .map((b) => (b.kind === 'left' && merged ? { ...b, items: leftAfterMerge(b.items) } : b))
    return [...lead, ...asks, ...own, linksBlock]
  }
  const leftBlock: ReportBlock = { items: left, kind: 'left' }
  // Ready, done or blocked: what is left is the point, right under the summary.
  const leftFirst =
    report.state === 'ready' || report.state === 'done' || report.state === 'blocked'
  return [
    ...lead,
    ...(leftFirst ? [leftBlock] : []),
    ...asks,
    {
      feature:
        report.feature === undefined ? undefined : clampText(report.feature, REPORT_LIMITS.context),
      kind: 'context',
      problem:
        report.problem === undefined ? undefined : clampText(report.problem, REPORT_LIMITS.context),
    },
    {
      items: madeChoices(report.choices).map((c) => ({
        setAside: c.setAside,
        text: clampText(c.text, REPORT_LIMITS.choice),
      })),
      kind: 'decisions',
    },
    ...(leftFirst ? [] : [leftBlock]),
    {
      kind: 'screens',
      steps: report.screens.map((s) => ({ after: s.after, before: s.before, caption: s.step })),
    },
    linksBlock,
  ]
}
