import { expect, test } from 'bun:test'

import type { Block, ChatState, Permission } from '../chat/model'
import type { Report } from '../model/report'

import {
  deskGroups,
  type DeskInput,
  deskOrder,
  movedOn,
  nextNeed,
  placeOf,
  rowTitle,
  rowTone,
} from './desk-model'

const MIN = 60_000

const report = (state: Report['state'], at: number): Report => ({
  at,
  chatId: 'c',
  sections: {},
  state,
  summary: '',
  title: 't',
  workspaceId: 'w',
})

const ws = (id: string, o: Partial<DeskInput> = {}): DeskInput => ({
  activeAt: 0,
  answered: false,
  colour: id,
  id,
  order: 0,
  pending: null,
  project: 'p',
  projectId: 'p',
  report: null,
  signal: null,
  title: id,
  ...o,
})

test('a chat waiting on the user needs them, whatever the report says', () => {
  expect(placeOf(ws('a', { pending: 'question', signal: 'waiting' })).kind).toBe('question')
  const permission = ws('a', { pending: 'permission', report: report('done', 5) })
  expect(placeOf(permission)).toMatchObject({ group: 'needs', kind: 'permission' })
})

test('a standing question or block needs the user; an answered or stale one does not', () => {
  expect(placeOf(ws('a', { report: report('question', 10) })).group).toBe('needs')
  expect(placeOf(ws('a', { report: report('blocked', 10) })).kind).toBe('blocked')
  expect(placeOf(ws('a', { answered: true, report: report('question', 10) }))).toMatchObject({
    group: 'quiet',
    kind: 'idle',
  })
  // The chat moved on long after: the report no longer tells where it stands.
  const stale = ws('a', { activeAt: 10 + 30 * MIN, report: report('blocked', 10) })
  expect(placeOf(stale)).toMatchObject({ group: 'quiet', kind: 'idle' })
})

test('work in progress is working; current review and ready need the user; done is quiet', () => {
  expect(placeOf(ws('a', { report: report('review', 10), signal: 'working' })).group).toBe(
    'working'
  )
  for (const state of ['review', 'ready'] as const) {
    expect(placeOf(ws('a', { report: report(state, 10) }))).toMatchObject({
      group: 'needs',
      kind: state,
    })
  }
  expect(placeOf(ws('a', { report: report('done', 10) }))).toMatchObject({
    group: 'quiet',
    kind: 'done',
  })
  // A ready report whose PR is merged, or a stale one, is history.
  expect(placeOf(ws('a', { merged: true, report: report('ready', 10) })).group).toBe('quiet')
  const stale = ws('a', { activeAt: 10 + 30 * MIN, report: report('review', 10) })
  expect(placeOf(stale).group).toBe('quiet')
  expect(placeOf(ws('a'))).toMatchObject({ group: 'quiet', kind: 'idle' })
})

test('a page at work never needs the user: its row goes where the chat puts it', () => {
  const page = report('working', 10)
  expect(placeOf(ws('a', { activeAt: 20, report: page, signal: 'working' }))).toMatchObject({
    group: 'working',
    kind: 'working',
  })
  // The chat stopped and its turn is unread: finished, whatever the page still says.
  expect(placeOf(ws('a', { activeAt: 20, report: page, signal: 'done' }))).toMatchObject({
    group: 'needs',
    kind: 'finished',
  })
  expect(placeOf(ws('a', { activeAt: 20, report: page }))).toMatchObject({
    group: 'quiet',
    kind: 'idle',
  })
  // Never out of date, however long its chat runs: its title still names the row.
  const long = ws('a', { activeAt: 10 + 60 * MIN, report: { ...page, title: 'Refunds' } })
  expect(rowTitle(long)).toBe('Refunds')
  const groups = deskGroups([ws('a', { report: page }), ws('b', { report: report('review', 5) })])
  expect(groups.needs.map((r) => r.id)).toEqual(['b'])
  expect(rowTone(null, deskGroups([ws('a', { report: page })]).quiet[0])).toBeNull()
})

