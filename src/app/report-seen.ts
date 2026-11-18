// The newest report the user has read, per workspace, kept in localStorage so a restart keeps
// it: the Report tab opens on arrival only for one not read yet. Nothing goes to the host.

const KEY = 'logit.reports.seen'

export interface Seen {
  /** Reports written before this were here before seen was kept: they count as read. */
  floor: number
  /** The time (`Report.at`) of the newest report read, by workspace. */
  at: Record<string, number>
}

/** What localStorage holds, or a fresh record whose floor is `now` (the first launch with it). */
export function loadSeen(now: number, storage: Pick<Storage, 'getItem'> | null): Seen {
  try {
    const raw = storage?.getItem(KEY)
    if (raw !== null && raw !== undefined) {
      const parsed = JSON.parse(raw) as Partial<Seen>
      if (typeof parsed.floor === 'number' && typeof parsed.at === 'object' && parsed.at !== null)
        return { at: { ...parsed.at }, floor: parsed.floor }
    }
  } catch {
    // Unreadable or blocked: start again.
  }
  return { at: {}, floor: now }
}

export function saveSeen(seen: Seen, storage: Pick<Storage, 'setItem'> | null) {
  try {
    storage?.setItem(KEY, JSON.stringify(seen))
  } catch {
    // Full or blocked: it lives in memory until the next launch.
  }
}

/** The report written at `at` was read: the same record when nothing changes. */
export function markSeen(seen: Seen, workspaceId: string, at: number): Seen {
  if (isSeen(seen, workspaceId, at)) return seen
  return { ...seen, at: { ...seen.at, [workspaceId]: at } }
}

export const isSeen = (seen: Seen, workspaceId: string, at: number) =>
  at <= Math.max(seen.floor, seen.at[workspaceId] ?? 0)

/** localStorage, or null where it throws (a sandboxed frame, a private window). */
export function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}
