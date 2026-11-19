// An agent's report, drawn natively: the right panel's Report tab, and later the Desk's detail.
// Reading order: state, title and summary; what is asked of the user (its own card); feature
// and problem, quiet and clamped; the product choices made; what is left; the screens; links.
import { openUrl } from '@tauri-apps/plugin-opener'
import { CircleAlertIcon, MessageSquareIcon } from 'lucide-react'
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { PullRequest } from '../git/pr'
import type { ChatTab } from './use-chats'
import type { ReportEntry } from './use-reports'

import { type ReportAsk, reportAsk } from '../chat/reports'
import {
  clampText,
  isStale,
  isWebUrl,
  type Report,
  REPORT_LIMITS,
  REPORT_STATE,
  reportAge,
  type ReportState,
  ticketLink,
} from '../model/report'
import { Blocks, type Zoom, ZoomedShot } from '../report/blocks'
import { blocksOf } from '../report/from-report'
import { useNow } from './sidebar'
import { Dot } from './status-dot'

const WORD_INK = {
  blocked: 'text-critical-ink',
  done: 'text-good-ink',
  question: 'text-warn-ink',
  ready: 'text-good-ink',
  review: 'text-warn-ink',
} as const satisfies Record<ReportState, string>

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export type { Zoom } from '../report/blocks'

/**
 * The state's dot, as the sidebar draws waiting and done; screens to review are a ring (they
 * want a look, not an answer).
 */
export function ReportDot({ label, state }: { state: ReportState; label?: string }) {
  if (state === 'review') {
    return (
      <span
        role={label === undefined ? undefined : 'img'}
        aria-label={label}
        className="ring-warn size-[7px] flex-none rounded-full ring-[1.5px] ring-inset"
      />
    )
  }
  return <Dot tone={REPORT_STATE[state].tone} label={label} />
}

/** The state line: the report's word, or "Merged" once the PR is, or "Earlier:" when stale. */
function StateLine({ merged, report, stale }: { report: Report; merged: boolean; stale: boolean }) {
  const now = useNow()
  const { word } = REPORT_STATE[report.state]
  const age = (
    <span className="text-faint flex-none" title={new Date(report.at).toLocaleString()}>
      · {reportAge(report.at, Math.max(now, Date.now()))}
    </span>
  )
  if (merged) {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="grid size-3 flex-none place-items-center">
          <Dot tone="done" />
        </span>
        <span className="text-good-ink flex-none font-medium">Merged</span>
        {age}
      </span>
    )
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span
        className={cn(
          'grid size-3 flex-none place-items-center transition-[filter,opacity] duration-160 ease-out',
          stale && 'opacity-50 grayscale'
        )}
      >
        <ReportDot state={report.state} />
      </span>
      {stale && <span className="text-faint flex-none">Earlier:</span>}
      <span
        className={cn(
          'flex-none font-medium transition-colors duration-160 ease-out',
          stale ? 'text-faint' : WORD_INK[report.state]
        )}
        title={stale ? 'The chat has moved on since this report' : undefined}
      >
        {word}
      </span>
      {age}
    </span>
  )
}

/** The report's ticket, in mono: a link when the report links it. */
export function TicketRef({ links, ticket }: { ticket: string; links: Report['links'] }) {
  const link = ticketLink(ticket, links)
  if (link === undefined) {
    return (
      <span className="min-w-0 truncate font-mono" title={ticket}>
        {ticket}
      </span>
    )
  }
  return (
    <button
      type="button"
      className="hover:text-foreground focus-visible:text-foreground decoration-line-strong min-w-0 truncate font-mono underline underline-offset-2 transition-colors duration-120 ease-out"
      title={`${link.label}\n${link.url}`}
      onClick={() => {
        if (isWebUrl(link.url)) void openUrl(link.url)
      }}
    >
      {ticket}
    </button>
  )
}

/**
 * A report's head, the same on every surface: its state line with Open chat at the right, the
 * title, and a meta line under it.
 */
