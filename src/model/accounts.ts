// Claude accounts (accounts.rs): the default one (`~/.claude`) and those added in Settings.

import type { QuotaCache, QuotaEntry } from './quota'

export const DEFAULT_ACCOUNT = 'default'

export interface Account {
  id: string
  /** Who signed in; empty when nobody is. */
  email: string
  plan: string
}

export function quotaOf(cache: QuotaCache, id: string): QuotaEntry | undefined {
  return id === DEFAULT_ACCOUNT ? cache.claude : cache.accounts?.[id]
}

/** How full an account is: its fullest window, in percent; null when its quota is unknown. */
export function fullness(entry: QuotaEntry | undefined): number | null {
  const windows = entry?.snapshot.windows ?? []
  if (windows.length === 0) return null
  return Math.max(...windows.map((w) => w.percent ?? 0))
}

/**
 * The account a new Claude of a project runs as: among the project's (the default one when it
 * names none, or none of them exists any more), the one with the most quota left; ties and
 * unknown quotas go by the project's order, a full account only when all are.
 */
export function pickAccount(project: string[], known: string[], cache: QuotaCache): string {
  const listed = project.filter((id) => known.includes(id))
  const candidates = listed.length > 0 ? listed : [DEFAULT_ACCOUNT]
  const score = (id: string) => {
    const full = fullness(quotaOf(cache, id))
    // Unknown: after every account known to have room, before a full one.
    if (full === null) return 99.5
    return full >= 100 ? 1000 + full : full
  }
  let best = candidates[0] ?? DEFAULT_ACCOUNT
  for (const id of candidates) if (score(id) < score(best)) best = id
  return best
}
