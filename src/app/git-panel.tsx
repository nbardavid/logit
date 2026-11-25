import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  ArrowUpIcon,
  ArrowUpRightIcon,
  FolderXIcon,
  GitBranchIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  GlobeIcon,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { BranchState, FileChange } from './use-git'

import { announceMerged } from '../cards/pr-store'
import {
  type Check,
  confirmWords,
  type HeadAsk,
  mergeGate,
  type PrHeadline,
  prHeadline,
  type PullRequest,
  uncommittedRefusal,
} from '../git/pr'
import { REPORT_STATE, type ReportState } from '../model/report'
import { isBrowser, type PanelView } from './browser-tabs'
import { countClass, Empty, type FileActions, FileList } from './file-list'
import { ReportDot } from './report-view'
import { Dot } from './status-dot'

export interface GitPanelProps {
  /** Pixels once dragged, or a CSS width that follows the window. */
  width: number | string
  path: string | undefined
  changes: FileChange[] | null | undefined
  pr: PullRequest | null
  branch: BranchState | null
  /** The branch the workspace was made on: shown until git answers. */
  wsBranch: string
  /** Bumped by ⌘P's Merge: the head asks its inline question, as its own button would. */
  mergeAsk?: number
  /**
   * What "clean up" does once the PR is merged: delete the worktree. `force` only after git
   * refused (uncommitted changes) and the user said "Delete anyway".
   */
  cleanup: { label: string; run: (force: boolean) => Promise<void> } | null
  /** Something changed on disk or on GitHub: read it all again. */
  onChanged: () => void
  /** What failed ("Couldn't push"), and why. */
  onError: (title: string, error: unknown) => void
  /** A chat of this workspace is working or waiting: its questions say so. */
  claude: 'working' | 'waiting' | null
  /** No PR yet: hand "open one" to this workspace's chat (the app itself never creates one). */
  onAskPr: () => void
  setup: ReactNode
  /** The workspace's artifacts: how many, and whether one waits unread (the tab's dot). */
  artifacts: { count: number; unread: boolean }
  /** What the panel shows (`shownView`, so always one it can). */
  view: PanelView
  onView: (view: PanelView) => void
  /** The body while a page is the view: its address bar and the page. */
  browser: ReactNode
  /**
   * The Report tab, when the workspace has a report: its state (for the cue of a new one
   * not seen yet) and its body.
   */
  report: {
    state: ReportState | null
    unread: boolean
    body: ReactNode
  } | null
}

/** The working status loader, centred in a 14px icon's box. */
export const spinner = (
  <span className="grid size-3.5 flex-none place-items-center">
    <Dot tone="working" />
  </span>
)

/** The PR's status as a dot, coloured by what it says; a loader while GitHub decides. */
const HEAD_DOT = {
  alert: 'bg-critical',
  closed: 'bg-neutral',
  draft: 'bg-neutral',
  merged: 'bg-merge',
  ready: 'bg-good',
} as const

function HeadDot({ icon }: { icon: PrHeadline['icon'] }) {
  if (icon === 'spinner') return <Dot tone="working" />
  return <span className={cn('size-1.5 flex-none rounded-full', HEAD_DOT[icon])} />
}

/** `.btn-merge`: GitHub's green; no hover change while disabled. */
const merge = 'bg-merge text-white hover:bg-merge hover:not-disabled:bg-merge-hover px-2.5'
/** Inline confirmations swap in place: a fade, no movement. */
const swap = 'animate-in fade-in duration-120 ease-out'

/**
 * The PR, at the top of the Git view: an eyebrow with its status dot, number and headline,
 * its title, its numbers, then its buttons (its one action, Push, Open on GitHub). Without a
 * PR, the branch and Push / Ask for PR.
 */
