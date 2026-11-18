import { expect, test } from 'bun:test'

import type { Block, Exchange } from './model'

import { cardSpot, chatPrCards } from './pr-cards'

const R = 'https://github.com/o/r/pull'

function exchange(key: string, texts: string[], live = false): Exchange {
  const blocks: Block[] = texts.map((text) => ({ kind: 'text', text }))
  return {
    answer: '',
    blocks,
    end: null,
    items: blocks.map((block, i) => ({ block, key: `b${i}`, kind: 'block' })),
    key,
    live,
    user: null,
  }
}

const shown = (spots: Map<string, { number: number }[]>) =>
  Object.fromEntries([...spots].map(([spot, refs]) => [spot, refs.map((r) => r.number)]))

test('each PR once in the chat, under the latest message that links it', () => {
  const chat = [
    exchange('e1', [`Opened ${R}/1 and ${R}/2.`]),
    exchange('e2', [`Checks on ${R}/1 passed.`, 'Nothing else.']),
  ]
  expect(shown(chatPrCards(chat))).toEqual({
    [cardSpot('e1', 'b0')]: [2],
    [cardSpot('e2', 'b0')]: [1],
  })
})

test('a message still being written shows no card yet', () => {
  const chat = [
    exchange('e1', [`Earlier: ${R}/1`]),
    exchange('e2', [`Now ${R}/1 and ${R}/3`], true),
  ]
  // The link may be half typed: the card stays where it was.
  expect(shown(chatPrCards(chat))).toEqual({ [cardSpot('e1', 'b0')]: [1] })
  // Done, it moves under the new message.
  const done = [chat[0] as Exchange, { ...(chat[1] as Exchange), live: false }]
  expect(shown(chatPrCards(done))).toEqual({ [cardSpot('e2', 'b0')]: [1, 3] })
})

test('a chat without PR links has no card', () => {
  expect(chatPrCards([exchange('e1', ['Hello', `${R}/x`])]).size).toBe(0)
})
