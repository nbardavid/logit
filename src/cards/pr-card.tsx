// The pull-request card: whenever an agent links a GitHub PR (a chat message, a report), the
// PR shows live, with one action, Merge. One component for every surface, so they can't drift.
import {
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
} from 'lucide-react'
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { PullRequest } from '../git/pr'

import { Dot } from '../app/status-dot'
import { type PrRef, prRef } from '../git/pr-link'
import { openLink } from '../report/blocks/primitives'
import { Bar, CardFrame, MetaItem, MetaRow, SWAP, type TileTone } from './frame'
import { ciSummary, ciWords, ghProblem, mergeOffer, mergeQuestion } from './pr-card-model'
import { FOCUS_GAP_MS, loadPr, mergePr, prEntry, RUNNING_MS, watchPr } from './pr-store'

/** What a report's `pr` block already says: drawn until the PR itself is read. */
export interface PrSketch {
  title: string
  branch?: string
  ci?: 'passing' | 'failing' | 'running' | 'none'
  review?: 'approved' | 'changes' | 'waiting' | 'none'
}

/** An armed Merge goes back to rest after this long untouched. */
const ARMED_MS = 5000

const STATE_TILE: Record<PullRequest['state'], { icon: typeof GitMergeIcon; tone: TileTone }> = {
  Closed: { icon: GitPullRequestClosedIcon, tone: 'faint' },
  Draft: { icon: GitPullRequestDraftIcon, tone: 'faint' },
  Merged: { icon: GitMergeIcon, tone: 'done' },
  Open: { icon: GitPullRequestIcon, tone: 'neutral' },
}

const BADGE: Partial<Record<PullRequest['state'], string>> = {
  Closed: 'bg-active text-muted-foreground',
  Draft: 'bg-active text-muted-foreground',
  Merged: 'bg-good-wash text-good-ink',
}

const REVIEW = {
  approved: ['Approved', 'text-good-ink'],
  changes: ['Changes requested', 'text-critical-ink'],
  none: null,
  required: ['Review required', 'text-faint'],
  waiting: ['Review required', 'text-faint'],
} as const

const CI_DOT = { failing: 'failing', none: 'idle', passing: 'done', running: 'working' } as const

/** Whether the card is in view (with a margin): only then is its PR read. */
function useInView(el: RefObject<HTMLElement | null>) {
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const node = el.current
    if (!node) return
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry?.isIntersecting === true),
      { rootMargin: '240px 0px' }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [el])
  return inView
}

/** The PR's entry in the shared store, read while the card is in view and kept fresh. */
function useLivePr(link: PrRef, cwd: string | undefined, inView: boolean) {
  const entry = useSyncExternalStore(
    (fn) => watchPr(link.key, fn),
    () => prEntry(link.key)
  )
  const pr = entry.pr
  // GitHub still deciding (checks running, mergeability unknown): read again gently.
  const settling =
    pr !== null &&
    (pr.state === 'Open' || pr.state === 'Draft') &&
    (pr.checks.some((c) => c.state === 'pending') ||
      pr.mergeState === '' ||
      pr.mergeState === 'UNKNOWN')
  useEffect(() => {
    if (!inView) return
    void loadPr(link, cwd)
    const back = () => {
      if (document.visibilityState === 'visible') void loadPr(link, cwd, FOCUS_GAP_MS)
    }
    window.addEventListener('focus', back)
    document.addEventListener('visibilitychange', back)
    const timer = settling
      ? setInterval(() => {
          if (document.visibilityState === 'visible') void loadPr(link, cwd, RUNNING_MS - 1000)
        }, RUNNING_MS)
      : undefined
    return () => {
      window.removeEventListener('focus', back)
      document.removeEventListener('visibilitychange', back)
      clearInterval(timer)
    }
  }, [link, cwd, inView, settling])
  return entry
}

type Phase = 'idle' | 'armed' | 'merging'

/** One PR, live: `url` any address of it; `sketch` what to draw until it is read. */
export function PrCard({
  cwd,
  sketch,
  url,
}: {
  url: string
  /** Where gh runs: the workspace (its unpushed commits are checked before a merge). */
  cwd?: string
  sketch?: PrSketch
}) {
  const link = useMemo(() => prRef(url), [url])
  if (link === null) return null
  return <LivePrCard link={link} cwd={cwd} sketch={sketch} />
}