export function ReportHead({
  meta,
  onOpenChat,
  openTip,
  stateLine,
  title,
}: {
  title: string
  stateLine: ReactNode
  meta: ReactNode
  /** Goes to the chat; null when it is not open. */
  onOpenChat: (() => void) | null
  /** Open chat's tooltip while it can open. */
  openTip?: string
}) {
  return (
    <header className="block-in" style={{ '--i': 0 } as CSSProperties}>
      <div className="flex h-7 items-center gap-2 text-xs">
        {stateLine}
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground -mr-2 text-xs"
          disabled={onOpenChat === null}
          title={onOpenChat === null ? 'Its chat is closed' : (openTip ?? 'Go to its chat')}
          onClick={onOpenChat ?? undefined}
        >
          <MessageSquareIcon />
          Open chat
        </Button>
      </div>
      <h2 className="text-foreground text-title mt-1 font-semibold text-balance break-words select-text">
        {clampText(title, REPORT_LIMITS.title)}
      </h2>
      {meta}
    </header>
  )
}

function Head({
  merged,
  meta,
  onOpenChat,
  report,
  stale,
  stateLine,
}: {
  report: Report
  merged: boolean
  stale: boolean
  onOpenChat: (() => void) | null
  meta: ReactNode
  stateLine: ReactNode
}) {
  const ticket = report.ticket ?? ''
  return (
    <ReportHead
      title={report.title}
      stateLine={stateLine ?? <StateLine report={report} merged={merged} stale={stale} />}
      openTip="Go to the chat that wrote this report"
      onOpenChat={onOpenChat}
      meta={
        meta ??
        (ticket === '' ? null : (
          <div className="text-faint mt-1 flex min-w-0 text-xs">
            <TicketRef ticket={ticket} links={report.links} />
          </div>
        ))
      }
    />
  )
}

/**
 * The report itself, for any surface that has room for it: the right panel's tab, the Desk.
 * A head, then the report's blocks (src/report/blocks). `onZoom` asks the surface to show a
 * screen larger (see `ZoomedShot`).
 */
export function ReportBody({
  ask = { kind: 'unknown' },
  chatActiveAt,
  cwd,
  head,
  merged = false,
  meta = null,
  onOpenChat = null,
  onZoom,
  report,
  showAsk = true,
  stateLine = null,
}: {
  report: Report
  /** The workspace's chats' last activity: a report older than it says so. */
  chatActiveAt?: number
  /** Where the question stands in the report's chat (see `reportAsk`). */
  ask?: ReportAsk
  /** The workspace's folder: where its PR cards read and merge. */
  cwd?: string
  /** The workspace's PR is merged: the report's state is history. */
  merged?: boolean
  /** Goes to the report's chat; null when it is not open. */
  onOpenChat?: (() => void) | null
  onZoom: (zoom: Zoom, from: HTMLButtonElement) => void
  /** A line under the title (the panel: none; the ticket shows). */
  meta?: ReactNode
  /** False where the surface asks the question itself (Desk's answer card): written once. */
  showAsk?: boolean
  /** In place of the report's own state line. */
  stateLine?: ReactNode
  /** In place of the whole head (Desk's, which says where the workspace stands). */
  head?: ReactNode
}) {
  const stale = !merged && isStale(report.at, chatActiveAt)
  const blocks = blocksOf(report, { ask, merged, question: showAsk })
  return (
    <article className="@container/report flex flex-col gap-5" aria-label="Report">
      {head ?? (
        <Head
          report={report}
          merged={merged}
          meta={meta}
          stale={stale}
          stateLine={stateLine}
          onOpenChat={onOpenChat}
        />
      )}
      <Blocks blocks={blocks} start={1} actions={{ cwd, onZoom }} />
    </article>
  )
}

/** The element a zoomed screen covers: the app's main area, else the panel itself. */
function useZoomHost(fallback: RefObject<HTMLElement | null>) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setHost(document.querySelector<HTMLElement>('[data-zoom-host]') ?? fallback.current)
  }, [fallback])
  return host
}

