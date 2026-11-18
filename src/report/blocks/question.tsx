import { CheckIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

import type { QuestionBlock } from './types'

import { CARD, has, Recommended } from './primitives'

const STATUS = {
  answered: 'Answered',
  asked: 'Asked in the chat',
  pending: 'Waiting for your answer in the chat',
} as const

/**
 * The question the agent waits on, read-only: numbered options that weigh the same until one
 * is picked, the recommended one marked. Desk answers it in its dock instead.
 */
export function Question({
  answer = [],
  header,
  options,
  question,
  status = 'asked',
}: Omit<QuestionBlock, 'kind'>) {
  if (!has(question)) return null
  const picked = new Set(answer)
  return (
    <section
      className={cn(CARD, 'flex flex-col gap-3 px-3.5 pt-3 pb-3.5')}
      aria-label="Claude asks"
    >
      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground text-xs font-medium">
          {has(header) ? header : 'Claude asks'}
        </span>
        <p className="text-foreground text-base font-semibold text-pretty break-words select-text">
          {question}
        </p>
      </div>
      {options.length > 0 && (
        <ol className="flex flex-col gap-1">
          {options.map((o, i) => {
            const on = picked.has(o.label)
            return (
              <li
                key={o.label}
                className={cn(
                  'flex items-start gap-2.5 rounded-md border px-2.5 py-2 transition-colors duration-120 ease-out',
                  on ? 'border-line-strong bg-active' : 'border-border'
                )}
              >
                <span className="text-faint w-3 flex-none text-xs leading-5 tabular-nums">
                  {i + 1}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-foreground flex flex-wrap items-center gap-x-1.5 text-sm leading-5 font-medium break-words select-text">
                    {o.label}
                    {o.recommended === true && <Recommended />}
                  </span>
                  {has(o.description) && (
                    <span className="text-muted-foreground text-sm leading-5 break-words select-text">
                      {o.description}
                    </span>
                  )}
                </span>
                {on && (
                  <CheckIcon
                    className="text-foreground mt-[3px] size-3.5 flex-none"
                    aria-label="Picked"
                  />
                )}
              </li>
            )
          })}
        </ol>
      )}
      <p
        className={cn(
          'flex items-center gap-1.5 text-xs',
          status === 'pending' ? 'text-warn-ink font-medium' : 'text-muted-foreground'
        )}
      >
        {status === 'pending' && (
          <span className="bg-warn size-1.5 rounded-full animate-[breathe_1.8s_ease-in-out_infinite]" />
        )}
        {status === 'answered' && <CheckIcon className="text-good size-3.5" strokeWidth={2} />}
        {STATUS[status]}
        {status === 'answered' && answer.length > 0 && (
          <span className="text-foreground min-w-0 truncate font-medium">{answer.join(', ')}</span>
        )}
      </p>
    </section>
  )
}
