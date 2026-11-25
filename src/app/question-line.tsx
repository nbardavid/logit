import { ArrowDownIcon } from 'lucide-react'
import { type RefObject, useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

import { type Block, type Permission, questionsOf } from '../chat/model'
import { answersOf } from '../chat/reports'
import { splitRecommended } from './question-card'
import { dotClass } from './status-dot'

const DOT = 'size-1.5 flex-none rounded-full'

/**
 * A question once it is answered, or declined: one quiet line per question, what was picked
 * after it. While it waits, its card stands at the end of the transcript instead.
 */
export function AskedRecord({ block }: { block: Block & { kind: 'tool' } }) {
  const asked =
    questionsOf({
      description: null,
      input: block.input,
      requestId: '',
      suggestions: [],
      toolName: block.name,
      toolUseId: block.id,
    }) ?? []
  const { result } = block
  const answers = result && !result.isError ? answersOf(result.text) : {}
  return (
    <div className="flex flex-col">
      {asked.map((q) => {
        const answer = answers[q.question]
        const picked = answer !== undefined && answer !== ''
        let reply = 'Not answered'
        if (picked)
          reply = answer
            .split(', ')
            .map((a) => splitRecommended(a).text)
            .join(', ')
        else if (result?.isError === true) reply = 'Skipped'
        else if (result !== undefined) reply = 'Answered'
        return (
          // One line, as the tool rows: what was asked, faint, then the answer in ink. Cut
          // short, the full line shows on hover.
          <div
            key={q.question}
            title={`${q.question} → ${reply}`}
            className="text-faint flex min-h-7 min-w-0 items-center gap-1.5 py-[3px] text-base"
          >
            {/* Where a group's chevron sits: the text lines up with "Ran 3 commands". */}
            <span className="flex w-3.5 flex-none justify-center">
              <span className={cn(DOT, picked ? 'bg-good' : 'border-faint border-[1.5px]')} />
            </span>
            <span className="min-w-0 truncate">{q.question}</span>
            <span className="text-label flex-none" aria-label="answered">
              →
            </span>
            <span
              className={cn(
                'max-w-[60%] min-w-0 flex-none truncate',
                picked ? 'text-foreground' : 'italic'
              )}
            >
              {reply}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** What the slim line says of a pending question: its first, and how many more. */
export function askedText(permission: Permission | undefined): string {
  const asked = permission ? questionsOf(permission) : null
  const first = asked?.[0]?.question ?? ''
  return asked && asked.length > 1 ? `${first} (+${asked.length - 1})` : first
}

/**
 * Whether the card in `tail` is in view in `scroller`: while a third of it shows above the
 * fade (the composer's 48px edge). Always true while nothing is asked.
 */
export function useInView(
  tail: RefObject<HTMLElement | null>,
  scroller: RefObject<HTMLElement | null>,
  asking: boolean,
  /** Changes when the card or its scroller is a new element: watched anew. */
  watch?: unknown
): boolean {
  const [inView, setInView] = useState(true)
  useEffect(() => {
    const el = tail.current
    const root = scroller.current
    if (!asking || !el || !root) return
    const observer = new IntersectionObserver(
      ([e]) => setInView(e === undefined || e.intersectionRatio >= 0.3),
      { root, rootMargin: '0px 0px -48px 0px', threshold: [0, 0.3, 0.6, 1] }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [tail, scroller, asking, watch])
  return !asking || inView
}

/**
 * The question, scrolled away: one line over the composer's top edge (it takes the ↓'s
 * place), that goes back down to the card.
 */
export function QuestionBar({
  away,
  className,
  line,
  onShow,
}: {
  line: string
  away: boolean
  onShow: () => void
  /** Its column, where it is not the chat's. */
  className?: string
}) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 bottom-2 mx-auto flex w-full max-w-[784px] px-4',
        className
      )}
    >
      <button
        type="button"
        aria-hidden={!away}
        tabIndex={away ? 0 : -1}
        aria-label={`Claude asks: ${line}. Show the question`}
        className={cn(
          'group/bar bg-background hover:bg-hover shadow-composer flex h-8 w-full min-w-0 items-center gap-2 rounded-lg border px-3 text-left text-sm transition-[background-color,opacity] duration-120',
          away
            ? 'animate-in fade-in slide-in-from-bottom-[4px] pointer-events-auto duration-140 ease-out'
            : 'opacity-0 duration-100 ease-in'
        )}
        // The composer keeps the focus: Enter and the numbers still answer.
        onMouseDown={(e) => e.preventDefault()}
        onClick={onShow}
      >
        <span className={dotClass('waiting')} />
        <span className="text-faint flex-none">Claude asks</span>
        <span className="text-foreground min-w-0 truncate">{line}</span>
        <ArrowDownIcon className="text-faint group-hover/bar:text-foreground ml-auto size-3.5 flex-none transition-colors duration-120" />
      </button>
    </div>
  )
}