function LivePrCard({ cwd, link, sketch }: { link: PrRef; cwd?: string; sketch?: PrSketch }) {
  const box = useRef<HTMLDivElement>(null)
  const inView = useInView(box)
  const entry = useLivePr(link, cwd, inView)
  const { pr } = entry
  const [phase, setPhase] = useState<Phase>('idle')
  const [failure, setFailure] = useState<string | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const title = useRef<HTMLButtonElement>(null)

  // Armed, Merge goes back to rest on its own, on a click anywhere else, or when it loses focus.
  useEffect(() => {
    if (phase !== 'armed') return
    const timer = setTimeout(() => setPhase('idle'), ARMED_MS)
    const away = (e: PointerEvent) => {
      if (button.current?.contains(e.target as Node) !== true) setPhase('idle')
    }
    document.addEventListener('pointerdown', away, true)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('pointerdown', away, true)
    }
  }, [phase])

  const merge = async () => {
    const focused = document.activeElement === button.current
    setPhase('merging')
    setFailure(null)
    try {
      await mergePr(link, cwd, pr?.head ?? '')
      // The button goes with the merge: the focus lands on the title, not on the page.
      if (focused) requestAnimationFrame(() => title.current?.focus())
    } catch (error) {
      setFailure(ghProblem(String(error)))
    } finally {
      setPhase('idle')
    }
  }

  const offer = pr === null ? null : mergeOffer(pr)
  const risky = offer?.kind === 'merge' && offer.risky
  const state = pr?.state ?? null
  const tile = STATE_TILE[state ?? 'Open']
  const loading = pr === null && sketch === undefined && entry.error === null
  const unread = pr === null && sketch === undefined && entry.error !== null

  // The title line: the PR's title (it opens the PR), its number, its state when not open.
  const shownTitle = pr?.title ?? sketch?.title ?? ''
  let titleNode: ReactNode = (
    <button
      ref={title}
      type="button"
      className="text-foreground decoration-line-strong hover:decoration-foreground min-w-0 cursor-pointer truncate text-left font-medium underline-offset-[3px] transition-[text-decoration-color] duration-120 ease-out hover:underline @max-[420px]/card:line-clamp-2 @max-[420px]/card:whitespace-normal"
      title={`${shownTitle}\n${link.url}`}
      onClick={() => openLink(link.url)}
    >
      {shownTitle}
    </button>
  )
  if (loading) titleNode = <Bar className="w-[min(60%,280px)]" />
  if (unread)
    titleNode = (
      <button
        ref={title}
        type="button"
        className="text-muted-foreground min-w-0 cursor-pointer truncate text-left font-medium hover:underline"
        title={link.url}
        onClick={() => openLink(link.url)}
      >
        Pull request
      </button>
    )
  const badge = state === null ? undefined : BADGE[state]

  const repo = `${link.owner}/${link.repo}`
  const open = state === null || state === 'Open' || state === 'Draft'
  const ci = pr === null ? null : ciSummary(pr.checks)
  const ciTone = ci?.tone ?? sketch?.ci ?? null
  const words = ci === null ? null : ciWords(ci)
  const review = REVIEW[pr?.review ?? sketch?.review ?? 'none']
  let branch = sketch?.branch ?? ''
  if (pr !== null) branch = pr.head === '' ? '' : `${pr.head} → ${pr.base}`
  const facts = (
    <MetaRow>
      <MetaItem>{repo}</MetaItem>
      {loading && <Bar className="w-28" />}
      {branch !== '' && (
        <MetaItem className="max-w-full" title={branch}>
          <span className="truncate font-mono">{branch}</span>
        </MetaItem>
      )}
      {open && ciTone !== null && (
        <MetaItem
          key={ciTone}
          className={cn(SWAP, ciTone === 'failing' ? 'text-critical-ink' : 'text-muted-foreground')}
        >
          <span className="grid size-[11px] flex-none place-items-center">
            <Dot tone={CI_DOT[ciTone]} />
          </span>
          {words === null ? SKETCH_CI[ciTone] : words.text}
          {words !== null && words.count !== '' && (
            <span className="text-faint tabular-nums">{words.count}</span>
          )}
        </MetaItem>
      )}
      {open && review !== null && <MetaItem className={review[1]}>{review[0]}</MetaItem>}
      {pr !== null && pr.additions + pr.deletions > 0 && (
        <MetaItem className="font-mono tabular-nums">
          <span className="text-good">+{pr.additions}</span>
          <span className="text-critical">−{pr.deletions}</span>
        </MetaItem>
      )}
    </MetaRow>
  )

  // Armed or merging, the second line says what is about to happen, in place of the facts.
  let asking: string | null = null
  if (pr !== null && phase === 'armed') asking = mergeQuestion(pr, risky)
  if (pr !== null && phase === 'merging')
    asking = `Merging #${pr.number}${pr.base === '' ? '' : ` into ${pr.base}`}…`
  const meta = (
    <div className="grid">
      <div
        className={cn(
          'col-start-1 row-start-1 min-w-0 transition-opacity duration-120 ease-out',
          asking !== null && 'invisible opacity-0'
        )}
      >
        {facts}
      </div>
      {asking !== null && (
        <div
          key={phase}
          className={cn(
            'col-start-1 row-start-1 truncate leading-4 font-medium',
            risky && phase === 'armed' ? 'text-critical-ink' : 'text-muted-foreground',
            SWAP
          )}
          aria-live="polite"
        >
          {asking}
        </div>
      )}
    </div>
  )

  let action: ReactNode
  // Not read yet: the button's place holds still. A read that failed leaves no action.
  if (pr === null && entry.error === null) action = <Bar className="h-7 w-[76px] rounded-lg" />
  if (offer?.kind === 'blocked')
    action = (
      // A disabled button gets no hover of its own: the tip says why on its wrapper.
      <span className={cn('flex', SWAP)} data-tip={offer.reason} data-tip-align="end">
        <Button type="button" size="sm" className={MERGE} disabled>
          <GitMergeIcon />
          Merge
        </Button>
      </span>
    )
  if (offer?.kind === 'merge' && pr !== null)
    action = (
      <Button
        ref={button}
        type="button"
        size="sm"
        className={cn(
          'grid',
          phase === 'armed' && risky
            ? 'bg-critical hover:not-disabled:bg-critical/88 text-white'
            : MERGE,
          // Merging is no rest: the button keeps its colour while it works.
          phase === 'merging' && 'disabled:opacity-100',
          SWAP
        )}
        aria-label={
          phase === 'armed' ? `${mergeQuestion(pr, risky)} Confirm` : `Merge #${pr.number}`
        }
        title={phase === 'armed' ? 'Click again to merge · Esc to cancel' : undefined}
        disabled={phase === 'merging'}
        onClick={() => {
          if (phase === 'idle') {
            setFailure(null)
            setPhase('armed')
          } else if (phase === 'armed') void merge()
        }}
        onBlur={() => phase === 'armed' && setPhase('idle')}
        onKeyDown={(e) => {
          if (e.key !== 'Escape' || phase !== 'armed') return
          // Esc says no, and goes no further (in a chat it would stop Claude).
          e.preventDefault()
          e.stopPropagation()
          setPhase('idle')
        }}
      >
        <Layer on={phase === 'idle'}>
          <GitMergeIcon />
          Merge
        </Layer>
        <Layer on={phase === 'armed'}>Confirm</Layer>
        <Layer on={phase === 'merging'}>
          <span className="flex [&_.text-foreground]:text-white">
            <Dot tone="working" label="Merging" />
          </span>
        </Layer>
      </Button>
    )

  let notice: Parameters<typeof CardFrame>[0]['notice'] = null
  const retry = (label: string, run: () => void, busy: boolean) => (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="text-current hover:bg-white/70 hover:text-current"
      disabled={busy}
      onClick={run}
    >
      {busy ? 'Retrying…' : label}
    </Button>
  )
  if (failure !== null)
    notice = {
      aside: retry('Retry', () => void merge(), phase === 'merging'),
      body: (
        <>
          <span className="font-medium">Couldn’t merge #{link.number}.</span> {failure}
        </>
      ),
      tone: 'critical',
    }
  else if (pr === null && entry.error !== null)
    notice = {
      aside: retry('Retry', () => void loadPr(link, cwd, 0), entry.loading),
      body: (
        <>
          <span className="font-medium">
            {sketch === undefined ? 'Couldn’t load it.' : 'Couldn’t refresh it.'}
          </span>{' '}
          {ghProblem(entry.error)}
        </>
      ),
      tone: sketch === undefined ? 'critical' : 'quiet',
    }

  const Icon = tile.icon
  const label = `Pull request #${link.number}${state === null ? '' : `, ${state.toLowerCase()}`}${shownTitle === '' ? '' : `: ${shownTitle}`}`
  return (
    <div ref={box} data-pr-card={link.key}>
      <CardFrame
        label={label}
        tile={<Icon key={state ?? 'unknown'} className={cn(SWAP, loading && 'opacity-50')} />}
        tileTone={loading || unread ? 'faint' : tile.tone}
        title={
          <>
            {titleNode}
            <span className="text-faint flex-none font-normal tabular-nums">#{link.number}</span>
            {badge !== undefined && state !== null && (
              <span
                key={state}
                className={cn('text-2xs flex-none rounded-sm px-1.5 leading-4', badge, SWAP)}
              >
                {state}
              </span>
            )}
          </>
        }
        meta={meta}
        action={action}
        notice={notice}
      />
    </div>
  )
}

const SKETCH_CI = {
  failing: 'Checks failing',
  none: 'No checks',
  passing: 'Checks passed',
  running: 'Checks running',
} as const

/** `.btn-merge`, as the git panel draws it: GitHub's green; no hover change while disabled. */
const MERGE = 'bg-merge text-white hover:bg-merge hover:not-disabled:bg-merge-hover px-2.5'

/** One of the Merge button's labels, stacked: the button keeps the widest one's width. */
function Layer({ children, on }: { children: ReactNode; on: boolean }) {
  return (
    <span
      aria-hidden={!on}
      className={cn(
        'col-start-1 row-start-1 flex items-center justify-center gap-1.5 transition-opacity duration-120 ease-out',
        on ? 'opacity-100' : 'opacity-0'
      )}
    >
      {children}
    </span>
  )
}

/** Each PR once, in order, one under the other. */
export function PrCards({ cwd, links }: { links: readonly PrRef[]; cwd?: string }) {
  if (links.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      {links.map((l) => (
        <PrCard key={l.key} url={l.url} cwd={cwd} />
      ))}
    </div>
  )
}
