// An agent's report, drawn natively: the right panel's Report tab, and later the Desk's detail.
// Reading order: state, title and summary; what is asked of the user (its own card); feature
// and problem, quiet and clamped; the product choices made; what is left; the screens; links.
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  ArrowUpRightIcon,
  CheckIcon,
  CircleAlertIcon,
  GitPullRequestIcon,
  LinkIcon,
  MessageSquareIcon,
  XIcon,
} from 'lucide-react'
import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { Question } from '../chat/model'
import type { PullRequest } from '../git/pr'
import type { ChatTab } from './use-chats'
import type { ReportEntry } from './use-reports'

import { type ReportAsk, reportAsk } from '../chat/reports'
import {
  clampText,
  isStale,
  isWebUrl,
  leftAfterMerge,
  madeChoices,
  openChoice,
  type Report,
  REPORT_LIMITS,
  REPORT_STATE,
  reportAge,
  type ReportChoice,
  type ReportScreen,
  type ReportState,
  ticketLink,
} from '../model/report'
import { splitRecommended } from './question-card'
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

function Label({ children, count }: { children: ReactNode; count?: ReactNode }) {
  return (
    <h3 className="text-label mb-1.5 flex items-baseline gap-1.5 text-xs font-medium">
      {children}
      {count !== undefined && <span className="text-faint font-normal tabular-nums">{count}</span>}
    </h3>
  )
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

function Head({
  merged,
  onOpenChat,
  report,
  stale,
}: {
  report: Report
  merged: boolean
  stale: boolean
  onOpenChat: (() => void) | null
}) {
  const ticket = report.ticket ?? ''
  const link = ticketLink(ticket, report.links)
  return (
    <header>
      <div className="flex h-7 items-center gap-2 text-xs">
        <StateLine report={report} merged={merged} stale={stale} />
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="xs"
          className="-mr-2 flex-none disabled:opacity-50"
          disabled={onOpenChat === null}
          title={
            onOpenChat === null
              ? 'The chat that wrote this report is closed'
              : 'Go to the chat that wrote this report'
          }
          onClick={onOpenChat ?? undefined}
        >
          <MessageSquareIcon strokeWidth={1.5} />
          Open chat
        </Button>
      </div>
      <h2 className="mt-1 text-base font-semibold text-pretty break-words select-text">
        {clampText(report.title, REPORT_LIMITS.title)}
      </h2>
      {ticket !== '' && (
        <div className="text-faint mt-0.5 flex min-w-0 text-xs">
          {link === undefined ? (
            <span className="min-w-0 truncate font-mono" title={ticket}>
              {ticket}
            </span>
          ) : (
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
          )}
        </div>
      )}
      {report.summary !== '' && (
        <p className="text-ink-soft mt-2 text-sm break-words whitespace-pre-line select-text">
          {clampText(report.summary, REPORT_LIMITS.summary)}
        </p>
      )}
    </header>
  )
}

/** Two lines, and "More" opens the rest in place (height eased, per the motion table). */
function Clamped({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [open, setOpen] = useState(false)
  const [overflows, setOverflows] = useState(false)
  // The height it had before opening, to ease from once the clamp is off.
  const from = useRef<number | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || open) return
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [open, text])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !open || from.current === null) return
    const start = from.current
    from.current = null
    if (reduced()) return
    el.animate([{ height: `${start}px` }, { height: `${el.offsetHeight}px` }], {
      duration: 180,
      easing: 'ease-in-out',
    })
  }, [open])

  const toggle = () => {
    const el = ref.current
    if (!el) return
    if (!open) {
      from.current = el.offsetHeight
      setOpen(true)
      return
    }
    // Closing: ease down with the text whole, then clamp it.
    const lines = Number.parseFloat(getComputedStyle(el).lineHeight) * 2
    if (reduced()) {
      setOpen(false)
      return
    }
    el.animate([{ height: `${el.offsetHeight}px` }, { height: `${lines}px` }], {
      duration: 180,
      easing: 'ease-in-out',
    }).onfinish = () => setOpen(false)
  }

  return (
    <>
      <p
        ref={ref}
        className={cn(
          'text-muted-foreground overflow-hidden text-sm break-words whitespace-pre-line select-text',
          !open && 'line-clamp-2'
        )}
      >
        {text}
      </p>
      {(overflows || open) && (
        <button
          type="button"
          className="text-faint hover:text-foreground focus-visible:text-foreground mt-0.5 text-xs transition-colors duration-120 ease-out"
          aria-expanded={open}
          onClick={toggle}
        >
          {open ? 'Less' : 'More'}
        </button>
      )}
    </>
  )
}

