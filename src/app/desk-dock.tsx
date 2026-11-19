// What answers the selected workspace in Desk: its question's card, the last thing in its
// report; or the dock pinned under the report (a reply, a permission, an offer), slim.
import { openUrl } from '@tauri-apps/plugin-opener'
import { ArrowUpIcon, ArrowUpRightIcon, MessageSquareIcon } from 'lucide-react'
import { type ReactNode, type RefObject, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'

import type { DeskRow } from './desk-model'
import type { ChatTab, useChats } from './use-chats'

import { type Permission, questionsOf, toolSummary } from '../chat/model'
import { isWebUrl, openChoice, type Report } from '../model/report'
import { type CardHandle, QuestionCard } from './question-card'

export type Hub = Pick<ReturnType<typeof useChats>, 'answer' | 'chats' | 'openSession' | 'send'>

/** The chat a workspace waits in: one asking a question first, else one asking anything. */
export function waitingChat(chats: readonly ChatTab[], wsId: string) {
  const own = chats.filter((c) => c.record.workspaceId === wsId && c.state.pending.length > 0)
  return own.find((c) => c.state.pending.some((p) => p.toolName === 'AskUserQuestion')) ?? own[0]
}

/** The permission a chat waits on, a question's before any other. */
export const waitOf = (chat: ChatTab | undefined): Permission | undefined =>
  chat?.state.pending.find((p) => p.toolName === 'AskUserQuestion') ?? chat?.state.pending[0]

/** Where a reply goes: the report's chat when it is open, else the workspace's latest. */
export function replyChat(chats: readonly ChatTab[], row: DeskRow) {
  const own = chats.filter((c) => c.record.workspaceId === row.id)
  const writer = own.find((c) => c.record.id === row.report?.chatId)
  const latest = own.toSorted(
    (a, b) => (b.record.activeAt ?? b.record.createdAt) - (a.record.activeAt ?? a.record.createdAt)
  )[0]
  return writer ?? latest
}

/** The question a workspace's chat waits on, with that chat: null when none is asked. */
export function askOf(chats: readonly ChatTab[], wsId: string) {
  const chat = waitingChat(chats, wsId)
  const wait = waitOf(chat)
  const questions = wait === undefined ? null : questionsOf(wait)
  return chat === undefined || wait === undefined || questions === null
    ? null
    : { chat, questions, wait }
}

/** The question's card, as Desk draws it at the end of the report. */
export function DeskQuestion({
  ask,
  card,
  deliver,
  hub,
}: {
  ask: NonNullable<ReturnType<typeof askOf>>
  card: RefObject<CardHandle | null>
  deliver: (run: () => Promise<void>) => void
  hub: Hub
}) {
  const { chat, questions, wait } = ask
  return (
    <QuestionCard
      key={wait.requestId}
      scoped
      handle={card}
      permission={wait}
      questions={questions}
      disabled={false}
      onAnswer={(choice, answers) =>
        deliver(async () => hub.answer(chat.record.id, wait, choice, answers))
      }
    />
  )
}

/** The card every answer sits on: the chat composer's, white with its hairline and shadow. */
const DOCK = 'rounded-lg border border-border bg-background shadow-composer'

/** The reply box: one line, and the ink button that sends. */
function ReplyBox({
  aside,
  label,
  onSend,
  placeholder,
}: {
  placeholder: string
  label: string
  onSend: (text: string) => void
  /** Beside the box: Open chat. */
  aside?: ReactNode
}) {
  const [draft, setDraft] = useState('')
  const send = () => {
    const text = draft.trim()
    if (text === '') return
    onSend(text)
    setDraft('')
  }
  const empty = draft.trim() === ''
  return (
    <form
      className="flex min-w-0 items-center gap-1.5 py-1.5 pr-1.5 pl-3.5"
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
    >
      <input
        className="placeholder:text-faint h-8 min-w-0 flex-1 bg-transparent text-base outline-none select-text focus-visible:outline-none"
        placeholder={placeholder}
        aria-label={label}
        value={draft}
        data-answer
        data-draft={empty ? 'empty' : 'full'}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // ↩ and ⌘↩ both send what is written.
          if (e.key !== 'Enter' || e.shiftKey) return
          e.preventDefault()
          send()
        }}
      />
      {aside}
      <Button
        type="submit"
        size="icon"
        className="disabled:bg-line-strong rounded-md disabled:opacity-100"
        aria-label="Send (Enter)"
        disabled={empty}
      >
        <ArrowUpIcon strokeWidth={2} />
      </Button>
    </form>
  )
}

/** A line over the reply box: what is on offer, and its one action as the ink button. */
function Offer({ action, children }: { children: ReactNode; action: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3 border-b py-1.5 pr-1.5 pl-3.5">
      <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">{children}</span>
      {action}
    </div>
  )
}

