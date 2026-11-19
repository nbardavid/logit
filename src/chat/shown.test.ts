import { expect, test } from 'bun:test'

import { type Block, exchanges, initialChat, liveStep, toolSummary, type Turn } from './model'
import { cardSpot, chatPrCards } from './pr-cards'
import { isShown, SHOW_TOOL, shownBlocks, shownImages, shownPrLinks } from './shown'

const PR = 'https://github.com/o/r/pull/7'

const call = (input: Record<string, unknown>, result?: { isError: boolean; text: string }) =>
  ({
    id: 'show-1',
    input,
    json: '',
    kind: 'tool',
    name: SHOW_TOOL,
    ...(result === undefined ? {} : { result }),
  }) as Block & { kind: 'tool' }
const ok = { isError: false, text: 'Shown in the conversation (1 block).' }

test('the kinds an agent may send map onto blocks; anything else is left out', () => {
  const blocks = shownBlocks({
    blocks: [
      { kind: 'text', links: [{ label: 'PR', url: PR }, { label: '' }], paragraphs: [' Hi ', ''] },
      { kind: 'callout', text: 'Careful', tone: 'alarm' },
      { items: [{ status: 'failed', text: 'E2E' }, { text: '' }], kind: 'steps', title: 'Checks' },
      { columns: ['Key', 'Value'], kind: 'table', rows: [['Port'], ['Host', 'x', 'extra']] },
      { items: [{ setAside: 'Click', text: 'Hover' }], kind: 'decisions' },
      { kind: 'screens', steps: [{ after: 'shots/a.png', caption: 'Menu' }, { caption: 'none' }] },
      { items: ['Merge'], kind: 'left' },
      { kind: 'question', question: '?' },
      { kind: 'pr', url: PR },
      { feature: 'x', kind: 'context' },
      { kind: 'text', paragraphs: [] },
      'junk',
    ],
  })
  expect(blocks).toEqual([
    { kind: 'text', links: [{ label: 'PR', url: PR }], paragraphs: ['Hi'] },
    { kind: 'callout', text: 'Careful', tone: 'note' },
    { items: [{ status: 'failed', text: 'E2E' }], kind: 'steps', title: 'Checks' },
    {
      columns: ['Key', 'Value'],
      kind: 'table',
      rows: [
        ['Port', ''],
        ['Host', 'x'],
      ],
    },
    { items: [{ setAside: 'Click', text: 'Hover' }], kind: 'decisions' },
    { kind: 'screens', steps: [{ after: 'shots/a.png', caption: 'Menu' }] },
    { items: ['Merge'], kind: 'left' },
  ])
  expect(shownImages(blocks)).toEqual(['shots/a.png'])
  expect(shownBlocks({ blocks: 'nope' })).toEqual([])
})

test('a show call stands as its blocks once it went through; in flight or refused, a tool row', () => {
  const blocks = { blocks: [{ items: ['Merge'], kind: 'left' }] }
  expect(isShown(call(blocks, ok))).toBe(true)
  expect(isShown(call(blocks))).toBe(false)
  expect(isShown(call(blocks, { isError: true, text: 'blocks[0]: …' }))).toBe(false)
  const turns = (result?: typeof ok): Turn[] => [
    { blocks: [{ kind: 'text', text: 'Show me' }], id: 'u', role: 'user' },
    { blocks: [{ kind: 'text', text: 'Here.' }, call(blocks, result)], id: 'a', role: 'assistant' },
  ]
  const [done] = exchanges(turns(ok), false)
  expect(done?.items.map((i) => i.kind)).toEqual(['block', 'block'])
  const [live] = exchanges(turns(), true)
  expect(live?.items.at(-1)?.kind).toBe('group')
  expect(liveStep({ ...initialChat, status: 'working', turns: turns() }, '/w')).toEqual({
    target: '',
    verb: 'Showing',
  })
  expect(toolSummary(SHOW_TOOL, blocks, '/w')).toBe('1 block')
})

test('a PR a shown block links gets its card under it, once in the chat', () => {
  const shownCall = call({ blocks: [{ kind: 'text', links: [{ label: 'PR', url: PR }] }] }, ok)
  expect(shownPrLinks(shownBlocks(shownCall.input)).map((r) => r.number)).toEqual([7])
  const ex = (key: string, block: Block) => ({
    answer: '',
    blocks: [block],
    end: null,
    items: [{ block, key: 'b0', kind: 'block' as const }],
    key,
    live: false,
    user: null,
  })
  const cards = chatPrCards([ex('e1', { kind: 'text', text: `Opened ${PR}` }), ex('e2', shownCall)])
  expect([...cards.keys()]).toEqual([cardSpot('e2', 'b0')])
  // A later message that links it takes the card.
  const later = chatPrCards([ex('e2', shownCall), ex('e3', { kind: 'text', text: `See ${PR}` })])
  expect([...later.keys()]).toEqual([cardSpot('e3', 'b0')])
})