function Context({ feature, problem }: Pick<Report, 'feature' | 'problem'>) {
  const parts = (
    [
      ['Feature', feature],
      ['Problem', problem],
    ] as const
  ).flatMap(([label, text]) =>
    text === undefined || text.trim() === ''
      ? []
      : [[label, clampText(text, REPORT_LIMITS.context)] as const]
  )
  if (parts.length === 0) return null
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-3 @min-[480px]/report:grid-cols-2">
      {parts.map(([label, text]) => (
        <section key={label}>
          <Label>{label}</Label>
          <Clamped text={text} />
        </section>
      ))}
    </div>
  )
}

/** The question's status line: only what the chat really says. */
function AskStatus({ ask, picks }: { ask: ReportAsk; picks: string[] }) {
  if (ask.kind === 'pending') {
    return (
      <p className="text-warn-ink flex items-center gap-1.5 text-xs font-medium">
        <span className="grid size-3 flex-none place-items-center">
          <Dot tone="waiting" />
        </span>
        Waiting for your answer in the chat
      </p>
    )
  }
  if (ask.kind === 'answered') {
    return (
      <p className="text-muted-foreground flex min-w-0 items-baseline gap-1.5 text-xs">
        <CheckIcon className="text-faint size-3 flex-none translate-y-0.5" strokeWidth={2} />
        <span className="flex-none">Answered</span>
        {picks.length > 0 && (
          <span className="text-foreground min-w-0 font-medium break-words select-text">
            {picks.join(', ')}
          </span>
        )}
      </p>
    )
  }
  return <p className="text-faint text-xs">Asked in the chat</p>
}

/**
 * What the agent asks the user: the chat's live AskUserQuestion when there is one, else the
 * report's open choice. Options are numbered and weigh the same: nothing here is decided.
 */
