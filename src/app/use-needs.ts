// The sidebar's "who needs me": each row's page stop, whether it asks something unseen, how
// many do, and ⌘0's next one. Opening a workspace is seeing what it asks.
import { type Dispatch, type SetStateAction, useEffect, useState } from 'react'

import type { Catalog, Signal, Workspace } from '../model/catalog'
import type { ChatTab } from './use-chats'
import type { Reports } from './use-reports'

import {
  isUnread,
  loadNeedsSeen,
  movedOn,
  needKey,
  type NeedsSeen,
  nextNeed,
  pageStop,
  saveNeedsSeen,
  type Stop,
} from './needs'
import { storage } from './report-seen'

/** What the user has seen of each row, kept across launches. */
export function useNeedsSeen() {
  const [seen, setSeen] = useState<NeedsSeen>(() => loadNeedsSeen(storage()))
  useEffect(() => saveNeedsSeen(seen, storage()), [seen])
  return [seen, setSeen] as const
}

/** Each row's stop and whether it asks; drawn each render from what the app knows. */
export function needsOf(o: {
  seen: NeedsSeen
  /** Called while rendering, as the workspace on screen asks something new: seen at once. */
  setSeen: Dispatch<SetStateAction<NeedsSeen>>
  catalog: Catalog
  chats: readonly ChatTab[]
  reports: Pick<Reports, 'reportOf'>
  /** Each row's own signal (a parent never speaks for its sub-workspaces). */
  signals: Record<string, Signal | null>
  mergedOf: (path: string) => boolean
  /** The rows, in sidebar order. */
  order: readonly Workspace[]
  /** The workspace on screen: what it asks is seen. */
  here: string | null
}) {
  const { seen, setSeen } = o

  const stops: Record<string, Stop | null> = {}
  const keys: Record<string, string | null> = {}
  for (const ws of o.order) {
    const own = o.chats.filter((c) => c.record.workspaceId === ws.id)
    const report = o.reports.reportOf(ws.id)
    const writer = own.find((c) => c.record.id === report?.chatId)
    // A chat opened or resumed is not activity: only turns move a page out of date.
    const activeAt = Math.max(
      ws.createdAt,
      ...o.catalog.chats.filter((r) => r.workspaceId === ws.id).map((r) => r.activeAt ?? 0),
      ...own.map((c) => c.record.activeAt ?? 0)
    )
    const stop = pageStop(report, {
      activeAt,
      answered: writer !== undefined && movedOn(writer.state),
      merged: o.mergedOf(ws.path),
    })
    stops[ws.id] = stop
    keys[ws.id] = needKey({
      activeAt,
      parked: ws.paused === true,
      reportAt: report?.at ?? 0,
      signal: o.signals[ws.id] ?? null,
      stop,
      waiting: own.flatMap((c) => c.state.pending)[0]?.requestId ?? null,
    })
  }

  // On screen, what it asks is seen as soon as it asks (set while rendering: no flash).
  const hereKey = o.here === null ? null : (keys[o.here] ?? null)
  if (o.here !== null && hereKey !== null && seen[o.here] !== hereKey)
    setSeen((s) => ({ ...s, [o.here as string]: hereKey }))

  const unread = (id: string) => id !== o.here && isUnread(keys[id] ?? null, seen, id)
  const ids = o.order.map((w) => w.id)
  const count = ids.filter(unread).length
  return {
    count,
    /** ⌘0's target: the next unseen one after the one on screen, wrapping. */
    next: () => nextNeed(ids, o.here, unread),
    stops,
    unread: Object.fromEntries(ids.map((id) => [id, unread(id)])),
  }
}