/** A permission the chat waits on: what it runs, Deny or Allow. */
function PermissionAsk({
  chat,
  onAnswer,
  wait,
}: {
  chat: ChatTab
  wait: Permission
  onAnswer: (choice: 'allow' | 'deny') => void
}) {
  const what = toolSummary(wait.toolName, wait.input, chat.cwd) || (wait.description ?? '')
  return (
    <section
      tabIndex={-1}
      role="alertdialog"
      aria-label={`Allow ${wait.toolName}?`}
      className={cn(DOCK, 'flex flex-col gap-3 px-3.5 py-3 outline-none')}
    >
      <div className="flex flex-col">
        <span className="text-faint text-xs">Claude wants to run a tool</span>
        <span className="text-md font-semibold">Allow {wait.toolName}?</span>
      </div>
      {what !== '' && (
        <code className="bg-chrome text-muted-foreground max-h-[96px] overflow-auto rounded-md border px-2.5 py-2 font-mono text-xs leading-5 wrap-anywhere whitespace-pre-wrap select-text">
          {what}
        </code>
      )}
      <div className="flex justify-end gap-1.5">
        <Button variant="secondary" size="sm" onClick={() => onAnswer('deny')}>
          Deny
        </Button>
        <Button size="sm" onClick={() => onAnswer('allow')}>
          Allow
          <Kbd className="text-white/60">⌘↩</Kbd>
        </Button>
      </div>
    </section>
  )
}

const prLink = (report: Report | null) =>
  report?.links.find((l) => isWebUrl(l.url) && /github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(l.url))

/** What the dock's keys reach: ⌘↩ its main action. */
export interface DockKeys {
  primary?: { label: string; run: () => void }
}

/**
 * What answers a workspace from the Desk, pinned under its report: one action per kind. A
 * question is not one of them: its card ends the report (`DeskQuestion`).
 */
export function Answer({
  chats,
  deliver,
  hub,
  keys,
  onOpen,
  onReopen,
  reopening,
  report,
  row,
}: {
  row: DeskRow
  report: Report | null
  chats: readonly ChatTab[]
  hub: Hub
  /** Runs a send at once: the row moves on once it went, or shows why it did not. */
  deliver: (run: () => Promise<void>) => void
  keys: RefObject<DockKeys>
  onOpen: (chatId: string | null) => void
  onReopen: () => void
  reopening: boolean
}) {
  const waiting = waitingChat(chats, row.id)
  const wait = waitOf(waiting)
  const questions = wait === undefined ? null : questionsOf(wait)
  keys.current = {}
  if (questions !== null) return null
  if (waiting !== undefined && wait !== undefined) {
    const answer = (choice: 'allow' | 'deny') =>
      deliver(async () => hub.answer(waiting.record.id, wait, choice))
    keys.current = { primary: { label: 'Allow', run: () => answer('allow') } }
    return <PermissionAsk key={wait.requestId} chat={waiting} wait={wait} onAnswer={answer} />
  }
  const target = replyChat(chats, row)
  if (target === undefined) {
    keys.current = { primary: { label: 'Reopen', run: onReopen } }
    return (
      <div className={cn(DOCK, 'flex items-center gap-3 py-1.5 pr-1.5 pl-3.5')}>
        <span className="text-muted-foreground min-w-0 flex-1 text-sm">
          Its chat is closed. Reopen it to answer from here.
        </span>
        <Button size="sm" disabled={reopening} onClick={onReopen}>
          {reopening ? 'Reopening…' : 'Reopen'}
          <Kbd className="text-white/60">⌘↩</Kbd>
        </Button>
      </div>
    )
  }
  const send = (text: string) => deliver(async () => hub.send(target.record.id, text))
  let action: ReactNode = null
  if (row.kind === 'review') {
    const run = () => send('Looks good, open the PR')
    keys.current = { primary: { label: 'Looks good', run } }
    action = (
      <Offer
        action={
          <Button size="sm" onClick={run}>
            Looks good, open the PR
            <Kbd className="text-white/60">⌘↩</Kbd>
          </Button>
        }
      >
        Happy with these screens?
      </Offer>
    )
  } else if (row.kind === 'ready' && prLink(report) !== undefined) {
    const url = prLink(report)?.url ?? ''
    const run = () => void openUrl(url)
    keys.current = { primary: { label: 'Open PR', run } }
    action = (
      <Offer
        action={
          <Button size="sm" onClick={run} title={url}>
            Open the PR
            <ArrowUpRightIcon />
            <Kbd className="text-white/60">⌘↩</Kbd>
          </Button>
        }
      >
        The pull request is ready for you.
      </Offer>
    )
  }
  // A question the report asks with none pending in the chat: its text heads the reply.
  const asked = report?.state === 'question' ? openChoice(report.choices)?.text : undefined
  if (action === null && asked !== undefined) {
    return (
      <section aria-label={asked} className={cn(DOCK, 'flex flex-col')}>
        <div className="flex flex-col border-b px-3.5 pt-3 pb-2.5">
          <span className="text-faint text-xs">Claude asks</span>
          <span className="text-md font-semibold text-pretty break-words select-text">{asked}</span>
        </div>
        <ReplyBox
          key={target.record.id}
          placeholder="Reply to Claude…"
          label={`Message ${row.colour}`}
          onSend={(text) => send(text)}
        />
      </section>
    )
  }
  return (
    <div className={cn(DOCK, 'flex flex-col')}>
      {action}
      <ReplyBox
        key={target.record.id}
        placeholder={row.kind === 'question' ? 'Reply to Claude…' : `Message ${row.colour}…`}
        label={`Message ${row.colour}`}
        onSend={(text) => send(text)}
        aside={
          row.report === null || row.kind === 'finished' ? (
            <Button variant="ghost" size="sm" onClick={() => onOpen(target.record.id)}>
              <MessageSquareIcon />
              Open chat
            </Button>
          ) : null
        }
      />
    </div>
  )
}
