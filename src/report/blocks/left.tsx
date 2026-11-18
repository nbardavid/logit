import type { LeftBlock } from './types'

import { BlockHead, has, Inline } from './primitives'

/** What the user still has to do: a short list with empty boxes, theirs to tick in their head. */
export function Left({ items, title = 'Left for you' }: Omit<LeftBlock, 'kind'>) {
  const list = items.filter(has)
  if (list.length === 0) return null
  return (
    <section>
      <BlockHead count={list.length > 1 ? list.length : undefined}>{title}</BlockHead>
      <ul className="flex flex-col gap-2">
        {list.map((item, i) => (
          <li
            // oxlint-disable-next-line no-array-index-key -- the agent's list, in its order
            key={i}
            className="text-ink-soft flex gap-2.5 text-sm leading-5 select-text"
          >
            <span
              aria-hidden
              className="border-line-strong mt-[3px] size-3.5 flex-none rounded-sm border-[1.5px]"
            />
            <span className="min-w-0 break-words">
              <Inline text={item} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
