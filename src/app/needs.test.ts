import { expect, test } from 'bun:test'

import type { Block, ChatState, Permission } from '../chat/model'

import {
  isUnread,
  loadNeedsSeen,
  movedOn,
  type NeedFacts,
  needKey,
  nextNeed,
  pageStop,
  rowTone,
} from './needs'

const MIN = 60_000

test('a page stands on its stop until answered past, merged or long outdated', () => {
  const at = Date.now()
  expect(pageStop({ at, state: 'question' }, { activeAt: at })).toBe('question')
  expect(pageStop({ at, state: 'ready' }, { activeAt: at })).toBe('ready')
  expect(pageStop({ at, state: 'working' }, { activeAt: at })).toBeNull()
  expect(pageStop({ at, state: 'done' }, { activeAt: at })).toBeNull()
  expect(pageStop({ at, state: 'question' }, { activeAt: at, answered: true })).toBeNull()
  expect(pageStop({ at, state: 'ready' }, { activeAt: at, merged: true })).toBeNull()
  expect(pageStop({ at, state: 'review' }, { activeAt: at + 60 * MIN })).toBeNull()
  expect(pageStop(null, { activeAt: at })).toBeNull()
})

const facts = (o: Partial<NeedFacts> = {}): NeedFacts => ({
  activeAt: 5,
  parked: false,
  reportAt: 3,
  signal: null,
  stop: null,
  waiting: null,
  ...o,
})

test('what a row asks changes with each new ask; parked and idle rows ask nothing', () => {
  expect(needKey(facts())).toBeNull()
  expect(needKey(facts({ signal: 'working' }))).toBeNull()
  expect(needKey(facts({ signal: 'waiting', waiting: 'r1' }))).toBe('wait:r1')
  expect(needKey(facts({ stop: 'review' }))).toBe('page:3')
  expect(needKey(facts({ reportAt: 9, stop: 'review' }))).toBe('page:9')
  expect(needKey(facts({ signal: 'done' }))).toBe('done:5')
  // A chat waiting outranks the page.
  expect(needKey(facts({ stop: 'ready', waiting: 'r2' }))).toBe('wait:r2')
  expect(needKey(facts({ parked: true, stop: 'blocked', waiting: 'r3' }))).toBeNull()
})

test('a row asks until the user has seen that very ask', () => {
  expect(isUnread('page:3', {}, 'a')).toBe(true)
  expect(isUnread('page:3', { a: 'page:3' }, 'a')).toBe(false)
  // The agent wrote something new that waits on the user: it asks again.
  expect(isUnread('page:9', { a: 'page:3' }, 'a')).toBe(true)
  expect(isUnread(null, {}, 'a')).toBe(false)
})

test('⌘0 goes to the next unseen one in sidebar order, wrapping, never the current', () => {
  const order = ['a', 'b', 'c', 'd']
  const asks = (ids: string[]) => (id: string) => ids.includes(id)
  expect(nextNeed(order, 'b', asks(['a', 'd']))).toBe('d')
  expect(nextNeed(order, 'd', asks(['a', 'd']))).toBe('a')
  expect(nextNeed(order, null, asks(['c']))).toBe('c')
  expect(nextNeed(order, 'c', asks(['c']))).toBeNull()
  expect(nextNeed(order, 'a', asks([]))).toBeNull()
})

test("a row's mark: the chat's live signal first, then the page's stop, then done", () => {
  expect(rowTone(null, 'blocked')).toBe('failing')
  expect(rowTone(null, 'question')).toBe('waiting')
  expect(rowTone(null, 'review')).toBe('waiting')
  expect(rowTone(null, 'ready')).toBe('done')
  expect(rowTone('working', 'blocked')).toBe('working')
  expect(rowTone('waiting', 'ready')).toBe('waiting')
  expect(rowTone('done', null)).toBe('done')
  expect(rowTone(null, null)).toBeNull()
})

test('what was seen loads back, and anything unreadable is nothing seen', () => {
  const store = (raw: string | null) => ({ getItem: () => raw })
  expect(loadNeedsSeen(store('{"a":"page:3","b":4}'))).toEqual({ a: 'page:3' })
  expect(loadNeedsSeen(store('nope'))).toEqual({})
  expect(loadNeedsSeen(store(null))).toEqual({})
  expect(loadNeedsSeen(null)).toEqual({})
})

const tool = (id: string, name: string, done = true): Block =>
  ({
    id,
    input: {},
    kind: 'tool',
    name,
    result: done ? { isError: false, text: '' } : undefined,
  }) as Block
const chat = (
  turns: ChatState['turns'],
  pending: Permission[] = []
): Pick<ChatState, 'turns' | 'pending' | 'queued'> => ({ pending, queued: [], turns })
const said = (role: 'user' | 'assistant', blocks: Block[] = []) => ({ blocks, id: role, role })

test('a chat moved on past its report once a question after it is answered, or it is written to', () => {
  const report = tool('r', 'mcp__logit__report')
  const ask = tool('q', 'AskUserQuestion', false)
  const waiting = { requestId: 'p', toolUseId: 'q' } as Permission
  expect(movedOn(chat([said('assistant', [report, ask])], [waiting]))).toBe(false)
  // Answered here: the permission is gone, before Claude's result comes.
  expect(movedOn(chat([said('assistant', [report, ask])]))).toBe(true)
  expect(movedOn(chat([said('assistant', [report]), said('user')]))).toBe(true)
  expect(movedOn(chat([said('user'), said('assistant', [report])]))).toBe(false)
  // No report in what this window has of the chat: nothing to say.
  expect(movedOn(chat([]))).toBe(false)
})
