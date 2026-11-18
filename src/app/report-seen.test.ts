import { expect, test } from 'bun:test'

import { isSeen, loadSeen, markSeen, saveSeen } from './report-seen'

const memory = () => {
  const items = new Map<string, string>()
  return {
    getItem: (k: string) => items.get(k) ?? null,
    items,
    setItem: (k: string, v: string) => void items.set(k, v),
  }
}

test('the first launch counts every older report as read', () => {
  const seen = loadSeen(100, memory())
  expect(seen).toEqual({ at: {}, floor: 100 })
  expect(isSeen(seen, 'w', 90)).toBe(true)
  expect(isSeen(seen, 'w', 120)).toBe(false)
})

test('a report read stays read after a restart; a newer one does not', () => {
  const store = memory()
  const first = loadSeen(100, store)
  saveSeen(markSeen(first, 'w', 150), store)
  // A later launch keeps the first floor and what was read.
  const again = loadSeen(500, store)
  expect(again.floor).toBe(100)
  expect(isSeen(again, 'w', 150)).toBe(true)
  expect(isSeen(again, 'w', 160)).toBe(false)
  expect(isSeen(again, 'other', 150)).toBe(false)
})

test('marking an older report never moves seen back, and changes nothing when read already', () => {
  const seen = markSeen(loadSeen(0, null), 'w', 200)
  expect(markSeen(seen, 'w', 150)).toBe(seen)
  expect(markSeen(seen, 'w', 200)).toBe(seen)
})

test('storage that throws or holds junk starts again quietly', () => {
  const broken = {
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('full')
    },
  }
  expect(loadSeen(7, broken)).toEqual({ at: {}, floor: 7 })
  expect(() => saveSeen({ at: {}, floor: 1 }, broken)).not.toThrow()
  const junk = memory()
  junk.items.set('logit.reports.seen', '{"floor":"x"}')
  expect(loadSeen(9, junk)).toEqual({ at: {}, floor: 9 })
})