/** The Report tab's body: the report, its loading and its failure, and a screen zoomed. */
export function ReportPane({
  ask,
  chatActiveAt,
  className = 'px-5 pt-1 pb-6',
  cwd,
  entry,
  head,
  merged,
  meta,
  onOpenChat,
  onRetry,
  scrollRef,
  showAsk,
  stateLine,
  tail,
}: {
  entry: ReportEntry | undefined
  chatActiveAt?: number
  cwd?: string
  ask?: ReportAsk
  merged?: boolean
  onOpenChat?: (() => void) | null
  onRetry: () => void
  /** The scroller's padding. */
  className?: string
  meta?: ReactNode
  showAsk?: boolean
  stateLine?: ReactNode
  head?: ReactNode
  /** After the report, in its column and scrolling with it: Desk's question card. */
  tail?: ReactNode
  scrollRef?: RefObject<HTMLDivElement | null>
}) {
  const [zoom, setZoom] = useState<Zoom | null>(null)
  const from = useRef<HTMLButtonElement | null>(null)
  const pane = useRef<HTMLDivElement>(null)
  const host = useZoomHost(pane)
  const report = entry?.report ?? null
  // A new report replaces the screens: a zoom on the old one closes.
  const at = report?.at
  useEffect(() => setZoom(null), [at])
  const close = () => {
    setZoom(null)
    // Back on the screen that opened it.
    requestAnimationFrame(() => from.current?.focus({ preventScroll: true }))
  }

  let body: ReactNode = null
  if (report !== null) {
    body = (
      <div key={report.at}>
        {entry?.error != null && (
          <div className="bg-critical-wash text-critical-ink mb-4 flex items-center gap-2 rounded-md py-1.5 pr-1.5 pl-2.5 text-xs">
            <span className="min-w-0 flex-1">
              Couldn&rsquo;t read the latest report: {entry.error}
            </span>
            <Button variant="ghost" size="xs" onClick={onRetry}>
              Retry
            </Button>
          </div>
        )}
        <ReportBody
          report={report}
          chatActiveAt={chatActiveAt}
          cwd={cwd}
          ask={ask}
          merged={merged}
          meta={meta}
          showAsk={showAsk}
          head={head}
          stateLine={stateLine}
          onOpenChat={onOpenChat}
          onZoom={(z, button) => {
            from.current = button
            setZoom(z)
          }}
        />
      </div>
    )
  } else if (entry?.error != null) {
    body = (
      <div className="text-faint animate-in fade-in flex flex-col items-center gap-2 px-3 pt-24 text-center duration-160">
        <CircleAlertIcon className="text-label size-5" strokeWidth={1.5} />
        <span className="text-muted-foreground font-medium">Couldn&rsquo;t read the report</span>
        <span className="max-w-[260px] text-xs break-words">{entry.error}</span>
        <Button variant="secondary" size="sm" className="mt-2" onClick={onRetry}>
          Try again
        </Button>
      </div>
    )
  } else {
    body = (
      <div className="grid place-items-center pt-24" aria-label="Reading the report">
        <Dot tone="working" />
      </div>
    )
  }

  return (
    <div ref={pane} className="relative min-h-0 flex-1">
      <div ref={scrollRef} className={cn('h-full overflow-x-hidden overflow-y-auto', className)}>
        {body}
        {tail}
      </div>
      {zoom !== null && report !== null && host !== null && (
        <ZoomedShot host={host} zoom={zoom} onZoom={setZoom} onClose={close} />
      )}
    </div>
  )
}

/** The git panel's Report tab for the workspace on screen, or null while it has none. */
export function reportTab(
  reports: { entry: ReportEntry | undefined; has: boolean; retry: () => void },
  /** The workspace's open chats: the report's own tells where its question stands. */
  chats: readonly ChatTab[],
  pr: Pick<PullRequest, 'state'> | null,
  /** Puts a chat's tab on screen. */
  open: (chatId: string) => void
) {
  const { entry } = reports
  if (!reports.has || entry === undefined) return null
  const report = entry.report
  const chat = report === null ? undefined : chats.find((c) => c.record.id === report.chatId)
  const ask = reportAsk(chat?.state)
  // The workspace's chats' last activity: a report older than it is history.
  const active = chats.map((c) => Math.max(c.record.activeAt ?? 0, c.record.createdAt))
  const activeAt = active.length === 0 ? undefined : Math.max(...active)
  const onOpenChat =
    chat === undefined
      ? null
      : () => {
          open(chat.record.id)
          if (ask.kind !== 'pending') return
          // Once the chat is on screen: its question card, in view.
          requestAnimationFrame(() =>
            document
              .querySelector(`[data-request="${CSS.escape(ask.requestId)}"]`)
              ?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'nearest' })
          )
        }
  return {
    body: (
      <ReportPane
        entry={entry}
        chatActiveAt={activeAt}
        cwd={chats[0]?.cwd}
        ask={ask}
        merged={pr?.state === 'Merged'}
        onOpenChat={onOpenChat}
        onRetry={reports.retry}
      />
    ),
    state: entry.report?.state ?? null,
    unread: entry.unread,
  }
}
