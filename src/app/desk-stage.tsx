// Desk's detail: the selected workspace's head (the Report tab's, saying where the workspace
// stands) and the calm moments when nothing needs the user.
import type { CSSProperties } from 'react'

import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'

import { type Report, REPORT_STATE, reportAge } from '../model/report'
import { type DeskGroup, type DeskKind, type DeskRow, isCurrent, KIND_TONE } from './desk-model'
import { ReportHead, TicketRef } from './report-view'
import { ProjectAvatar } from './sidebar'
import { Dot } from './status-dot'

type Groups = Record<DeskGroup, DeskRow[]>

/** One word per state, the same everywhere on Desk. */
const WORD: Record<DeskKind, string> = {
  blocked: REPORT_STATE.blocked.word,
  done: REPORT_STATE.done.word,
  finished: 'Finished',
  idle: 'Idle',
  permission: 'Wants to run a tool',
  question: REPORT_STATE.question.word,
  ready: REPORT_STATE.ready.word,
  review: REPORT_STATE.review.word,
  working: 'Working',
}

/** The state's mark, keyed by it so a change cross-fades in place (the sidebar's way). */
function RowMark({ kind }: { kind: DeskKind }) {
  const tone = KIND_TONE[kind]
  return (
    <span
      key={kind}
      className="animate-in fade-in flex size-3.5 flex-none items-center justify-center duration-160 ease-out"
    >
      {tone !== null && <Dot tone={tone} label={WORD[kind]} />}
    </span>
  )
}

/** The state word's ink, as the Report tab's. */
const INK: Record<DeskKind, string> = {
  blocked: 'text-critical-ink',
  done: 'text-good-ink',
  finished: 'text-good-ink',
  idle: 'text-muted-foreground',
  permission: 'text-warn-ink',
  question: 'text-warn-ink',
  ready: 'text-good-ink',
  review: 'text-warn-ink',
  working: 'text-muted-foreground',
}

/** The head's state line: the row's mark and word, and since when. */
function DeskStateLine({ now, row }: { row: DeskRow; now: number }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <RowMark kind={row.kind} />
      <span className={cn('flex-none font-medium', INK[row.kind])}>{WORD[row.kind]}</span>
      {row.group !== 'working' && (
        <span className="text-faint flex-none" title={new Date(row.since).toLocaleString()}>
          · {reportAge(row.since, Math.max(now, Date.now()))}
        </span>
      )}
    </span>
  )
}

/** The detail's head: where the workspace stands, its task, then its project and colour word. */
export function StageHead({
  now,
  onOpenChat,
  report,
  row,
}: {
  row: DeskRow
  report: Report | null
  now: number
  onOpenChat: (() => void) | null
}) {
  const ticket = report?.ticket ?? ''
  const earlier = report !== null && !isCurrent(row) ? REPORT_STATE[report.state].word : null
  return (
    <ReportHead
      title={row.title}
      stateLine={<DeskStateLine row={row} now={now} />}
      openTip="Go to its chat · ⌘↩"
      onOpenChat={onOpenChat}
      meta={
        <div className="text-faint mt-1.5 flex min-w-0 items-center gap-1.5 text-xs">
          <ProjectAvatar name={row.project} size="sm" />
          <span className="text-muted-foreground min-w-0 truncate">{row.project}</span>
          <span aria-hidden>·</span>
          <span className="flex-none">{row.colour}</span>
          {ticket !== '' && (
            <>
              <span aria-hidden>·</span>
              <TicketRef ticket={ticket} links={report?.links ?? []} />
            </>
          )}
          {earlier !== null && (
            <span className="flex-none" title="The chat has moved on since this report">
              · Report from earlier: {earlier}
            </span>
          )}
        </div>
      }
    />
  )
}

/** A workspace with no report: what its chats say, as the lead, under the same head. */
export function NoReport({ now, onOpen, row }: { row: DeskRow; now: number; onOpen: () => void }) {
  // A question or a tool the chat waits on is asked in the dock below, written once.
  const asks = row.kind === 'question' || row.kind === 'permission'
  const said = asks ? '' : (row.say?.trim() ?? '')
  return (
    <div className="@container/report min-h-0 flex-1 overflow-y-auto px-8 pt-6 pb-8 [&>*]:mx-auto [&>*]:max-w-[720px]">
      <div className="flex flex-col gap-4">
        <StageHead row={row} report={null} now={now} onOpenChat={onOpen} />
        <div className="block-in flex flex-col gap-2" style={{ '--i': 1 } as CSSProperties}>
          {row.group === 'working' && row.doing !== undefined && (
            <p className="text-foreground text-base">{row.doing}</p>
          )}
          {said !== '' && (
            <p className="text-muted-foreground text-base text-pretty break-words whitespace-pre-line select-text">
              {said}
            </p>
          )}
          <p className="text-faint text-sm">
            {asks
              ? 'No report: its chat asks you directly, below.'
              : 'No report yet. Its agent writes one when it needs you or has something to show.'}
          </p>
        </div>
      </div>
    </div>
  )
}

/** The detail with nothing selected: calm when nothing needs the user, a start when empty. */
export function Calm({ groups, onNew }: { groups: Groups; onNew: () => void }) {
  const total = groups.needs.length + groups.working.length + groups.quiet.length
  if (groups.needs.length > 0) {
    return (
      <div className="text-faint grid h-full place-items-center text-sm">
        Pick a workspace in the sidebar
      </div>
    )
  }
  const w = groups.working.length
  let line = 'Every agent of every project shows here, with what it needs from you.'
  if (total > 0) {
    line = `${w === 0 ? 'Every agent is resting.' : `${w} ${w === 1 ? 'agent is' : 'agents are'} at work.`} When one asks something or has something to show, it lands here.`
  }
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="flex max-w-[360px] flex-col items-center gap-1.5 text-center">
        <h2 className="block-in text-title font-semibold" style={{ '--i': 0 } as CSSProperties}>
          {total === 0 ? 'No workspaces yet' : 'Nothing needs you'}
        </h2>
        <p
          className="text-muted-foreground block-in text-sm text-balance"
          style={{ '--i': 1 } as CSSProperties}
        >
          {line}
        </p>
        <Button
          variant={total === 0 ? 'default' : 'secondary'}
          className="block-in mt-3"
          style={{ '--i': 2 } as CSSProperties}
          onClick={onNew}
        >
          New workspace
          <Kbd className={total === 0 ? 'text-white/60' : undefined}>⌘N</Kbd>
        </Button>
      </div>
    </div>
  )
}