function Head({
  askSeen,
  branch,
  changes,
  claude,
  cleanup,
  mergeAsk = 0,
  onAskPr,
  onChanged,
  onError,
  path,
  pr,
  wsBranch,
}: Pick<
  GitPanelProps,
  | 'branch'
  | 'changes'
  | 'claude'
  | 'cleanup'
  | 'onAskPr'
  | 'onChanged'
  | 'onError'
  | 'path'
  | 'pr'
  | 'wsBranch'
  | 'mergeAsk'
> & {
  /** The last ⌘P Merge already asked: the head mounts again with each visit to the Git view,
   * and must not ask twice. */
  askSeen: { current: number }
}) {
  const [asking, setAsking] = useState(false)
  // git refused to delete the worktree (uncommitted changes): the question is now "anyway".
  const [refused, setRefused] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const yes = useRef<HTMLButtonElement>(null)
  const no = useRef<HTMLButtonElement>(null)
  const actionButton = useRef<HTMLButtonElement>(null)
  // Once a question was asked, the buttons fade back in when it goes; not on first show.
  const asked = useRef(false)
  if (asking) asked.current = true
  const headline = pr ? prHeadline(pr) : null
  // The word inks red only when the merge is truly blocked (conflicts, a required review, out
  // of date): any other state is a dot and a plain word.
  const banded =
    headline !== null &&
    headline.tone === 'blocked' &&
    headline.action === null &&
    pr?.state !== 'Closed'
  const action =
    headline?.action === 'cleanup' && cleanup === null ? null : (headline?.action ?? null)

  const run = async (what: string, failed: string, job: () => Promise<unknown>) => {
    setBusy(what)
    try {
      await job()
      onChanged()
      setAsking(false)
    } catch (error) {
      // The sidebar's flow: a refusal over uncommitted changes asks "Delete anyway" in place.
      if (what === 'cleanup' && !refused && uncommittedRefusal(String(error))) setRefused(true)
      else {
        onError(failed, error)
        setAsking(false)
      }
    } finally {
      setBusy(null)
    }
  }

  const ahead = branch?.ahead ?? 0
  // Until git answers, the branch the workspace was made on; a real detached HEAD says so.
  const branchName = branch === null ? wsBranch : (branch.branch ?? 'detached HEAD')
  const unpublished = branch !== null && branch.branch !== null && !branch.upstream
  const gate = pr ? mergeGate(pr, ahead) : null
  /** Why Merge cannot be pressed yet. */
  const blocked = action === 'merge' ? (gate?.blocked ?? null) : null
  const failing = action === 'merge' && gate?.failing === true
  const cautious = failing || action === 'cleanup'
  // The question takes the focus: Enter says Yes, Esc says No. A risky one (failing checks,
  // deleting the workspace) focuses No: Enter alone never does it.
  useEffect(() => {
    if (asking) (cautious ? no : yes).current?.focus()
  }, [asking, cautious, refused])
  useEffect(() => {
    if (!asking) setRefused(false)
  }, [asking])
  useEffect(() => {
    if (mergeAsk <= askSeen.current) return
    askSeen.current = mergeAsk
    if (action === 'merge' && blocked === null) setAsking(true)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- only a new ask, never the PR's state
  }, [mergeAsk])
  let ask: HeadAsk = { action: 'cleanup', uncommitted: changes?.length ?? 0 }
  if (refused) ask = { action: 'cleanup-anyway' }
  if (action === 'merge') ask = { action, base: pr?.base ?? '', failing, number: pr?.number ?? 0 }
  const words = confirmWords(ask, claude)
  let yesLabel = action === 'merge' ? 'Merge' : 'Clean up'
  if (refused) yesLabel = 'Delete anyway'
  if (busy !== null) yesLabel = 'Working…'
  // Below 380px of panel (24vw at 1440 included), the arrow and the count say it: the PR's
  // status gets the room to read in full.
  let pushText: ReactNode = `Push ${ahead} ${ahead === 1 ? 'commit' : 'commits'}`
  if (unpublished) pushText = 'Publish'
  if (busy === 'push') pushText = 'Pushing…'
  // Once merged, the branch is GitHub's past: pushing to it would only reopen questions.
  const push = path !== undefined &&
    branch?.remote === true &&
    (ahead > 0 || unpublished) &&
    pr?.state !== 'Merged' && (
      <Button
        type="button"
        variant={action === 'merge' && blocked === null ? 'outline' : 'default'}
        size="sm"
        aria-label={unpublished ? 'Publish the branch' : `Push ${ahead}`}
        disabled={busy !== null}
        onClick={() =>
          void run(
            'push',
            unpublished ? "Couldn't publish the branch" : "Couldn't push",
            async () => invoke('git_push', { path })
          )
        }
      >
        <ArrowUpIcon />
        {pushText}
      </Button>
    )

  // A branch with work on it (published, or commits to push) and no PR: Claude opens it.
  const askPr = !pr &&
    path !== undefined &&
    branch?.remote === true &&
    branch.branch !== null &&
    (branch.upstream || ahead > 0) && (
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label="Ask Claude to open a PR"
        data-tip="Ask Claude to open a PR"
        data-tip-align="end"
        onClick={onAskPr}
      >
        <GitPullRequestIcon />
        Ask for PR
      </Button>
    )

  const cancel = () => {
    setAsking(false)
    // Back on the button that asked, not lost on the page.
    requestAnimationFrame(() => actionButton.current?.focus())
  }

  // Only a merge truly blocked inks the status word red; anything else is the dot alone.
  const ink = banded ? 'text-critical-ink' : undefined
  const hasButtons = push !== false || askPr !== false || pr !== null
  return (
    <section className="flex flex-none flex-col px-5 pt-5 pb-2" aria-label="Pull request">
      {/* The eyebrow: the PR's status as a dot and a word, its number a link; without a PR, the
          branch and its ↑/↓ counts. */}
      <div className="text-faint flex h-5 min-w-0 items-center gap-2 text-xs">
        {pr && headline && (
          <>
            <span className="grid size-[11px] flex-none place-items-center">
              <HeadDot icon={headline.icon} />
            </span>
            <button
              type="button"
              className="hover:text-foreground inline-flex flex-none items-center gap-0.5 tabular-nums transition-colors duration-120 ease-out"
              aria-label={`Open #${pr.number} on GitHub`}
              onClick={() => void openUrl(pr.url)}
            >
              #{pr.number}
            </button>
            <span aria-hidden="true">·</span>
            {/* Below 340px of panel, one word ("Failing"); the tip says it whole. */}
            <span className={cn('min-w-0 truncate', ink)} title={headline.label}>
              <span className="@max-[340px]:hidden">{headline.label}</span>
              <span className="hidden @max-[340px]:inline">{headline.short}</span>
            </span>
          </>
        )}
        {!pr && (
          <>
            <GitBranchIcon className="size-3.5 flex-none" />
            <span className="truncate font-mono">{branchName}</span>
            {/* The Push button says it already. */}
            {ahead > 0 && push === false && <span className="flex-none font-mono">↑{ahead}</span>}
            {(branch?.behind ?? 0) > 0 && (
              <span className="flex-none font-mono">↓{branch?.behind}</span>
            )}
          </>
        )}
      </div>
      {pr && (
        <>
          <h2 className="text-foreground mt-1 text-title font-semibold text-balance select-text">
            {pr.title}
          </h2>
          <div className="text-faint mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1 text-xs">
            <span className="tabular-nums">
              <span className="text-good">+{pr.additions}</span>{' '}
              <span className="text-critical">−{pr.deletions}</span>
            </span>
            <span>
              · {pr.changedFiles} {pr.changedFiles === 1 ? 'file' : 'files'} ·
            </span>
            <span className="min-w-0 truncate font-mono" title={`${pr.head} → ${pr.base}`}>
              {pr.head} → {pr.base}
            </span>
          </div>
        </>
      )}
      {pr && asking && path !== undefined && (
        <div
          className={cn('mt-3.5 flex flex-col gap-2', swap)}
          role="group"
          aria-label={words.title}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return
            // Esc says No, and goes no further (it would stop a working chat).
            e.preventDefault()
            e.stopPropagation()
            cancel()
          }}
        >
          {/* The question names its action on its button: here, only what to know first. */}
          <span
            className={cn('text-sm', words.warn ? 'text-critical-ink' : 'text-muted-foreground')}
            title={words.title}
          >
            {words.long}
          </span>
          <span className="flex items-center gap-2">
            <Button
              ref={yes}
              type="button"
              variant={cautious ? 'destructive' : 'default'}
              size="sm"
              className={cn(action === 'merge' && !failing && merge)}
              title={words.title}
              disabled={busy !== null}
              onClick={() =>
                void run(
                  action ?? '',
                  action === 'merge'
                    ? `Couldn't merge #${pr.number}`
                    : `Couldn't ${(cleanup?.label ?? 'clean up').toLowerCase()}`,
                  async () => {
                    if (action !== 'merge') return cleanup?.run(refused)
                    await invoke('pr_merge', { path })
                    announceMerged({ cwd: path, number: pr.number, url: pr.url })
                  }
                )
              }
            >
              {yesLabel}
            </Button>
            <Button ref={no} type="button" variant="outline" size="sm" onClick={cancel}>
              No
            </Button>
          </span>
        </div>
      )}
      {!asking && hasButtons && (
        <span className={cn('mt-3.5 flex flex-wrap items-center gap-2', asked.current && swap)}>
          {/* Blocked only by unpushed commits, Merge says nothing Push doesn't: it waits. */}
          {pr && action !== null && path !== undefined && (blocked === null || push === false) && (
            // A disabled button gets no hover of its own: the tip says why on its wrapper.
            <span
              className="flex"
              data-tip={
                blocked === null
                  ? undefined
                  : 'Push the commits first: the merge takes GitHub’s branch'
              }
            >
              <Button
                ref={actionButton}
                type="button"
                variant={action === 'merge' && blocked === null ? 'default' : 'secondary'}
                size="sm"
                className={cn(
                  action === 'merge' && blocked === null && merge,
                  // Unavailable reads as a quiet grey button naming why, never a faded green.
                  'disabled:opacity-100',
                  blocked !== null && 'text-muted-foreground'
                )}
                disabled={busy !== null || blocked !== null}
                onClick={() => setAsking(true)}
              >
                {action === 'merge' && blocked === null && <GitMergeIcon />}
                {action === 'merge' ? (blocked ?? 'Merge') : (cleanup?.label ?? 'Clean up')}
              </Button>
            </span>
          )}
          {push}
          {askPr}
          {pr && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Open #${pr.number} on GitHub`}
              onClick={() => void openUrl(pr.url)}
            >
              GitHub
              <ArrowUpRightIcon />
            </Button>
          )}
        </span>
      )}
    </section>
  )
}

