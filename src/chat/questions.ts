// AskUserQuestion: what Claude asks, read from its call or its permission.

import type { Block, Permission } from './model'

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (typeof v === 'object' && v !== null ? (v as Json) : {})
const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** One of AskUserQuestion's questions: Claude waits on the user's pick. */
export interface Question {
  question: string
  header: string
  options: { label: string; description: string }[]
  multiSelect: boolean
}

/** The questions a permission asks, when it is AskUserQuestion's; null for any other tool. */
export function questionsOf(p: Permission): Question[] | null {
  if (p.toolName !== 'AskUserQuestion' || !Array.isArray(p.input.questions)) return null
  return p.input.questions.map((raw) => {
    const q = obj(raw)
    const options = Array.isArray(q.options) ? q.options.map(obj) : []
    return {
      header: str(q.header),
      multiSelect: q.multiSelect === true,
      options: options.map((o) => ({ description: str(o.description), label: str(o.label) })),
      question: str(q.question),
    }
  })
}

/** A question Claude asked: its card while it waits, then one line with its answer. */
export const isQuestionCall = (b: Block): b is Block & { kind: 'tool' } =>
  b.kind === 'tool' && b.name === 'AskUserQuestion'
