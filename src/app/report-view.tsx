// A task's page, drawn natively: the right panel's Report tab and Desk's main area. Reading
// order: the head (title, where it stands, project · colour · ticket), the summary (or why it
// is blocked), the question it waits on, then the six sections in their fixed order, each
// with its label; an empty one is a faint line, and the empty ones that close the page fold
// into one. A section that changes while the page is open rises in place and washes once.
import { openUrl } from '@tauri-apps/plugin-opener'
import { CircleAlertIcon, MessageSquareIcon } from 'lucide-react'
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { PullRequest } from '../git/pr'
import type { ReportEntry } from './use-reports'

import { type ReportAsk, reportAsk } from '../chat/reports'
import { type Signal, strongest } from '../model/catalog'
import {
  clampText,
  isOutdated,
  isWebUrl,
  linksOf,
  type Report,
  REPORT_LIMITS,
  REPORT_STATE,
  reportAge,
  type ReportLink,
  type ReportProgress,
  type ReportState,
  ticketLink,
} from '../model/report'
import { Blocks, type Zoom, ZoomedShot } from '../report/blocks'
import { type BlockActions, Mark } from '../report/blocks/primitives'
import { pageOf, type PageSection, trailingEmpty } from '../report/from-report'
import { ProjectAvatar, useNow } from './sidebar'
import { Dot, type Tone } from './status-dot'
import { chatSignal, type ChatTab } from './use-chats'

const WORD_INK = {
  blocked: 'text-critical-ink',
  done: 'text-good-ink',
  question: 'text-warn-ink',
  ready: 'text-good-ink',
  review: 'text-warn-ink',
  working: 'text-foreground',
} as const satisfies Record<ReportState, string>

/** The chat's own signal, said when the page's state no longer holds. */
const LIVE = {
  done: { ink: 'text-good-ink', tone: 'done', word: 'Finished' },
  waiting: { ink: 'text-warn-ink', tone: 'waiting', word: 'Waiting for you' },
  working: { ink: 'text-foreground', tone: 'working', word: 'Working' },
} as const satisfies Record<Signal, { ink: string; tone: Tone; word: string }>

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export type { Zoom } from '../report/blocks'

/**
 * The state's dot, as the sidebar draws waiting and done (the loader while working); screens
 * to review are a ring (they want a look, not an answer).
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

/**
 * What the page's state line says: its state, unless the chat went on past it (a stop-state
 * long behind its chat, or "working" while its chat is not), then the chat's live signal.
 * `signal` undefined: not known here, the page's state stands.
 */
export function pageSays(
  report: Pick<Report, 'at' | 'state'>,
  o: { outdated: boolean; signal: Signal | null | undefined }
): { live: boolean; working: boolean } {
  const idle = report.state === 'working' && o.signal !== undefined && o.signal !== 'working'
  const live = o.outdated || idle
  return { live, working: live ? o.signal === 'working' : report.state === 'working' }
}

/** The state line: the page's mark, word and step; "Merged" once the PR is; else the chat's. */
function StateLine({
  merged,
  outdated,
  report,
  signal,
}: {
  report: Report
  merged: boolean
  outdated: boolean
  signal: Signal | null | undefined
}) {
  const now = useNow()
  const age = (
    <span className="text-faint flex-none" title={new Date(report.at).toLocaleString()}>
      · {reportAge(report.at, Math.max(now, Date.now()))}
    </span>
  )
  let mark: ReactNode = null
  let word: string
  let ink: string
  let step = ''
  let title: string | undefined
  if (merged) {
    mark = <Dot tone="done" />
    word = 'Merged'
    ink = 'text-good-ink'
  } else if (pageSays(report, { outdated, signal }).live) {
    const live = signal == null ? null : LIVE[signal]
    mark = live === null ? null : <Dot tone={live.tone} />
    word = live?.word ?? 'Idle'
    ink = live?.ink ?? 'text-muted-foreground'
    title = `The page said “${REPORT_STATE[report.state].word}”; its chat has moved on since`
  } else {
    mark = <ReportDot state={report.state} />
    word = REPORT_STATE[report.state].word
    ink = WORD_INK[report.state]
    step = clampText(report.step?.trim() ?? '', REPORT_LIMITS.step)
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={title}>
      <span
        key={word}
        className="animate-in fade-in grid size-3 flex-none place-items-center duration-160 ease-out"
      >
        {mark}
      </span>
      <span
        key={`w-${word}`}
        className={cn('animate-in fade-in flex-none font-medium duration-160 ease-out', ink)}
      >
        {word}
      </span>
      {step !== '' && (
        <span
          key={`s-${step}`}
          className="text-muted-foreground animate-in fade-in min-w-0 truncate duration-160 ease-out"
        >
          · {step}
        </span>
      )}
      {age}
    </span>
  )
}

