import { cn } from '@/lib/utils'

import type { StepsBlock } from './types'

import { BlockHead, has, Inline, Mark } from './primitives'

const TONE = { done: 'good', failed: 'bad', skipped: 'muted' } as const

/** What was done, in order: a compact timeline, a thread joining the marks. */
export function Steps({ items, title = 'What it did' }: Omit<StepsBlock, 'kind'>) {
  const list = items.filter((s) => has(s.text))
  if (list.length === 0) return null
  return (
    <section>
      <BlockHead count={list.length}>{title}</BlockHead>
      <ol className="flex flex-col">
        {list.map((s, i) => (
          <li
            // oxlint-disable-next-line no-array-index-key -- steps are in order and may repeat
            key={i}
            className="relative grid grid-cols-[16px_minmax(0,1fr)] gap-x-3 pb-3 last:pb-0"
          >
            {i < list.length - 1 && (
              <span aria-hidden className="bg-border absolute top-5 bottom-0.5 left-[7.5px] w-px" />
            )}
            <span className="pt-0.5">
              <Mark tone={TONE[s.status]} />
            </span>
            <span className="min-w-0 text-sm leading-5">
              <span
                className={cn(
                  'break-words select-text',
                  s.status === 'skipped'
                    ? 'text-faint line-through decoration-faint/50'
                    : 'text-foreground'
                )}
              >
                <Inline text={s.text} />
              </span>
              {has(s.detail) && (
                <span className="text-muted-foreground block break-words select-text">
                  <Inline text={s.detail} />
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
