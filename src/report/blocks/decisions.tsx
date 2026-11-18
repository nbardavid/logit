import type { DecisionsBlock } from './types'

import { BlockHead, CARD, has, Inline } from './primitives'

/** Product choices made, each with what was set aside: one soft card, a hairline between. */
export function Decisions({ items, title = 'Product choices' }: Omit<DecisionsBlock, 'kind'>) {
  const made = items.filter((c) => has(c.text))
  if (made.length === 0) return null
  return (
    <section>
      <BlockHead count={made.length}>{title}</BlockHead>
      <ol className={`${CARD} divide-border divide-y`}>
        {made.map((c, i) => (
          <li
            // oxlint-disable-next-line no-array-index-key -- two choices may say the same
            key={i}
            className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2 px-3.5 py-2.5"
          >
            <span className="text-faint pt-px text-xs leading-5 tabular-nums">{i + 1}</span>
            <span className="text-foreground text-sm leading-5 font-medium text-pretty break-words select-text">
              <Inline text={c.text} />
            </span>
            {has(c.setAside) && (
              <span className="text-muted-foreground col-start-2 mt-0.5 text-sm leading-5 break-words select-text">
                <span className="text-faint">Set aside · </span>
                <Inline text={c.setAside} />
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
