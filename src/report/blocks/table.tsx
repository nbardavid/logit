import { cn } from '@/lib/utils'

import type { TableBlock } from './types'

import { BlockHead, CARD, has, Inline } from './primitives'

/** Key/value pairs or a few columns. Narrow, it scrolls sideways rather than squeezing. */
export function Table({ columns, rows, title }: Omit<TableBlock, 'kind'>) {
  const body = rows.filter((r) => r.some(has))
  if (body.length === 0) return null
  const pairs = columns.length === 2
  return (
    <section>
      {has(title) && <BlockHead count={body.length}>{title}</BlockHead>}
      <div className={cn(CARD, 'overflow-x-auto overscroll-x-contain')}>
        <table className="w-full min-w-max border-collapse text-sm leading-5">
          {columns.some(has) && (
            <thead>
              <tr>
                {columns.map((c, i) => (
                  <th
                    // oxlint-disable-next-line no-array-index-key -- columns, in order
                    key={i}
                    className="text-faint px-3.5 pt-2.5 pb-1.5 text-left text-xs font-medium whitespace-nowrap"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {body.map((r, i) => (
              // oxlint-disable-next-line no-array-index-key -- rows, in order
              <tr
                key={i}
                className="border-border border-t first:border-t-0 [thead+tbody_&]:first:border-t"
              >
                {columns.map((_, j) => (
                  <td
                    // oxlint-disable-next-line no-array-index-key -- cells, in order
                    key={j}
                    className={cn(
                      'max-w-[360px] px-3.5 py-2 align-top tabular-nums select-text',
                      pairs && j === 0
                        ? 'text-muted-foreground whitespace-nowrap'
                        : 'text-foreground'
                    )}
                  >
                    <Inline text={r[j] ?? ''} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
