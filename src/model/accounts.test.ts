import { describe, expect, test } from 'bun:test'

import type { QuotaCache, QuotaEntry } from './quota'

import { DEFAULT_ACCOUNT, pickAccount } from './accounts'

const at = (session: number, weekly = 0): QuotaEntry =>
  ({
    fetchedAt: 0,
    snapshot: {
      windows: [
        { kind: 'session', percent: session },
        { kind: 'weekly', percent: weekly },
      ],
    },
  }) as unknown as QuotaEntry

describe('pickAccount', () => {
  test('a project naming no account runs on the default one', () => {
    expect(pickAccount([], ['default', 'b'], {})).toBe(DEFAULT_ACCOUNT)
  })

  test('takes the account with the most quota left', () => {
    const cache: QuotaCache = { accounts: { b: at(70), c: at(20) } }
    expect(pickAccount(['b', 'c'], ['default', 'b', 'c'], cache)).toBe('c')
  })

  test('a weekly window counts as much as the session', () => {
    const cache: QuotaCache = { accounts: { b: at(10, 95), c: at(40, 10) } }
    expect(pickAccount(['b', 'c'], ['default', 'b', 'c'], cache)).toBe('c')
  })

  test('unknown quota comes after room, before a full account', () => {
    expect(pickAccount(['b', 'c'], ['b', 'c'], { accounts: { b: at(100) } })).toBe('c')
    expect(pickAccount(['b', 'c'], ['b', 'c'], { accounts: { b: at(60) } })).toBe('b')
  })

  test('accounts removed since fall back to the default one', () => {
    expect(pickAccount(['gone'], ['default'], {})).toBe(DEFAULT_ACCOUNT)
  })
})
