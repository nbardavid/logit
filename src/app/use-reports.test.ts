import { expect, test } from 'bun:test'

import type { Report } from '../model/report'

import { isNewReport, opensOnArrival, type ReportEntry, settle } from './use-reports'

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
  loading: true,
  report: r,
  unread,
})

test('a report is new when there was none, or it was written at another time', () => {
  expect(isNewReport(null, report(1))).toBe(true)
  expect(isNewReport(report(1), report(1))).toBe(false)
  expect(isNewReport(report(1), report(2))).toBe(true)
  expect(isNewReport(report(1), null)).toBe(false)
})

test('only a live report nobody is looking at leaves the cue', () => {
  expect(settle(entry(null), report(1), true, false).unread).toBe(true)
  expect(settle(entry(null), report(1), true, true).unread).toBe(false)
  // Read on selecting the workspace: what was there before is not news.
  expect(settle(entry(null), report(1), false, false).unread).toBe(false)
  // The same report read again keeps an unseen cue, and clears the error and the loading.
  const kept = settle({ ...entry(report(1), true), error: 'x' }, report(1), false, false)
  expect(kept).toEqual({ error: null, loading: false, report: report(1), unread: true })
  // Gone: nothing to cue.
  expect(settle(entry(report(1), true), null, true, false).unread).toBe(false)
})

test('arriving at a workspace opens its report only when it asks something unseen', () => {
  const asking = (state: Report['state'], unread: boolean) => entry({ ...report(1), state }, unread)
  expect(opensOnArrival(asking('question', true))).toBe(true)
  expect(opensOnArrival(asking('blocked', true))).toBe(true)
  // Seen already: the usual tab stays.
  expect(opensOnArrival(asking('question', false))).toBe(false)
  for (const state of ['review', 'ready', 'done'] as const) {
    expect(opensOnArrival(asking(state, true))).toBe(false)
  }
  expect(opensOnArrival(entry(null))).toBe(false)
  expect(opensOnArrival(undefined)).toBe(false)
})
