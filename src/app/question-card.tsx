import { ArrowUpIcon, PencilIcon } from 'lucide-react'
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'

import type { Permission, Question } from '../chat/model'

import { overlayShown } from './overlay'

/** What a question's picks send back: the labels (", " between), then what was typed. */
export function answerOf(q: Question, picked: string[], other: string): string {
  const typed = other.trim()
  if (!q.multiSelect) return typed || (picked[0] ?? '')
  return [...picked, ...(typed ? [typed] : [])].join(', ')
}

/** Claude marks its pick with "(Recommended)" (or "(recommandé)") at the end of a label. */
export function splitRecommended(label: string): { text: string; recommended: boolean } {
  const m = /\s*\((recommended|recommandé)\)\s*$/i.exec(label)
  return m
    ? { recommended: true, text: label.slice(0, m.index) }
    : { recommended: false, text: label }
}

/*
 * DESIGN.md › Option rows. One grouped list, a hairline between rows:
 *
 *   [1]  Label, 14/22 ink, wraps                         Recommended
 *        Description, 13/18 muted, wraps under the label
 */
const ROW =
  'group/opt grid w-full grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-x-3 px-3.5 py-2.5 text-left transition-colors duration-120 ease-out select-none not-disabled:hover:bg-hover not-disabled:active:bg-active disabled:cursor-default'

/** The option's number key: a small cap that inks once picked. */
const KEY =
  'mt-px grid size-5 place-items-center rounded-sm border text-xs font-medium tabular-nums transition-colors duration-160 ease-out [&_svg]:size-3'
const KEY_REST =
  'border-border bg-background text-faint group-not-disabled/opt:group-hover/opt:border-line-strong group-not-disabled/opt:group-hover/opt:text-foreground'
const KEY_ON = 'border-foreground bg-foreground text-background'

function OptionRow({
  checked,
  description,
  keycap,
  label,
  mark,
  multi,
  onPick,
}: {
  checked: boolean
  multi: boolean
  keycap: ReactNode
  label: string
  description: string
  mark?: ReactNode
  onPick: () => void
}) {
  return (
    <button
      type="button"
      role={multi ? 'checkbox' : 'radio'}
      aria-checked={checked}
      className={cn(ROW, checked && 'bg-chrome')}
      onClick={onPick}
    >
      <span aria-hidden className={cn(KEY, checked ? KEY_ON : KEY_REST)}>
        {keycap}
      </span>
      <span className="text-foreground min-w-0 text-base text-pretty break-words">{label}</span>
      {mark ?? <span />}
      {description !== '' && (
        <span className="text-muted-foreground col-span-2 col-start-2 min-w-0 text-sm text-pretty break-words">
          {description}
        </span>
      )}
    </button>
  )
}

/**
 * Which option a digit picks: in the question holding the focus (`focused`, -1 for none),
 * else the first one not answered yet, else the first. Null when it has no such option.
 */
export function digitTarget(
  questions: readonly Question[],
  answers: readonly string[],
  focused: number,
  n: number
): { question: number; label: string } | null {
  const open = answers.indexOf('')
  const i = Math.max(focused === -1 ? open : focused, 0)
  const label = questions[i]?.options[n - 1]?.label
  return label === undefined ? null : { label, question: i }
}

/**
 * The question a free answer goes to: the one holding the focus, else the first not answered
 * yet, else the last.
 */
export function freeTarget(answers: readonly string[], focused: number): number {
  if (focused !== -1) return focused
  const open = answers.indexOf('')
  return open === -1 ? answers.length - 1 : open
}

/** Whether a bare digit picks, in a chat: never from a field (the composer types it). */
export function digitPicks(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return true
  return !(
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  )
}

/** A composer line that is only option numbers ("2", "1 3", "1, 3"): those numbers. */
export function numbersOf(line: string): number[] | null {
  const text = line.trim()
  if (!/^[1-9](\s*[,\s]\s*[1-9])*$/.test(text)) return null
  return [...text.matchAll(/[1-9]/g)].map((m) => Number(m[0]))
}

