// Each workspace's latest report, read from the host when the workspace comes on screen and
// whenever one of its chats writes a new one, and the list of every workspace's latest (for
// the sidebar's stops and for arriving at a workspace not read yet). No polling. What the user has read is
// kept in localStorage (report-seen.ts), so a restart knows what is new.
import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { Report } from '../model/report'

import { isSeen, loadSeen, markSeen, saveSeen, type Seen, storage } from './report-seen'

export interface ReportEntry {
  /** null: the workspace has none. */
  report: Report | null
  /** Being read again; the last one read stays on screen meanwhile. */
  loading: boolean
  /** Why the last read failed, or null. */
  error: string | null
  /** Written after the newest report the user read there. */
  unread: boolean
}

type Stored = Omit<ReportEntry, 'unread'>

const FIRST: Stored = { error: null, loading: true, report: null }

/** The entry once a read answered: what it read, with no error and no loading. */
export const settle = (report: Report | null): Stored => ({ error: null, loading: false, report })

/** Arriving at a workspace, its panel opens on the report: one that waits on the user (a
 * question, or blocked) and that they have not read. Read, it no longer does. */
export const opensOnArrival = (entry: Pick<ReportEntry, 'report' | 'unread'> | undefined) =>
  entry?.unread === true &&
  (entry.report?.state === 'question' || entry.report?.state === 'blocked')

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Every workspace's latest report (images left out), as `report_list` answers. */
export interface ReportList {
  /** null until the first answer. */
  reports: Report[] | null
  error: string | null
}

export function useReports(workspaceId: string | undefined) {
  const [entries, setEntries] = useState<Record<string, Stored>>({})
  // The newest read per workspace: an older one answering late is dropped.
  const reads = useRef(new Map<string, number>())
  const [seen, setSeen] = useState<Seen>(() => loadSeen(Date.now(), storage()))
  // Kept at once, the first floor included.
  useEffect(() => saveSeen(seen, storage()), [seen])
  // The workspace whose Report tab is on screen right now, if any (set by `watch` each render).
  const [watched, setWatched] = useState<string | null>(null)
  const [list, setList] = useState<ReportList>({ error: null, reports: null })
  const listReads = useRef(0)

  const read = useCallback((wsId: string) => {
    const n = (reads.current.get(wsId) ?? 0) + 1
    reads.current.set(wsId, n)
    setEntries((s) => ({ ...s, [wsId]: { ...(s[wsId] ?? FIRST), loading: true } }))
    invoke<Report | null>('report_get', { workspace: wsId }).then(
      (report) => {
        if (reads.current.get(wsId) === n) setEntries((s) => ({ ...s, [wsId]: settle(report) }))
      },
      (error: unknown) => {
        if (reads.current.get(wsId) !== n) return
        setEntries((s) => ({
          ...s,
          [wsId]: { ...(s[wsId] ?? FIRST), error: message(error), loading: false },
        }))
      }
    )
  }, [])

  const readList = useCallback(() => {
    const n = ++listReads.current
    invoke<Report[]>('report_list').then(
      (reports) => {
        if (listReads.current === n) setList({ error: null, reports })
      },
      (error: unknown) => {
        if (listReads.current === n) setList((l) => ({ ...l, error: message(error) }))
      }
    )
  }, [])

  useEffect(readList, [readList])

  // On screen: read again (it may have changed while away, or while the window was closed).
  useEffect(() => {
    if (workspaceId !== undefined) read(workspaceId)
  }, [workspaceId, read])

  /** The freshest report known for a workspace: its own read once answered, else the list's. */
  const reportOf = (wsId: string): Report | null => {
    const own = entries[wsId]
    if (own !== undefined && (own.report !== null || !own.loading)) return own.report
    return list.reports?.find((r) => r.workspaceId === wsId) ?? null
  }
  const unreadOf = (wsId: string, report: Report | null) =>
    report !== null && !isSeen(seen, wsId, report.at)
  const entryOf = (wsId: string): ReportEntry | undefined => {
    const own = entries[wsId]
    return own === undefined ? undefined : { ...own, unread: unreadOf(wsId, own.report) }
  }

  const see = useCallback((wsId: string, at: number) => {
    setSeen((s) => markSeen(s, wsId, at))
  }, [])

  // The Report tab on screen: what it shows is read, before it paints (no cue flashes).
  const watchedAt = watched === null ? null : (entries[watched]?.report?.at ?? null)
  useLayoutEffect(() => {
    if (watched !== null && watchedAt !== null) see(watched, watchedAt)
  }, [watched, watchedAt, see])

  const entry = workspaceId === undefined ? undefined : entryOf(workspaceId)
  const arriving = workspaceId === undefined ? null : reportOf(workspaceId)
  return {
    /** A chat of a workspace just wrote a report. */
    arrived: useCallback(
      (chat: { record: { workspaceId: string } }) => {
        read(chat.record.workspaceId)
        readList()
      },
      [read, readList]
    ),
    /** The workspace on screen should open on its Report tab when it comes on screen. */
    asks:
      workspaceId !== undefined &&
      opensOnArrival({ report: arriving, unread: unreadOf(workspaceId, arriving) }),
    entry,
    entryOf,
    /** Whether the workspace on screen has a Report tab (a report, or a read that failed);
     * while its own read runs, the list says, so the panel opens split at once. */
    has: entry !== undefined && (arriving !== null || entry.error !== null),
    list: { ...list, retry: readList },
    /** Reads a workspace's report unless it is read already or being read. */
    load: (wsId: string) => {
      if (entries[wsId] === undefined) read(wsId)
    },
    reportOf,
    retry: () => {
      if (workspaceId !== undefined) read(workspaceId)
    },
    retryOf: read,
    /** Whether the workspace on screen shows its Report tab right now. */
    watch: (on: boolean) => {
      const next = on && workspaceId !== undefined ? workspaceId : null
      // Same component, so React allows it mid-render: it renders again before committing.
      if (next !== watched) setWatched(next)
    },
  }
}

export type Reports = ReturnType<typeof useReports>