function AskCard({ ask, choice }: { ask: ReportAsk; choice: ReportChoice | undefined }) {
  let questions: Question[] = []
  if (ask.kind !== 'unknown') questions = ask.questions
  else if (choice !== undefined) {
    const question = clampText(choice.text, REPORT_LIMITS.choice)
    questions = [{ header: '', multiSelect: false, options: [], question }]
  }
  if (questions.length === 0) return null
  const answers = ask.kind === 'answered' ? ask.answers : {}
  const picks = questions.flatMap((q) => {
    const a = answers[q.question]
    return a === undefined || a === '' ? [] : [a]
  })
  return (
    <section
      className="border-line-strong bg-background flex flex-col gap-3 rounded-lg border px-3 py-3"
      aria-label="Claude asks"
    >
      <span className="text-label -mb-2 text-xs font-medium">Claude asks</span>
      {questions.map((q, qi) => {
        const answer = answers[q.question] ?? ''
        const picked = new Set(answer.split(', '))
        return (
          // oxlint-disable-next-line no-array-index-key -- the chat's questions, in order
          <div key={qi} className="flex flex-col gap-1.5">
            <p className="text-sm font-semibold break-words select-text">{q.question}</p>
            {q.options.length > 0 && (
              <ol className="flex flex-col gap-1">
                {q.options.map((o, i) => {
                  const { recommended, text } = splitRecommended(o.label)
                  const on = picked.has(o.label)
                  return (
                    <li
                      key={o.label}
                      className={cn(
                        'flex items-start gap-2.5 rounded-md border px-2.5 py-1.5 transition-colors duration-160 ease-out',
                        on ? 'border-line-strong bg-active' : 'border-border'
                      )}
                    >
                      <span className="text-faint w-2.5 flex-none text-xs leading-[18px] tabular-nums">
                        {i + 1}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-ink-soft flex flex-wrap items-center gap-x-1.5 text-sm font-medium break-words select-text">
                          {text}
                          {recommended && (
                            <span className="bg-active text-label rounded-sm px-1.5 text-xs font-normal">
                              Recommended
                            </span>
                          )}
                        </span>
                        {o.description !== '' && (
                          <span className="text-label text-sm break-words select-text">
                            {o.description}
                          </span>
                        )}
                      </span>
                      {on && (
                        <CheckIcon
                          className="text-foreground mt-[3px] size-3.5 flex-none"
                          aria-label="Picked"
                        />
                      )}
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        )
      })}
      <AskStatus ask={ask} picks={picks} />
    </section>
  )
}

function Choice({ choice, n }: { choice: ReportChoice; n: number }) {
  return (
    <li className="grid grid-cols-[12px_minmax(0,1fr)] gap-x-2.5 px-3 py-2.5">
      <span className="text-faint text-xs leading-[18px] tabular-nums">{n}</span>
      <span className="text-foreground text-sm font-medium break-words select-text">
        {clampText(choice.text, REPORT_LIMITS.choice)}
      </span>
      {choice.setAside !== undefined && choice.setAside !== '' && (
        <span className="text-faint col-start-2 mt-0.5 text-sm break-words select-text">
          <span className="text-label">Set aside </span>
          <span className="text-muted-foreground">{choice.setAside}</span>
        </span>
      )}
    </li>
  )
}

function Choices({ choices }: { choices: readonly ReportChoice[] }) {
  const made = madeChoices(choices)
  if (made.length === 0) return null
  return (
    <section>
      <Label count={made.length}>Product choices</Label>
      <ol className="border-line-strong bg-background divide-border divide-y rounded-lg border">
        {made.map((choice, i) => (
          // oxlint-disable-next-line no-array-index-key -- two choices may say the same
          <Choice key={i} choice={choice} n={i + 1} />
        ))}
      </ol>
    </section>
  )
}

export interface Zoom {
  step: number
  side: 'before' | 'after'
}

const PAIR = '@min-[360px]/report:grid-cols-2'

function Shot({
  missing,
  onOpen,
  side,
  src,
}: {
  side: 'before' | 'after'
  src: string | undefined
  /** The other side is missing: said under this one when the two stack. */
  missing: boolean
  onOpen: (button: HTMLButtonElement) => void
}) {
  const word = side === 'before' ? 'Before' : 'After'
  if (src === undefined || src === '') {
    // Side by side, the gap keeps the pair's shape; stacked, the caption below says it.
    return (
      <div className="bg-chrome text-faint hidden aspect-[16/10] place-items-center rounded-md text-xs @min-[360px]/report:grid">
        No {word.toLowerCase()}
      </div>
    )
  }
  return (
    <figure className="min-w-0">
      <button
        type="button"
        className="border-line-strong bg-background block w-full cursor-zoom-in overflow-hidden rounded-md border transition-[border-color] duration-120 ease-out hover:border-[color:var(--faint)]"
        aria-label={`${word}: view larger`}
        onClick={(e) => onOpen(e.currentTarget)}
      >
        <img
          src={src}
          alt={word}
          draggable={false}
          className="block aspect-[16/10] w-full object-cover object-top"
        />
      </button>
      <figcaption className="text-muted-foreground mt-1.5 text-xs font-medium">
        {word}
        {missing && (
          <span className="text-faint font-normal @min-[360px]/report:hidden">
            {side === 'after' ? ' · new screen' : ' · gone after'}
          </span>
        )}
      </figcaption>
    </figure>
  )
}

const has = (v: string | undefined) => v !== undefined && v !== ''

function Screens({
  onZoom,
  screens,
  state,
}: {
  screens: readonly ReportScreen[]
  state: ReportState
  onZoom: (zoom: Zoom, from: HTMLButtonElement) => void
}) {
  // Screens are expected once the work is done; elsewhere, none is nothing to say.
  if (screens.length === 0 && state !== 'review' && state !== 'ready') return null
  const count = `${screens.length} ${screens.length === 1 ? 'step' : 'steps'}`
  return (
    <section>
      <Label count={screens.length > 0 ? count : undefined}>Screens</Label>
      {screens.length === 0 && <p className="text-faint text-sm">No screens</p>}
      <div className="flex flex-col gap-5">
        {screens.map((s, i) => (
          // oxlint-disable-next-line no-array-index-key -- steps are in order and may repeat
          <div key={i}>
            <div className="mb-2 flex gap-2 text-sm font-medium">
              <span className="text-faint w-3 flex-none font-normal tabular-nums">{i + 1}</span>
              <span className="min-w-0 break-words select-text">{s.step}</span>
            </div>
            <div className={cn('grid gap-3', PAIR)}>
              {(['before', 'after'] as const).map((side) => (
                <Shot
                  key={side}
                  side={side}
                  src={s[side]}
                  missing={!has(s[side === 'before' ? 'after' : 'before'])}
                  onOpen={(from) => onZoom({ side, step: i }, from)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

const isPr = (url: string) => /github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(url)
const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

function Links({ links }: { links: Report['links'] }) {
  if (links.length === 0) return null
  return (
    <section>
      <Label>Links</Label>
      <div className="-mx-3 -mt-1.5">
        {links.map((link) => {
          const Icon = isPr(link.url) ? GitPullRequestIcon : LinkIcon
          const web = isWebUrl(link.url)
          return (
            <button
              type="button"
              key={link.url}
              disabled={!web}
              className="group/link enabled:hover:bg-hover flex h-8 w-full items-center gap-2 rounded-md px-3 text-left transition-colors duration-120 ease-out disabled:cursor-default disabled:opacity-60"
              title={
                web ? `${link.label}\n${link.url}` : `Not a web link, so it won't open: ${link.url}`
              }
              onClick={() => {
                if (isWebUrl(link.url)) void openUrl(link.url)
              }}
            >
              <Icon className="text-faint size-3.5 flex-none" strokeWidth={1.5} />
              <span className="min-w-0 truncate text-sm">{link.label}</span>
              <span className="text-faint min-w-0 flex-1 truncate text-xs">{hostOf(link.url)}</span>
              <ArrowUpRightIcon
                className="text-faint size-3 flex-none opacity-0 transition-opacity duration-120 ease-out group-hover/link:group-enabled/link:opacity-100 group-focus-visible/link:opacity-100"
                strokeWidth={1.5}
              />
            </button>
          )
        })}
      </div>
    </section>
  )
}

function Left({ left }: { left: readonly string[] }) {
  if (left.length === 0) return null
  return (
    <section>
      <Label>Left for you</Label>
      <ul className="flex flex-col gap-1">
        {left.map((item, i) => (
          // oxlint-disable-next-line no-array-index-key -- the agent's list, in its order
          <li key={i} className="text-ink-soft flex gap-2 text-sm">
            <span className="text-label flex-none" aria-hidden>
              –
            </span>
            <span className="min-w-0 break-words select-text">{item}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The steps that have a screen, and the side to show on one (the same, when it has it). */
function stepTo(screens: readonly ReportScreen[], zoom: Zoom, by: 1 | -1): Zoom | null {
  for (let i = zoom.step + by; i >= 0 && i < screens.length; i += by) {
    const s = screens[i]
    if (s === undefined) continue
    if (has(s[zoom.side])) return { side: zoom.side, step: i }
    const other = zoom.side === 'before' ? 'after' : 'before'
    if (has(s[other])) return { side: other, step: i }
  }
  return null
}

/**
 * A screen over the app's main area (the narrow panel is no place for it): Esc or × closes,
 * ← → turns the pair, ↑ ↓ steps through the steps. A surface, not a modal: no veil.
 */
function ZoomedShot({
  host,
  onClose,
  onZoom,
  report,
  zoom,
}: {
  host: HTMLElement
  report: Report
  zoom: Zoom
  onZoom: (zoom: Zoom) => void
  onClose: () => void
}) {
  const close = useRef<HTMLButtonElement>(null)
  const [actual, setActual] = useState(false)
  useEffect(() => close.current?.focus({ preventScroll: true }), [])
  const screen = report.screens[zoom.step]
  if (screen === undefined) return null
  const src = screen[zoom.side]
  const sides = (['before', 'after'] as const).filter((s) => has(screen[s]))
  const steps = report.screens.length
  return createPortal(
    <div
      className="glass bg-background animate-in fade-in zoom-in-[0.98] @container/zoom absolute inset-0 z-30 flex flex-col duration-160 ease-out"
      role="dialog"
      aria-label={`Step ${zoom.step + 1}: ${screen.step}, ${zoom.side}`}
      onKeyDown={(e) => {
        let next: Zoom | null = null
        if (e.key === 'Escape') {
          // Esc closes this, and goes no further (it would stop a working chat).
          e.preventDefault()
          e.stopPropagation()
          onClose()
          return
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          const other = sides.find((s) => s !== zoom.side)
          if (other !== undefined) next = { ...zoom, side: other }
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          next = stepTo(report.screens, zoom, e.key === 'ArrowDown' ? 1 : -1)
        }
        if (next !== null) {
          e.preventDefault()
          setActual(false)
          onZoom(next)
        }
      }}
    >
      <div className="border-border flex h-bar flex-none items-center gap-2 border-b pr-2 pl-4">
        <span className="text-faint flex-none text-sm tabular-nums">
          {zoom.step + 1}
          {steps > 1 && <span className="text-label">/{steps}</span>}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={screen.step}>
          {screen.step}
        </span>
        <span className="text-faint hidden flex-none text-xs @min-[560px]/zoom:inline">
          {sides.length > 1 && '← → before / after'}
          {sides.length > 1 && steps > 1 && ' · '}
          {steps > 1 && '↑ ↓ steps'}
        </span>
        {sides.length > 1 && (
          <span className="bg-muted flex flex-none rounded-md p-0.5" role="group">
            {sides.map((s) => (
              <button
                type="button"
                key={s}
                aria-pressed={zoom.side === s}
                className={cn(
                  'h-6 rounded-sm px-2 text-xs font-medium transition-colors duration-120 ease-out',
                  zoom.side === s
                    ? 'bg-background text-foreground shadow-xs'
                    : 'text-faint hover:text-muted-foreground'
                )}
                onClick={() => onZoom({ ...zoom, side: s })}
              >
                {s === 'before' ? 'Before' : 'After'}
              </button>
            ))}
          </span>
        )}
        <Button
          ref={close}
          variant="ghost"
          size="icon"
          aria-label="Close the screen"
          aria-keyshortcuts="Escape"
          title="Close (Esc)"
          onClick={onClose}
        >
          <XIcon strokeWidth={1.5} />
        </Button>
      </div>
      {/* Fitted whole (the thumbnail crops it); a click shows it at its own size. */}
      <div
        className={cn(
          'min-h-0 flex-1 overflow-auto px-4 py-4',
          !actual && 'grid place-items-center'
        )}
      >
        {src !== undefined && (
          <button
            type="button"
            className={cn(
              'block',
              actual ? 'w-max cursor-zoom-out' : 'h-full w-full cursor-zoom-in'
            )}
            aria-label={actual ? 'Fit to the window' : 'Show at actual size'}
            aria-pressed={actual}
            onClick={() => setActual(!actual)}
          >
            <img
              key={`${zoom.step}:${zoom.side}`}
              src={src}
              alt={zoom.side === 'before' ? 'Before' : 'After'}
              draggable={false}
              className={cn(
                'animate-in fade-in border-line-strong bg-background mx-auto block rounded-md border duration-160 ease-out',
                actual ? 'max-w-none' : 'h-full w-full object-contain'
              )}
            />
          </button>
        )}
      </div>
    </div>,
    host
  )
}

/** The report's question: the open choice, or the chat's own (asked without one). */
const asks = (report: Report, ask: ReportAsk) =>
  ask.kind !== 'unknown' || openChoice(report.choices) !== undefined

/**
 * The report itself, for any surface that has room for it: the right panel's tab, the Desk.
 * `onZoom` asks the surface to show a screen larger (see `ZoomedShot`).
 */
export function ReportBody({
  ask = { kind: 'unknown' },
  chatActiveAt,
  merged = false,
  onOpenChat = null,
  onZoom,
  report,
}: {
  report: Report
  /** The workspace's chats' last activity: a report older than it says so. */
  chatActiveAt?: number
  /** Where the question stands in the report's chat (see `reportAsk`). */
  ask?: ReportAsk
  /** The workspace's PR is merged: the report's state is history. */
  merged?: boolean
  /** Goes to the report's chat; null when it is not open. */
  onOpenChat?: (() => void) | null
  onZoom: (zoom: Zoom, from: HTMLButtonElement) => void
}) {
  const stale = !merged && isStale(report.at, chatActiveAt)
  // Ready, done or blocked: what is left is the point, right under the summary.
  const leftFirst =
    report.state === 'ready' || report.state === 'done' || report.state === 'blocked'
  const left = merged ? leftAfterMerge(report.left) : report.left
  // A question asked of the user only stands while it is the report's state.
  const question = report.state === 'question' && asks(report, ask)
  return (
    <article className="@container/report flex flex-col gap-5" aria-label="Report">
      <Head report={report} merged={merged} stale={stale} onOpenChat={onOpenChat} />
      {leftFirst && <Left left={left} />}
      {question && <AskCard ask={ask} choice={openChoice(report.choices)} />}
      <Context feature={report.feature} problem={report.problem} />
      <Choices choices={report.choices} />
      {!leftFirst && <Left left={left} />}
      <Screens screens={report.screens} state={report.state} onZoom={onZoom} />
      <Links links={report.links} />
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
  entry,
  merged,
  onOpenChat,
  onRetry,
}: {
  entry: ReportEntry | undefined
  chatActiveAt?: number
  ask?: ReportAsk
  merged?: boolean
  onOpenChat?: (() => void) | null
  onRetry: () => void
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
      <div key={report.at} className="animate-in fade-in duration-200 ease-out">
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
          ask={ask}
          merged={merged}
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
      <div className="h-full overflow-x-hidden overflow-y-auto px-5 pt-1 pb-6">{body}</div>
      {zoom !== null && report !== null && host !== null && (
        <ZoomedShot host={host} report={report} zoom={zoom} onZoom={setZoom} onClose={close} />
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
