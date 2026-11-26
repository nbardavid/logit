import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'

import { DEFAULT_ACCOUNT } from '../model/accounts'
import { claudeSnapshot, type QuotaCache, type RawClaudeUsage } from '../model/quota'
import { currentAccounts, noteQuotas, reloadAccounts } from './use-accounts'

const READ_MS = 30_000
/** Claude's endpoint punishes callers faster than this; the TUI polls at the same floor. */
const FETCH_FLOOR_MS = 180_000
/** A cache this old means no TUI is polling: the GUI takes over. */
const TAKE_OVER_MS = FETCH_FLOOR_MS + 60_000

/**
 * Quotas from the cache the TUI shares (the default account), fetched here only when nothing
 * else keeps it fresh; the accounts added in Settings are fetched here, each at the same floor.
 */
export function useQuotas() {
  const [cache, setCache] = useState<QuotaCache>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const lastFetch = new Map<string, number>()
    const tick = async () => {
      if (currentAccounts().length === 0) await reloadAccounts()
      const read = ((await invoke<QuotaCache | null>('read_quota_cache').catch(() => null)) ??
        {}) as QuotaCache
      const now = Date.now()
      const due = (id: string, fetchedAt: number | undefined, floor: number) =>
        now - (fetchedAt ?? 0) > floor && now - (lastFetch.get(id) ?? 0) > FETCH_FLOOR_MS
      let wrote = false
      if (due(DEFAULT_ACCOUNT, read.claude?.fetchedAt, TAKE_OVER_MS)) {
        lastFetch.set(DEFAULT_ACCOUNT, now)
        try {
          const raw = await invoke<RawClaudeUsage>('fetch_claude_usage', { account: null })
          read.claude = { fetchedAt: now, snapshot: claudeSnapshot(raw, now) }
          wrote = true
          if (live) setError(null)
        } catch (error_) {
          if (live) setError(String(error_))
        }
      }
      const others = currentAccounts().filter((a) => a.id !== DEFAULT_ACCOUNT)
      const accounts = Object.fromEntries(
        Object.entries(read.accounts ?? {}).filter(([id]) => others.some((a) => a.id === id))
      )
      for (const { id } of others) {
        if (!due(id, accounts[id]?.fetchedAt, FETCH_FLOOR_MS)) continue
        lastFetch.set(id, now)
        try {
          const raw = await invoke<RawClaudeUsage>('fetch_claude_usage', { account: id })
          accounts[id] = { fetchedAt: now, snapshot: claudeSnapshot(raw, now) }
          wrote = true
        } catch {
          // Shown as unknown in Settings › Accounts; the next floor tries again.
        }
      }
      read.accounts = accounts
      if (wrote) await invoke('write_quota_cache', { cache: read }).catch(() => {})
      if (live) {
        setCache(read)
        noteQuotas(read)
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), READ_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [])

  return { cache, error }
}