function Tab({
  active,
  className,
  count,
  cue,
  dot = false,
  label,
  onSelect,
}: {
  active: boolean
  count: number
  /** Something new behind it (an unread artifact). */
  dot?: boolean
  /** Its own mark of something new, in place of the dot. */
  cue?: ReactNode
  label: string
  onSelect: () => void
  className?: string
}) {
  const ref = useRef<HTMLButtonElement>(null)
  // The tab on screen stays in view, as it is picked and as the panel narrows.
  useEffect(() => {
    const el = ref.current
    const strip = el?.parentElement
    if (!active || !el || !strip) return
    // Only the strip scrolls (scrollIntoView would move every scrolling ancestor too).
    const show = () => {
      const left = el.offsetLeft - strip.offsetLeft
      const right = left + el.offsetWidth
      if (left < strip.scrollLeft) strip.scrollLeft = left - 8
      else if (right > strip.scrollLeft + strip.clientWidth)
        strip.scrollLeft = right - strip.clientWidth + 8
    }
    show()
    const observer = new ResizeObserver(show)
    observer.observe(strip)
    return () => observer.disconnect()
  }, [active])
  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      aria-selected={active}
      className={cn(
        'flex h-6 flex-none items-center gap-1.5 rounded-[5px] px-2.5 text-sm whitespace-nowrap transition-[background-color,color,box-shadow] duration-120 ease-out',
        active
          ? 'bg-background text-foreground shadow-pill'
          : 'text-faint hover:text-muted-foreground',
        className
      )}
      onClick={onSelect}
    >
      {cue}
      {label}
      {count > 0 && <span className={cn(countClass, 'hidden @[20rem]/tabs:inline')}>{count}</span>}
      {dot && <Dot tone="done" label="New" />}
    </button>
  )
}

