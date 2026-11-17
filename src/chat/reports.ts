// The reports a chat wrote: calls of logit's MCP `report` tool that succeeded.
import { type Block, type ChatState, type Question, questionsOf } from './model'

/** logit's MCP server's `report` tool, as Claude Code names it in the stream. */
export const REPORT_TOOL = 'mcp__logit__report'

/** The ids of the report calls that completed without error, in order. */
function reportCalls(blocks: readonly Block[]): string[] {
  return blocks.flatMap((b) =>
    b.kind === 'tool' && b.name === REPORT_TOOL && b.result !== undefined && !b.result.isError
      ? [b.id]
      : []
  )
}

/** Whether a report completed between two states of a chat. */
export function reportedSince(before: readonly Block[], after: readonly Block[]): boolean {
  const seen = new Set(reportCalls(before))
  return reportCalls(after).some((id) => !seen.has(id))
}

/** Where the question a report asks stands in its chat. */
export type ReportAsk =
  /** AskUserQuestion waits on the user right now. */
  | { kind: 'pending'; questions: Question[]; requestId: string }
  /** It was answered: the picks by question, as Claude Code's result says them. */
  | { kind: 'answered'; questions: Question[]; answers: Record<string, string> }
  /** No question in the chat since the report, or one this window cannot tell the fate of. */
  | { kind: 'unknown' }

/** `"question"="answer"` pairs, as Claude Code words AskUserQuestion's result. */
export function answersOf(text: string): Record<string, string> {
  const answers: Record<string, string> = {}
  for (const m of text.matchAll(/"((?:[^"\\]|\\.)*)"="((?:[^"\\]|\\.)*)"/g)) {
    answers[m[1] ?? ''] = m[2] ?? ''
  }
  return answers
}

/**
 * The question a chat asked after its last report (AskUserQuestion's), and whether it waits
 * or was answered. Before any report in the chat, its last question counts.
 */
export function reportAsk(state: Pick<ChatState, 'turns' | 'pending'> | undefined): ReportAsk {
  if (state === undefined) return { kind: 'unknown' }
  const blocks = state.turns.flatMap((t) => t.blocks)
  const lastReport = blocks.findLastIndex(
    (b) => b.kind === 'tool' && b.name === REPORT_TOOL && b.result?.isError === false
  )
  const ask = blocks
    .slice(lastReport + 1)
    .findLast((b) => b.kind === 'tool' && b.name === 'AskUserQuestion')
  if (ask?.kind !== 'tool') return { kind: 'unknown' }
  const pending = state.pending.find((p) => p.toolUseId === ask.id)
  const questions = pending ? questionsOf(pending) : null
  if (pending && questions) return { kind: 'pending', questions, requestId: pending.requestId }
  const asked = questionsOf({
    description: null,
    input: ask.input,
    requestId: '',
    suggestions: [],
    toolName: 'AskUserQuestion',
    toolUseId: ask.id,
  })
  if (ask.result === undefined || ask.result.isError || asked === null) return { kind: 'unknown' }
  return { answers: answersOf(ask.result.text), kind: 'answered', questions: asked }
}
