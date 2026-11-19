import { expect, test } from 'bun:test'

import {
  clampText,
  isOutdated,
  isStale,
  isWebUrl,
  leftAfterMerge,
  linksOf,
  reportAge,
  ticketLink,
} from './report'

test('a report is stale only when the chat moved on well after it', () => {
  const at = 1_000_000_000
  expect(isStale(at, undefined)).toBe(false)
  expect(isStale(at, at + 60_000)).toBe(false)
  expect(isStale(at, at + 6 * 60_000)).toBe(true)
  expect(isStale(at, at - 60_000)).toBe(false)
})

test('only a stop its chat clearly moved on from is out of date; working never is', () => {
  const at = 1_000_000_000
  const later = at + 30 * 60_000
  for (const state of ['question', 'review', 'ready', 'blocked'] as const) {
    expect(isOutdated({ at, state }, later)).toBe(true)
    expect(isOutdated({ at, state }, at + 60_000)).toBe(false)
  }
  expect(isOutdated({ at, state: 'working' }, later)).toBe(false)
  expect(isOutdated({ at, state: 'done' }, later)).toBe(false)
})

test("a page's links are its text blocks', the ticket's first", () => {
  const link = (label: string) => ({ label, url: `https://x/${label}` })
  const links = linksOf({
    sections: {
      result: [{ kind: 'text', links: [link('pr')] }],
      ticket: [
        { kind: 'text', links: [link('ticket')] },
        { kind: 'callout', text: '', tone: 'note' },
      ],
    },
  })
  expect(links.map((l) => l.label)).toEqual(['ticket', 'pr'])
})

test('ages read as the sidebar says them, with "ago"', () => {
  const now = 10 * 24 * 3_600_000
  expect(reportAge(now - 10_000, now)).toBe('just now')
  expect(reportAge(now - 4 * 60_000, now)).toBe('4m ago')
  expect(reportAge(now - 3 * 3_600_000, now)).toBe('3h ago')
  expect(reportAge(now - 2 * 24 * 3_600_000, now)).toBe('2d ago')
  expect(reportAge(0, now)).toBe('1w ago')
})

test('texts clamp by characters, with an ellipsis only when cut', () => {
  expect(clampText('court', 10)).toBe('court')
  expect(clampText('é'.repeat(60), 60)).toBe('é'.repeat(60))
  expect(clampText('abcdef ghij', 8)).toBe('abcdef…')
})

test('only http and https links count as web links', () => {
  expect(isWebUrl('https://linear.app/x/RAI-48')).toBe(true)
  expect(isWebUrl('http://localhost:3000')).toBe(true)
  expect(isWebUrl('javascript:alert(1)')).toBe(false)
  expect(isWebUrl('file:///etc/passwd')).toBe(false)
  expect(isWebUrl('not a url')).toBe(false)
})

test('the ticket links to the link that names it or ends on it', () => {
  const linear = { label: 'Ticket RAI-48', url: 'https://linear.app/t/issue/RAI-48/titre' }
  const pr = { label: 'PR #480', url: 'https://github.com/o/r/pull/480' }
  const board = { label: 'Fiche', url: 'https://board.example/tickets/42' }
  expect(ticketLink('RAI-48', [pr, linear])).toBe(linear)
  expect(ticketLink('#48', [pr])).toBeUndefined()
  expect(ticketLink('#42', [pr, board])).toBe(board)
  expect(ticketLink('#42', [{ label: '#42', url: 'javascript:void 0' }])).toBeUndefined()
  expect(ticketLink(undefined, [linear])).toBeUndefined()
})

test('once merged, items that only ask to merge are done', () => {
  const left = [
    'Merge the PR',
    'Merger la PR #12',
    'Merge, then run the migration',
    'Vérifier lundi',
  ]
  expect(leftAfterMerge(left)).toEqual(['Merge, then run the migration', 'Vérifier lundi'])
})
