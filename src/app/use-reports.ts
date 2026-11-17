// Each workspace's latest report, read from the host when the workspace comes on screen and
// whenever one of its chats writes a new one. No polling.
import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { Report } from '../model/report'

export interface ReportEntry {
  /** null: the workspace has none. */
  report: Report | null
  /** Being read again; the last one read stays on screen meanwhile. */
  loading: boolean
  /** Why the last read failed, or null. */
  error: string | null
  /** A new one arrived while the Report tab was not on screen. */
  unread: boolean
}

const FIRST: ReportEntry = { error: null, loading: true, report: null, unread: false }

/** A new report: none before, or a different one (written later). */
export const isNewReport = (was: Report | null, now: Report | null) =>
  now !== null && (was === null || was.at !== now.at || was.chatId !== now.chatId)

/** The entry once a read answered: unread only for a live report nobody is looking at. */
export function settle(
  was: ReportEntry,
  report: Report | null,
  live: boolean,
  watched: boolean
): ReportEntry {
  const fresh = live && !watched && isNewReport(was.report, report)
  return { error: null, loading: false, report, unread: report !== null && (was.unread || fresh) }
}

/** Arriving at a workspace, its panel opens on the report: one that waits on the user (a
 * question, or blocked) and arrived while nobody was looking. Seen, it no longer does. */
export const opensOnArrival = (entry: ReportEntry | undefined) =>
  entry?.unread === true &&
  (entry.report?.state === 'question' || entry.report?.state === 'blocked')

export function useReports(workspaceId: string | undefined) {
  const [entries, setEntries] = useState<Record<string, ReportEntry>>({})
  // The newest read per workspace: an older one answering late is dropped.
  const reads = useRef(new Map<string, number>())
  // The workspace whose Report tab is on screen right now, if any: set by `watch` each render
  // (state for the cue below, a ref for reads answering later).
  const [seen, setSeen] = useState<string | null>(null)
  const watched = useRef<string | null>(null)

  const read = useCallback((wsId: string, live: boolean) => {
    const n = (reads.current.get(wsId) ?? 0) + 1
    reads.current.set(wsId, n)
    setEntries((s) => ({ ...s, [wsId]: { ...(s[wsId] ?? FIRST), loading: true } }))
    invoke<Report | null>('report_get', { workspace: wsId }).then(
      (report) => {
        if (reads.current.get(wsId) !== n) return
        const watching = watched.current === wsId
        setEntries((s) => ({ ...s, [wsId]: settle(s[wsId] ?? FIRST, report, live, watching) }))
      },
      (error: unknown) => {
        if (reads.current.get(wsId) !== n) return
        setEntries((s) => ({
          ...s,
          [wsId]: {
            ...(s[wsId] ?? FIRST),
            error: error instanceof Error ? error.message : String(error),
            loading: false,
          },
        }))
      }
    )
  }, [])

  // On screen: read again (it may have changed while away, or while the window was closed).
  useEffect(() => {
    if (workspaceId !== undefined) read(workspaceId, false)
  }, [workspaceId, read])

  // The Report tab on screen: its cue goes.
  const unseen = seen !== null && entries[seen]?.unread === true
  useEffect(() => {
    if (seen === null || !unseen) return
    setEntries((s) => (s[seen] === undefined ? s : { ...s, [seen]: { ...s[seen], unread: false } }))
  }, [seen, unseen])

  const entry = workspaceId === undefined ? undefined : entries[workspaceId]
  return {
    /** A chat of a workspace just wrote a report. */
    arrived: useCallback(
      (chat: { record: { workspaceId: string } }, live: boolean) =>
        read(chat.record.workspaceId, live),
      [read]
    ),
    /** The workspace on screen should open on its Report tab when it comes on screen. */
    asks: opensOnArrival(entry),
    entry,
    /** Whether the workspace on screen has a Report tab (a report, or a read that failed). */
    has: entry !== undefined && (entry.report !== null || entry.error !== null),
    retry: () => {
      if (workspaceId !== undefined) read(workspaceId, false)
    },
    /** Whether the workspace on screen shows its Report tab right now. */
    watch: (on: boolean) => {
      watched.current = on && workspaceId !== undefined ? workspaceId : null
      // Same component, so React allows it mid-render: it renders again before committing.
      if (watched.current !== seen) setSeen(watched.current)
    },
  }
}