const CHECK_WORD = {
  failing: 'failed',
  passing: 'passed',
  pending: 'running',
  skipped: 'skipped',
} as const

/** A check's mark: a 6px dot in its status colour; a loader while it runs. */
function CheckDot({ state }: { state: Check['state'] }) {
  if (state === 'pending') return spinner
  const tone = { failing: 'bg-critical', passing: 'bg-good', skipped: 'bg-neutral' }[state]
  return (
    <span className="grid size-3.5 flex-none place-items-center">
      <span className={cn('size-1.5 rounded-full', tone)} />
    </span>
  )
}

/** A section of the panel: a small quiet label over its rows (DESIGN.md › The right panel). */
export const SECTION_LABEL = 'text-faint flex h-6 items-center gap-1 px-2 text-xs font-medium'

/** The PR's checks (a click opens its run), then its description. */
function Checks({ pr }: { pr: PullRequest }) {
  return (
    <>
      <section className="flex flex-col" aria-label="Checks">
        <div className={SECTION_LABEL}>
          Checks <span className={countClass}>{pr.checks.length}</span>
        </div>
        {pr.checks.length === 0 && (
          <div className="text-faint px-2 py-1.5 text-sm">No checks on this pull request</div>
        )}
        {pr.checks.map((check) => (
          <button
            type="button"
            key={check.name}
            className="group/check hover:bg-hover flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-sm transition-colors duration-120 ease-out"
            aria-label={`${check.name}, ${CHECK_WORD[check.state]}: open on GitHub`}
            onClick={() => void openUrl(check.url)}
          >
            <CheckDot state={check.state} />
            <span className="min-w-0 flex-1 truncate">{check.name}</span>
            <span className="text-faint grid flex-none text-xs">
              <span className="col-start-1 row-start-1 transition-opacity duration-120 ease-out group-hover/check:opacity-0 group-focus-visible/check:opacity-0">
                {CHECK_WORD[check.state]}
              </span>
              <ArrowUpRightIcon className="col-start-1 row-start-1 size-3 self-center justify-self-end opacity-0 transition-opacity duration-120 ease-out group-hover/check:opacity-100 group-focus-visible/check:opacity-100" />
            </span>
          </button>
        ))}
      </section>
      {pr.body !== '' && (
        <section className="flex flex-col" aria-label="Description">
          <div className={SECTION_LABEL}>Description</div>
          <div className="text-muted-foreground max-h-[260px] overflow-auto px-2 py-1 text-sm leading-5 whitespace-pre-wrap select-text">
            {pr.body}
          </div>
        </section>
      )}
    </>
  )
}