/** The page's ticket, in mono: a link when the page links it. */
export function TicketRef({ links, ticket }: { ticket: string; links: readonly ReportLink[] }) {
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

/** The quiet line under a page's title: its project, its colour word, its ticket. */
export function PageMeta({
  colour,
  links,
  project,
  ticket,
}: {
  project?: string
  colour?: string
  ticket?: string
  links: readonly ReportLink[]
}) {
  const parts: ReactNode[] = []
  if (project !== undefined && project !== '')
    parts.push(
      <span key="p" className="flex min-w-0 items-center gap-1.5">
        <ProjectAvatar name={project} size="sm" />
        <span className="text-muted-foreground min-w-0 truncate">{project}</span>
      </span>
    )
  if (colour !== undefined && colour !== '')
    parts.push(
      <span key="c" className="flex-none">
        {colour}
      </span>
    )
  const id = ticket?.trim() ?? ''
  if (id !== '') parts.push(<TicketRef key="t" ticket={id} links={links} />)
  return (
    <>
      {parts.map((part, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1.5">
          {i > 0 && <span aria-hidden>·</span>}
          {part}
        </span>
      ))}
    </>
  )
}

/**
 * A page's head, the same on every surface: the title with where it stands at its right
 * (above it when narrow), then the quiet meta line with Open chat at its end.
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
      <div className="flex flex-col-reverse gap-1 @min-[560px]/report:flex-row @min-[560px]/report:items-start @min-[560px]/report:gap-6">
        <h2 className="text-foreground text-title min-w-0 flex-1 font-semibold text-balance break-words select-text">
          {clampText(title, REPORT_LIMITS.title)}
        </h2>
        <div className="flex h-5 max-w-full min-w-0 flex-none items-center text-xs @min-[560px]/report:h-[26px] @min-[560px]/report:max-w-[45%]">
          {stateLine}
        </div>
      </div>
      <div className="text-faint mt-1 flex h-7 min-w-0 items-center gap-2 text-xs">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">{meta}</div>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground -mr-2 flex-none text-xs"
          disabled={onOpenChat === null}
          title={onOpenChat === null ? 'Its chat is closed' : (openTip ?? 'Go to its chat')}
          onClick={onOpenChat ?? undefined}
        >
          <MessageSquareIcon />
          Open chat
        </Button>
      </div>
    </header>
  )
}

const STATUS_WORD = {
  current: 'now',
  done: 'done',
  failed: 'failed',
  skipped: 'skipped',
  todo: 'to do',
} as const

/** A step's mark: the checks' marks, the loader for the one at work, a ring for what is left. */
function StepMark({ status, working }: { status: ReportProgress['status']; working: boolean }) {
  if (status === 'done') return <Mark tone="good" />
  if (status === 'failed') return <Mark tone="bad" />
  if (status === 'skipped') return <Mark tone="muted" />
  return (
    <span aria-hidden className="grid size-4 flex-none place-items-center">
      {status === 'todo' && (
        <span className="border-line-strong size-2.5 rounded-full border-[1.5px]" />
      )}
      {status === 'current' &&
        (working ? (
          <Dot tone="working" />
        ) : (
          <span className="bg-foreground size-[7px] rounded-full" />
        ))}
    </span>
  )
}

/** The agent's steps, on one line that wraps: done, the one at work, what is left. */
function ProgressLine({ items, working }: { items: readonly ReportProgress[]; working: boolean }) {
  return (
    <ol className="flex flex-wrap gap-x-4 gap-y-2 text-sm leading-5">
      {items.map((p, i) => (
        <li
          // oxlint-disable-next-line no-array-index-key -- the agent's steps, in order
          key={i}
          className="block-in flex min-w-0 items-center gap-1.5"
          style={{ '--i': i } as CSSProperties}
        >
          <StepMark status={p.status} working={working} />
          <span
            className={cn(
              'min-w-0 break-words select-text',
              p.status === 'current' && 'text-foreground font-medium',
              p.status === 'done' && 'text-ink-soft',
              p.status === 'failed' && 'text-critical-ink',
              p.status === 'todo' && 'text-muted-foreground',
              p.status === 'skipped' && 'text-faint decoration-faint/50 line-through'
            )}
          >
            {p.text}
            <span className="sr-only"> ({STATUS_WORD[p.status]})</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

/** The page's grid: the label at the left when there is room, above the content when not. */
const ROW =
  'relative grid grid-cols-[minmax(0,1fr)] gap-y-2 border-t border-border py-5 @min-[560px]/report:grid-cols-[132px_minmax(0,1fr)] @min-[560px]/report:gap-x-6'

/** One section: its label (and when it was set), then its content or a faint line. */
function Section({
  actions,
  index,
  section,
  working,
}: {
  section: PageSection
  actions: BlockActions
  index: number
  working: boolean
}) {
  const now = useNow()
  // Set again while on screen: it rises in place, and a wash says where.
  const [seenAt, setSeenAt] = useState(section.at)
  const [washes, setWashes] = useState(0)
  if (section.at !== seenAt) {
    setSeenAt(section.at)
    if (section.at !== undefined) setWashes((n) => n + 1)
  }
  return (
    <section
      data-section={section.name}
      aria-label={section.label}
      className={cn(ROW, 'block-in')}
      style={{ '--i': index } as CSSProperties}
    >
      {washes > 0 && (
        <span
          key={washes}
          aria-hidden
          className="bg-hover pointer-events-none absolute inset-x-[-12px] inset-y-1.5 rounded-lg opacity-0 motion-safe:animate-[tint_1.6s_cubic-bezier(0.2,0,0,1)]"
        />
      )}
      <h3 className="relative flex min-w-0 flex-wrap items-baseline gap-x-1.5 @min-[560px]/report:flex-col @min-[560px]/report:gap-0.5">
        <span
          className={cn(
            'text-sm leading-5 font-medium',
            section.empty ? 'text-muted-foreground' : 'text-foreground'
          )}
        >
          {section.label}
        </span>
        {section.at !== undefined && !section.empty && (
          <span className="text-faint text-xs" title={new Date(section.at).toLocaleString()}>
            {reportAge(section.at, Math.max(now, Date.now()))}
          </span>
        )}
      </h3>
      <div key={section.at ?? 'none'} className="relative min-w-0">
        {section.empty && <p className="text-label text-sm leading-5">Not yet</p>}
        {!section.empty && section.name === 'progress' && (
          <ProgressLine items={section.progress} working={working} />
        )}
        {!section.empty && section.name !== 'progress' && (
          <Blocks
            blocks={section.blocks}
            cards={section.cards}
            actions={actions}
            className="gap-5 @min-[520px]/report:gap-6"
          />
        )}
      </div>
    </section>
  )
}

/** The sections, in order; the empty ones that close the page as one faint line. */
function Sections({
  actions,
  sections,
  start,
  working,
}: {
  sections: readonly PageSection[]
  actions: BlockActions
  start: number
  working: boolean
}) {
  const folded = trailingEmpty(sections)
  const shown = sections.slice(0, sections.length - folded)
  const rest = sections.slice(sections.length - folded)
  return (
    <div className="flex flex-col">
      {shown.map((s, i) => (
        <Section key={s.name} section={s} actions={actions} index={start + i} working={working} />
      ))}
      {rest.length > 0 && (
        <div
          key={rest.map((s) => s.name).join()}
          className={cn(ROW, 'block-in')}
          style={{ '--i': start + shown.length } as CSSProperties}
        >
          <span className="text-muted-foreground text-sm leading-5 font-medium">Still to come</span>
          <p className="text-label text-sm leading-5">{rest.map((s) => s.label).join(' · ')}</p>
        </div>
      )}
    </div>
  )
}

/**
 * The page itself, for any surface that has room for it: the right panel's tab, the Desk.
 * `onZoom` asks the surface to show a screen larger (see `ZoomedShot`).
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
  signal,
  stateLine = null,
  working: workingOverride,
}: {
  report: Report
  /** The workspace's chats' last activity: a stop-state older than it is outdated. */
  chatActiveAt?: number
  /** Its chats' live signal, said when the page's state no longer holds (undefined: unknown). */
  signal?: Signal | null
  /** Where the question stands in the page's chat (see `reportAsk`). */
  ask?: ReportAsk
  /** The workspace's folder: where its PR cards read and merge. */
  cwd?: string
  /** The workspace's PR is merged: the page's state is history. */
  merged?: boolean
  /** Goes to the page's chat; null when it is not open. */
  onOpenChat?: (() => void) | null
  onZoom: (zoom: Zoom, from: HTMLButtonElement) => void
  /** The line under the title (project · colour · ticket). */
  meta?: ReactNode
  /** False where the surface asks the question itself (Desk's answer card): written once. */
  showAsk?: boolean
  /** In place of the page's own state line. */
  stateLine?: ReactNode
  /** In place of the whole head (Desk's, which says where the workspace stands). */
  head?: ReactNode
  /** Whether the agent is at work right now, where the surface knows better (Desk's row). */
  working?: boolean
}) {
  const outdated = !merged && isOutdated(report, chatActiveAt)
  const says = pageSays(report, { outdated, signal })
  const working = workingOverride ?? (!merged && says.working)
  const page = pageOf(report, { ask, merged, question: showAsk })
  const top = [...page.lead, ...page.asks]
  const actions = { cwd, onZoom }
  return (
    <article className="@container/report flex flex-col gap-5" aria-label="Task">
      {head ?? (
        <ReportHead
          title={report.title}
          stateLine={
            stateLine ?? (
              <StateLine report={report} merged={merged} outdated={outdated} signal={signal} />
            )
          }
          openTip="Go to the chat that keeps this page"
          onOpenChat={onOpenChat}
          meta={meta ?? <PageMeta ticket={report.ticket} links={linksOf(report)} />}
        />
      )}
      {top.length > 0 && <Blocks blocks={top} start={1} actions={actions} />}
      <Sections
        sections={page.sections}
        actions={actions}
        start={1 + top.length}
        working={working}
      />
    </article>
  )
}

/**
 * Keeps what the reader looks at still while a section above it changes: WKWebView has no
 * scroll anchoring, so the first section in view is held where it was.
 */
function useSectionAnchor(scroller: RefObject<HTMLDivElement | null>, at: number | undefined) {
  const anchor = useRef<{ name: string; top: number } | null>(null)
  const measure = () => {
    const el = scroller.current
    if (!el) return
    const top = el.getBoundingClientRect().top
    for (const s of el.querySelectorAll<HTMLElement>('[data-section]')) {
      const box = s.getBoundingClientRect()
      if (box.bottom > top + 1) {
        anchor.current = { name: s.dataset.section ?? '', top: box.top - top }
        return
      }
    }
    anchor.current = null
  }
  useLayoutEffect(() => {
    const el = scroller.current
    const was = anchor.current
    if (el && was && el.scrollTop > 0) {
      const s = el.querySelector<HTMLElement>(`[data-section="${was.name}"]`)
      if (s) {
        const moved = s.getBoundingClientRect().top - el.getBoundingClientRect().top - was.top
        if (Math.abs(moved) > 0.5) el.scrollTop += moved
      }
    }
    measure()
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- after each new version of the page
  }, [at])
  return measure
}

/** The element a zoomed screen covers: the app's main area, else the panel itself. */
function useZoomHost(fallback: RefObject<HTMLElement | null>) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setHost(document.querySelector<HTMLElement>('[data-zoom-host]') ?? fallback.current)
  }, [fallback])
  return host
}

/** The Report tab's body: the page, its loading and its failure, and a screen zoomed. */
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
  signal,
  stateLine,
  tail,
  working,
}: {
  entry: ReportEntry | undefined
  chatActiveAt?: number
  signal?: Signal | null
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
  working?: boolean
  /** After the page, in its column and scrolling with it: Desk's question card. */
  tail?: ReactNode
  scrollRef?: RefObject<HTMLDivElement | null>
}) {
  const [zoom, setZoom] = useState<Zoom | null>(null)
  const from = useRef<HTMLButtonElement | null>(null)
  const pane = useRef<HTMLDivElement>(null)
  const ownScroller = useRef<HTMLDivElement>(null)
  const scroller = scrollRef ?? ownScroller
  const host = useZoomHost(pane)
  const report = entry?.report ?? null
  // A new version of the page may drop the screen zoomed: the zoom closes.
  const at = report?.at
  useEffect(() => setZoom(null), [at])
  const remember = useSectionAnchor(scroller, at)
  const close = () => {
    setZoom(null)
    // Back on the screen that opened it.
    requestAnimationFrame(() => from.current?.focus({ preventScroll: true }))
  }

  let body: ReactNode = null
  if (report !== null) {
    body = (
      <div key={report.workspaceId}>
        {entry?.error != null && (
          <div className="bg-critical-wash text-critical-ink mb-4 flex items-center gap-2 rounded-md py-1.5 pr-1.5 pl-2.5 text-xs">
            <span className="min-w-0 flex-1">
              Couldn&rsquo;t read the page again: {entry.error}
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
          signal={signal}
          working={working}
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
        <span className="text-muted-foreground font-medium">Couldn&rsquo;t read the page</span>
        <span className="max-w-[260px] text-xs break-words">{entry.error}</span>
        <Button variant="secondary" size="sm" className="mt-2" onClick={onRetry}>
          Try again
        </Button>
      </div>
    )
  } else {
    body = (
      <div className="grid place-items-center pt-24" aria-label="Reading the page">
        <Dot tone="working" />
      </div>
    )
  }

  return (
    <div ref={pane} className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        onScroll={remember}
        className={cn('h-full [overflow-anchor:none] overflow-x-hidden overflow-y-auto', className)}
      >
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
  /** The workspace's open chats: the page's own tells where its question stands. */
  chats: readonly ChatTab[],
  pr: Pick<PullRequest, 'state'> | null,
  /** Puts a chat's tab on screen. */
  open: (chatId: string) => void,
  /** The workspace's project and colour word, for the page's meta line. */
  where: { project?: string; colour?: string } = {}
) {
  const { entry } = reports
  if (!reports.has || entry === undefined) return null
  const report = entry.report
  const chat = report === null ? undefined : chats.find((c) => c.record.id === report.chatId)
  const ask = reportAsk(chat?.state)
  // The workspace's chats' last activity: a stop-state older than it is history.
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
        signal={strongest(chats.map(chatSignal))}
        meta={
          report === null ? undefined : (
            <PageMeta
              project={where.project}
              colour={where.colour}
              ticket={report.ticket}
              links={linksOf(report)}
            />
          )
        }
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