/** What Desk and the composer reach into the card with. */
export interface CardHandle {
  /** A digit typed outside the card: picks that option, without sending. */
  digit: (n: number) => void
  /** Option numbers sent from the composer: picked, then sent once every question has one. */
  numbers: (ns: number[]) => void
  /** Sends what is picked, if every question has an answer. */
  submit: () => void
  /** A free answer from the composer: as "Something else…", then sent once complete. */
  type: (text: string) => void
}

/**
 * AskUserQuestion: Claude waits on a pick. One single-choice question answers on click;
 * otherwise the picks go with Send (⌘↩). Skip (⌘⌫) declines and Claude goes on without. In a
 * chat, the question reads in the text column, its options one grouped list ending on a
 * "Something else…" field; 1–9 pick from anywhere but a field, and the composer answers too: Enter alone sends the picks, a
 * number ("2", "1 3") picks and sends, and words are a free answer (a row of its own until
 * the other questions are answered).
 * `scoped` (Desk): the dock's card, with its own free-answer line at the bottom, as the
 * composer's. It answers only while the focus is in it, digits 1–9 pick, a click picks without
 * sending, Enter sends once something is picked, and Skip has no key.
 */
export function QuestionCard({
  disabled,
  handle,
  onAnswer,
  permission,
  questions,
  scoped = false,
}: {
  permission: Permission
  questions: Question[]
  disabled: boolean
  onAnswer: (choice: 'allow' | 'deny', answers?: Record<string, string>) => void
  scoped?: boolean
  /** Set to pick, send or answer from outside the card. */
  handle?: RefObject<CardHandle | null>
}) {
  const [picked, setPicked] = useState<string[][]>(() => questions.map(() => []))
  const [other, setOther] = useState<string[]>(() => questions.map(() => ''))
  const answersWith = (picks: string[][], typed: string[]) =>
    Object.fromEntries(
      questions.map((q, i) => [q.question, answerOf(q, picks[i] ?? [], typed[i] ?? '')])
    )
  const answers = answersWith(picked, other)
  const complete = Object.values(answers).every((a) => a !== '')
  const instant = !scoped && questions.length === 1 && questions[0]?.multiSelect === false

  const submit = () => {
    if (complete && !disabled) onAnswer('allow', answers)
  }
  /** `fromKey`: a digit only selects, so a stray one never answers for the user. */
  const pick = (i: number, q: Question, label: string, fromKey = false) => {
    if (disabled) return
    if (instant && !fromKey) {
      // The pick inks at once, while the answer goes.
      setPicked([[label]])
      onAnswer('allow', { [q.question]: label })
      return
    }
    setPicked((all) =>
      all.map((p, j) => {
        if (j !== i) return p
        if (!q.multiSelect) return [label]
        return p.includes(label) ? p.filter((l) => l !== label) : [...p, label]
      })
    )
    // A single choice is the option or the typed answer, not both.
    if (!q.multiSelect) setOther((all) => all.map((o, j) => (j === i ? '' : o)))
  }

  // ⌘↩ and ⌘⌫ from anywhere in the chat, as on a permission; ⌘⌫ in a field edits it.
  const card = useRef<HTMLDivElement>(null)
  const focusedQuestion = () => {
    const holder = document.activeElement?.closest('fieldset')
    const fields = [...(card.current?.querySelectorAll('fieldset') ?? [])]
    return holder ? fields.indexOf(holder) : -1
  }
  /** A digit picks in the question holding the focus, else the first unanswered. */
  const digit = (n: number) => {
    const target = digitTarget(questions, Object.values(answers), focusedQuestion(), n)
    const q = target === null ? undefined : questions[target.question]
    if (target !== null && q !== undefined) pick(target.question, q, target.label, true)
  }
  const type = (text: string) => {
    if (disabled) return
    const i = freeTarget(Object.values(answers), focusedQuestion())
    const q = questions[i]
    if (q === undefined) return
    const typed = other.map((o, j) => (j === i ? text : o))
    const picks = q.multiSelect ? picked : picked.map((p, j) => (j === i ? [] : p))
    const next = answersWith(picks, typed)
    if (Object.values(next).every((a) => a !== '')) onAnswer('allow', next)
    else {
      setOther(typed)
      setPicked(picks)
    }
  }
  const numbers = (ns: number[]) => {
    if (disabled) return
    const target = digitTarget(questions, Object.values(answers), focusedQuestion(), ns[0] ?? 0)
    const q = target === null ? undefined : questions[target.question]
    if (target === null || q === undefined) return
    const i = target.question
    // A single choice takes the last number; several choices take them all (once each).
    const labels = q.multiSelect ? [...new Set(ns)] : ns.slice(-1)
    const picks = picked.map((p, j) =>
      j === i
        ? labels.flatMap((n) => {
            const label = q.options[n - 1]?.label
            return label === undefined ? [] : [label]
          })
        : p
    )
    const typed = other.map((o, j) => (j === i ? '' : o))
    const next = answersWith(picks, typed)
    if (Object.values(next).every((a) => a !== '')) onAnswer('allow', next)
    else {
      setPicked(picks)
      setOther(typed)
    }
  }
  if (handle !== undefined) handle.current = { digit, numbers, submit, type }
  const keys = useRef({ digit, disabled, onAnswer, scoped, submit })
  keys.current = { digit, disabled, onAnswer, scoped, submit }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Answered and folding away (`inert`), it takes no more keys.
      if (e.defaultPrevented || keys.current.disabled || card.current?.closest('[inert]')) return
      const inside = card.current?.contains(document.activeElement) === true
      if (keys.current.scoped && !inside) return
      const typing =
        e.target instanceof HTMLInputElement && card.current?.contains(e.target) === true
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey
      if (keys.current.scoped && !typing && plain) {
        if (e.key === 'Enter') {
          // On an option not picked yet, Enter picks it (its click); else it sends.
          const on = e.target instanceof HTMLElement ? e.target.closest('[aria-checked]') : null
          if (on?.getAttribute('aria-checked') === 'false') return
          e.preventDefault()
          keys.current.submit()
          return
        }
        if (!/^[1-9]$/.test(e.key)) return
        e.preventDefault()
        keys.current.digit(Number(e.key))
        return
      }
      if (!keys.current.scoped && plain && /^[1-9]$/.test(e.key)) {
        if (overlayShown() || !digitPicks(e.target)) return
        e.preventDefault()
        keys.current.digit(Number(e.key))
        return
      }
      if (!e.metaKey) return
      if (e.key === 'Enter' && !e.shiftKey) keys.current.submit()
      else if (e.key === 'Backspace' && !typing && !keys.current.scoped)
        keys.current.onAnswer('deny')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const several = questions.length > 1
  const done = Object.values(answers).filter((a) => a !== '').length
  const clearOther = (i: number) => setOther((all) => all.map((o, j) => (j === i ? '' : o)))

  // The card's own free answer (the composer answers too, in a chat).
  const [draft, setDraft] = useState('')
  const commit = () => {
    const text = draft.trim()
    if (text === '') submit()
    else {
      type(text)
      setDraft('')
    }
  }

  let hint = ''
  if (disabled) hint = 'Claude is stopping…'
  else if (several) hint = `${done} of ${questions.length} answered`

  // The free answer, Skip and send: the dock's foot in Desk, the last row of the list in a chat.
  // Nothing in it takes the focus on its own: a key meant for the composer never answers.
  const foot = (
    <form
      className={cn(
        'flex min-w-0 items-center gap-1.5 py-1.5 pr-1.5 pl-3.5',
        scoped ? 'border-t' : 'bg-background'
      )}
      onSubmit={(e) => {
        e.preventDefault()
        commit()
      }}
    >
      <input
        className="placeholder:text-faint h-8 min-w-0 flex-1 bg-transparent text-base outline-none select-text focus-visible:outline-none"
        placeholder={hint === '' ? 'Something else…' : `${hint} · Something else…`}
        aria-label="Something else"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // ↩ and ⌘↩ both send: what is written, else what is picked.
          if (e.key !== 'Enter' || e.shiftKey) return
          e.preventDefault()
          commit()
        }}
      />
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        aria-keyshortcuts={scoped ? undefined : 'Meta+Backspace'}
        onClick={() => onAnswer('deny')}
      >
        Skip
        {!scoped && <Kbd className="@max-[420px]:hidden">⌘⌫</Kbd>}
      </Button>
      <Button
        type="submit"
        size="icon"
        className="disabled:bg-line-strong rounded-md disabled:opacity-100"
        aria-label={scoped ? 'Send (Enter)' : 'Send (⌘↩)'}
        aria-keyshortcuts={scoped ? undefined : 'Meta+Enter'}
        disabled={disabled || (!complete && draft.trim() === '')}
      >
        <ArrowUpIcon strokeWidth={2} />
      </Button>
    </form>
  )

  return (
    <div
      ref={card}
      className={cn(
        '@container flex flex-col transition-opacity duration-160 ease-out',
        disabled && 'opacity-60',
        // Desk: the dock's card, its parent brings it in. The chat's rises with the transcript.
        scoped
          ? 'border-border bg-background shadow-composer rounded-lg border outline-none'
          : 'animate-in fade-in slide-in-from-bottom-[6px] gap-2 duration-280 ease-[var(--ease-settle)]'
      )}
      aria-disabled={disabled || undefined}
      tabIndex={scoped ? -1 : undefined}
      role="alertdialog"
      aria-label={questions.length === 1 ? questions[0]?.question : 'Claude asks'}
      data-question
      data-request={permission.requestId}
    >
      <div className={cn('flex flex-col', scoped ? 'gap-0' : 'gap-5')}>
        {questions.map((q, i) => {
          const eyebrow = [q.header, q.multiSelect ? 'Pick any' : ''].filter((s) => s !== '')
          const typed = other[i] ?? ''
          return (
            <fieldset
              key={q.question}
              className={cn('flex min-w-0 flex-col', scoped ? 'not-first:border-t' : 'gap-2.5')}
              disabled={disabled}
            >
              <legend className="contents">
                <span
                  className={cn('flex min-w-0 flex-col gap-0.5', scoped && 'px-3.5 pt-3 pb-2.5')}
                >
                  {eyebrow.length > 0 && (
                    <span className="text-faint text-xs font-medium">{eyebrow.join(' · ')}</span>
                  )}
                  <span className="text-foreground text-md font-medium text-pretty break-words select-text">
                    {q.question}
                  </span>
                </span>
              </legend>
              <div
                className={cn(
                  'divide-border flex flex-col divide-y overflow-hidden',
                  scoped ? 'border-t' : 'bg-background rounded-lg border'
                )}
              >
                {q.options.map((o, n) => {
                  const { recommended, text } = splitRecommended(o.label)
                  return (
                    <OptionRow
                      key={o.label}
                      checked={picked[i]?.includes(o.label) === true}
                      multi={q.multiSelect}
                      keycap={n < 9 ? n + 1 : ''}
                      label={text}
                      description={o.description}
                      mark={
                        recommended ? (
                          <span className="text-faint text-xs leading-[22px] whitespace-nowrap">
                            Recommended
                          </span>
                        ) : undefined
                      }
                      onPick={() => pick(i, q, o.label)}
                    />
                  )
                })}
                {/* A free answer written while other questions wait: picked, as an option is. */}
                {typed !== '' && (
                  <div className="animate-in fade-in slide-in-from-top-[2px] duration-160 ease-out">
                    <OptionRow
                      checked
                      multi={q.multiSelect}
                      keycap={<PencilIcon strokeWidth={2} />}
                      label={typed}
                      description="Your own answer · click to take it back"
                      onPick={() => clearOther(i)}
                    />
                  </div>
                )}
                {!scoped && i === questions.length - 1 && foot}
              </div>
            </fieldset>
          )
        })}
      </div>
      {scoped && foot}
    </div>
  )
}