export function GitPanel(props: GitPanelProps) {
  const { changes, path, pr, setup, width } = props
  let shown = props.view
  if (shown === 'report' && props.report === null) shown = 'changes'
  // Canvas folds the PR, its checks and the files into one Git view.
  if (shown === 'checks') shown = 'changes'
  const { report } = props
  const setView = props.onView
  // A page at work moves often: only a stop the user has not read marks the tab.
  const reportCue =
    report !== null &&
    report.unread &&
    shown !== 'report' &&
    report.state !== null &&
    report.state !== 'working'
  const strip = useRef<HTMLDivElement>(null)
  const askSeen = useRef(0)

  const write = (failed: string, command: string, args: Record<string, unknown>) => {
    if (path === undefined) return
    invoke(command, { path, ...args }).then(props.onChanged, (error: unknown) =>
      props.onError(failed, error)
    )
  }
  const actions: FileActions = {
    discard: (file) =>
      write(`Couldn't discard ${file.path.split('/').pop() ?? file.path}`, 'git_discard', {
        file: file.path,
        untracked: file.untracked,
      }),
    stage: (files) =>
      write("Couldn't stage", 'git_stage', {
        all: files === 'all',
        files: files === 'all' ? [] : files,
      }),
    unstage: (files) =>
      write("Couldn't unstage", 'git_unstage', {
        all: files === 'all',
        files: files === 'all' ? [] : files,
      }),
  }

  return (
    // The right panel's sheet: white, inset from the ground like the chat's.
    <aside
      className="bg-background shadow-sheet @container flex min-h-0 flex-none flex-col overflow-hidden rounded-xl"
      aria-label="Git"
      style={{ width }}
    >
      <div
        className="@container/tabs border-border flex h-bar flex-none items-center border-b px-3"
        data-tauri-drag-region
      >
        <div
          ref={strip}
          // A segmented control; narrow, it scrolls sideways (the tab on screen kept in view).
          className="bg-muted flex max-w-full min-w-0 flex-none items-center gap-0.5 overflow-x-auto rounded-[7px] p-0.5 [&::-webkit-scrollbar]:hidden"
          role="tablist"
          aria-label="Git view"
        >
          {report && (
            // First: what the agent asks of you leads.
            <Tab
              active={shown === 'report'}
              className="animate-in fade-in duration-160 ease-out"
              label="Report"
              count={0}
              cue={
                reportCue &&
                report.state !== null && (
                  <span className="animate-in fade-in grid size-[11px] place-items-center duration-160 ease-out">
                    <ReportDot
                      state={report.state}
                      label={`The page says: ${REPORT_STATE[report.state].word}`}
                    />
                  </span>
                )
              }
              onSelect={() => setView('report')}
            />
          )}
          <Tab
            active={shown === 'changes'}
            label="Git"
            count={changes?.length ?? 0}
            onSelect={() => setView('changes')}
          />
          <Tab
            active={shown === 'artifacts' || isBrowser(shown)}
            label="Artifacts"
            count={props.artifacts.count}
            dot={props.artifacts.unread && shown !== 'artifacts' && !isBrowser(shown)}
            onSelect={() => setView('artifacts')}
          />
        </div>
      </div>
      {isBrowser(shown) && props.browser}
      {shown === 'report' && report && (
        <div key={`${path ?? ''}:report-pane`} className="flex min-h-0 flex-1 flex-col">
          {report.body}
        </div>
      )}
      {/* A fresh container per workspace and view: WKWebView kept painting the old one. */}
      <div
        key={`${path ?? ''}:${isBrowser(shown) ? 'browser' : shown}`}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-4"
        hidden={isBrowser(shown) || shown === 'report'}
      >
        {shown === 'changes' && (
          <Head
            path={path}
            pr={pr}
            branch={props.branch}
            cleanup={props.cleanup}
            onChanged={props.onChanged}
            onError={props.onError}
            claude={props.claude}
            changes={changes}
            onAskPr={props.onAskPr}
            wsBranch={props.wsBranch}
            mergeAsk={props.mergeAsk}
            askSeen={askSeen}
          />
        )}
        <div className="flex flex-col gap-6 px-3 pt-4">
          {shown === 'changes' && pr && <Checks pr={pr} />}
          {shown === 'changes' && changes && <FileList changes={changes} actions={actions} />}
          {shown === 'changes' && changes === null && (
            <Empty icon={FolderXIcon} text="Not a git repository" />
          )}
          {shown === 'changes' && changes === undefined && (
            <div className="grid place-items-center pt-24" aria-label="Reading">
              {spinner}
            </div>
          )}
          {shown === 'artifacts' && (
            <Empty
              icon={GlobeIcon}
              text="Artifacts Claude publishes in this workspace show here."
            />
          )}
        </div>
      </div>
      {!isBrowser(shown) && setup}
    </aside>
  )
}
