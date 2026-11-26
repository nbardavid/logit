import { describe, expect, test } from 'bun:test'

import type { QuotaCache, QuotaEntry } from './quota'

import { chatAccount, DEFAULT_ACCOUNT, pickAccount } from './accounts'

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

describe('chatAccount', () => {
  test('a chat runs on the account picked for it while it has room', () => {
    expect(
      chatAccount('b', ['a'], ['default', 'a', 'b'], { accounts: { a: at(0), b: at(80) } })
    ).toBe('b')
  })
  test('a picked account that is full hands over to the project pick', () => {
    expect(
      chatAccount('b', ['a'], ['default', 'a', 'b'], { accounts: { a: at(10), b: at(100) } })
    ).toBe('a')
  })
  test('nothing picked, or a picked account gone, is the project pick', () => {
    expect(chatAccount(undefined, ['a'], ['default', 'a'], {})).toBe('a')
    expect(chatAccount('gone', ['a'], ['default', 'a'], {})).toBe('a')
  })
})
