import { expect, test } from 'bun:test'

import type { ReportBlock } from './blocks/types'

import { placePrCards } from './pr-cards'

const R = 'https://github.com/o/r/pull'
const numbers = (cards: { number: number }[][]) => cards.map((c) => c.map((r) => r.number))

test('a pr block is the card: its PR gets no second one anywhere', () => {
  const blocks: ReportBlock[] = [
    { kind: 'text', lead: `Opened ${R}/1 and ${R}/2.` },
    { ci: 'passing', kind: 'pr', number: 1, review: 'none', title: 't', url: `${R}/1` },
  ]
  expect(numbers(placePrCards(blocks).cards)).toEqual([[2], []])
})

test("a PR among a text's links leaves the line for a card; other links stay", () => {
  const blocks: ReportBlock[] = [
    {
      kind: 'text',
      links: [
        { label: 'PR', url: `${R}/3/files` },
        { label: 'Ticket', url: 'https://linear.app/x/1' },
      ],
    },
  ]
  const placed = placePrCards(blocks)
  expect(numbers(placed.cards)).toEqual([[3]])
  expect(placed.blocks[0]).toEqual({
    kind: 'text',
    links: [{ label: 'Ticket', url: 'https://linear.app/x/1' }],
  })
})

test('each PR once, under the first block that names it', () => {
  const blocks: ReportBlock[] = [
    { kind: 'callout', text: `Risky: ${R}/4`, tone: 'risk' },
    { items: [`Merge ${R}/4`, `Then ${R}/5`], kind: 'left' },
    { items: [{ status: 'done', text: `Opened ${R}/5` }], kind: 'steps' },
    { items: [], kind: 'decisions' },
  ]
  expect(numbers(placePrCards(blocks).cards)).toEqual([[4], [5], [], []])
})
