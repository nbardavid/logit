import { expect, test } from 'bun:test'

import type { Report } from '../model/report'

import { opensOnArrival, type ReportEntry, settle } from './use-reports'

const report = (at: number): Report => ({
  at,
  chatId: 'c',
  choices: [],
  feature: '',
  left: [],
  links: [],
  problem: '',
  screens: [],
  state: 'ready',
  summary: '',
  title: 't',
  workspaceId: 'w',
})
const entry = (r: Report | null, unread = false): ReportEntry => ({
  error: null,
  loading: false,
  report: r,
  unread,
})

test('a read that answers clears the error and the loading', () => {
  expect(settle(report(1))).toEqual({ error: null, loading: false, report: report(1) })
  expect(settle(null).report).toBe(null)
})

test('arriving at a workspace opens its report only when it asks something unread', () => {
  const asking = (state: Report['state'], unread: boolean) => entry({ ...report(1), state }, unread)
  expect(opensOnArrival(asking('question', true))).toBe(true)
  expect(opensOnArrival(asking('blocked', true))).toBe(true)
  // Read already: the usual tab stays.
  expect(opensOnArrival(asking('question', false))).toBe(false)
  for (const state of ['review', 'ready', 'done'] as const) {
    expect(opensOnArrival(asking(state, true))).toBe(false)
  }
  expect(opensOnArrival(entry(null))).toBe(false)
  expect(opensOnArrival(undefined)).toBe(false)
})