test('a turn finished and unread, with no newer report, is "Finished"', () => {
  expect(placeOf(ws('a', { activeAt: 40, signal: 'done' }))).toMatchObject({
    group: 'needs',
    kind: 'finished',
    since: 40,
  })
  // The report written in that turn says it better.
  const reported = ws('a', { activeAt: 40, report: report('done', 40), signal: 'done' })
  expect(placeOf(reported)).toMatchObject({ group: 'quiet', kind: 'done' })
  const before = ws('a', { activeAt: 40, report: report('done', 10), signal: 'done' })
  expect(placeOf(before).kind).toBe('finished')
})

test('needs come question, review, blocked, ready, permission, finished, then longest waiting', () => {
  const groups = deskGroups([
    ws('finished', { activeAt: 3, signal: 'done' }),
    ws('blocked', { report: report('blocked', 1) }),
    ws('ready', { report: report('ready', 2) }),
    ws('late-q', { report: report('question', 50) }),
    ws('perm', { activeAt: 5, pending: 'permission' }),
    ws('review', { report: report('review', 60) }),
    ws('early-q', { report: report('question', 20) }),
    ws('w2', { order: 2, signal: 'working' }),
    ws('w1', { order: 1, signal: 'working' }),
    ws('old', { activeAt: 10 }),
    ws('new', { activeAt: 90, report: report('done', 80) }),
  ])
  expect(groups.needs.map((r) => r.id)).toEqual([
    'early-q',
    'late-q',
    'review',
    'blocked',
    'ready',
    'perm',
    'finished',
  ])
  expect(groups.working.map((r) => r.id)).toEqual(['w1', 'w2'])
  expect(groups.quiet.map((r) => r.id)).toEqual(['new', 'old'])
  expect(deskOrder(groups)[0]?.id).toBe('early-q')
})

test("a row's title: the report's while current, else the task, never the bare colour", () => {
  const titled = { ...report('review', 10), title: 'Refund to the card' }
  expect(rowTitle(ws('a', { report: titled, title: 'Fix refunds' }))).toBe('Refund to the card')
  const stale = ws('a', { activeAt: 10 + 30 * MIN, report: titled, title: 'Fix refunds' })
  expect(rowTitle(stale)).toBe('Fix refunds')
  // Only the colour word to show: the report's title, even an old one.
  expect(rowTitle({ ...stale, colour: 'cobalt', title: 'cobalt' })).toBe('Refund to the card')
  expect(rowTitle(ws('a', { colour: 'cobalt', title: 'cobalt' }))).toBe('cobalt')
})

test('after an answer, selection moves to the next need, else the one before, else none', () => {
  expect(nextNeed(['a', 'b', 'c'], ['a', 'c'], 'b')).toBe('c')
  expect(nextNeed(['a', 'b', 'c'], ['a', 'b'], 'c')).toBe('b')
  // The next one left too meanwhile: the one after it.
  expect(nextNeed(['a', 'b', 'c', 'd'], ['a', 'd'], 'b')).toBe('d')
  expect(nextNeed(['a'], [], 'a')).toBe(null)
  // One that arrived meanwhile, when nothing else is left.
  expect(nextNeed(['a'], ['z'], 'a')).toBe('z')
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

test('a row marks a current report that needs you, the chat live signal first', () => {
  const at = Date.now()
  const row = (state: Report['state'], extra: Partial<DeskInput> = {}) =>
    deskGroups([ws('a', { activeAt: at, report: report(state, at), ...extra })]).needs[0]
  expect(rowTone(null, row('blocked'))).toBe('failing')
  expect(rowTone(null, row('question'))).toBe('waiting')
  expect(rowTone(null, row('review'))).toBe('waiting')
  expect(rowTone(null, row('ready'))).toBe('done')
  expect(rowTone('working', row('blocked'))).toBe('working')
  expect(rowTone('waiting', row('ready'))).toBe('waiting')
  // Answered or out of date: no longer needs you, no mark.
  expect(row('question', { answered: true })).toBeUndefined()
  expect(rowTone(null, undefined)).toBeNull()
  expect(rowTone('done', undefined)).toBe('done')
  // A finished turn follows the chat's own signal (hidden on the row being read).
  expect(rowTone(null, row('done', { activeAt: at + MIN, signal: 'done' }))).toBeNull()
})
