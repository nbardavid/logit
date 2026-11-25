// The report as blocks: one renderer over an ordered list, each block its own component.
// Nothing here knows its surface; a block takes plain data and, at most, asks to zoom or open a link.
import type { CSSProperties, ReactNode } from 'react'

import { cn } from '@/lib/utils'

import type { PrRef } from '../../git/pr-link'
import type { ReportBlock } from './types'

import { In } from '../../app/enter'
import { PrCards } from '../../cards/pr-card'
import { placePrCards } from '../pr-cards'
import { Callout } from './callout'
import { Context } from './context'
import { Decisions } from './decisions'
import { Left } from './left'
import { type BlockActions, BlockContext } from './primitives'
import { PullRequest } from './pull-request'
import { Question } from './question'
import { Screens } from './screens'
import { Steps } from './steps'
import { Table } from './table'
import { Text } from './text'

export type { Zoom } from './primitives'
export type { ReportBlock, ScreenStep } from './types'
export { ZoomedShot } from './zoom'

/** One block, by its kind. */
export function Block({ block }: { block: ReportBlock }): ReactNode {
  switch (block.kind) {
    case 'text':
      return <Text {...block} />
    case 'context':
      return <Context {...block} />
    case 'decisions':
      return <Decisions {...block} />
    case 'question':
      return <Question {...block} />
    case 'screens':
      return <Screens {...block} />
    case 'callout':
      return <Callout {...block} />
    case 'steps':
      return <Steps {...block} />
    case 'table':
      return <Table {...block} />
    case 'pr':
      return <PullRequest {...block} />
    case 'left':
      return <Left {...block} />
    default:
      return null
  }
}

/**
 * The blocks in order, in one rhythm, each rising in a beat after the one before when the
 * list is new (key the parent to replay it). `start` offsets the beat for what comes above.
 */
export function Blocks({
  actions = {},
  blocks,
  cards,
  className,
  prCards = true,
  start = 0,
}: {
  blocks: readonly ReportBlock[]
  actions?: BlockActions
  className?: string
  /** Each PR named gets its card under its block; false when the surface places them. */
  prCards?: boolean
  /** The cards under each block, placed already (a page places them across its sections). */
  cards?: readonly PrRef[][]
  start?: number
}) {
  // Each PR the report names shows once, as a live card under the block that names it.
  let placed: { blocks: readonly ReportBlock[]; cards: readonly PrRef[][] } = { blocks, cards: [] }
  if (cards !== undefined) placed = { blocks, cards }
  else if (prCards) placed = placePrCards(blocks)
  return (
    <BlockContext value={actions}>
      <div className={cn('flex flex-col gap-6 @min-[520px]/report:gap-8', className)}>
        {placed.blocks.map((b, i) => (
          <In
            // oxlint-disable-next-line no-array-index-key -- the agent's order is the identity
            key={i}
            enter="block-in"
            className="flex min-w-0 flex-col gap-3 empty:hidden"
            style={{ '--i': i + start } as CSSProperties}
          >
            <Block block={b} />
            <PrCards links={placed.cards[i] ?? []} cwd={actions.cwd} />
          </In>
        ))}
      </div>
    </BlockContext>
  )
}
