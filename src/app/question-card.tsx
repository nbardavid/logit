import { CheckIcon } from 'lucide-react'
import { type RefObject, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'

import type { Permission, Question } from '../chat/model'

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

const ROW =
  'flex w-full items-start gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors duration-120 ease-out hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring'

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

/** What Desk reaches into the card with: a digit picked from the list. */
export interface CardHandle {
  digit: (n: number) => void
}

/**
 * AskUserQuestion: Claude waits on a pick. One single-choice question answers on click;
 * otherwise the picks go with Submit (⌘↩). Decline (⌘⌫) and Claude goes on without.
 * `scoped` (Desk): the card answers only while the focus is in it, digits 1–9 pick, a click
 * picks without sending, Enter sends once something is picked, and Decline has no key.
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
  /** Desk: set to pick from outside the card. */
  handle?: RefObject<CardHandle | null>
}) {
  const [picked, setPicked] = useState<string[][]>(() => questions.map(() => []))
  const [other, setOther] = useState<string[]>(() => questions.map(() => ''))
  const answers = Object.fromEntries(
    questions.map((q, i) => [q.question, answerOf(q, picked[i] ?? [], other[i] ?? '')])
  )
  const complete = Object.values(answers).every((a) => a !== '')
  const instant = !scoped && questions.length === 1 && questions[0]?.multiSelect === false

  const submit = () => {
    if (complete && !disabled) onAnswer('allow', answers)
  }
  const pick = (i: number, q: Question, label: string) => {
    if (disabled) return
    if (instant) {
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
  /** Scoped, a digit picks in the question holding the focus, else the first unanswered. */
  const digit = (n: number) => {
    const holder = document.activeElement?.closest('fieldset')
    const fields = [...(card.current?.querySelectorAll('fieldset') ?? [])]
    const focused = holder ? fields.indexOf(holder) : -1
    const target = digitTarget(questions, Object.values(answers), focused, n)
    const q = target === null ? undefined : questions[target.question]
    if (target !== null && q !== undefined) pick(target.question, q, target.label)
  }
  if (handle !== undefined) handle.current = { digit }
  const keys = useRef({ digit, disabled, onAnswer, scoped, submit })
  keys.current = { digit, disabled, onAnswer, scoped, submit }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || keys.current.disabled) return
      const inside = card.current?.contains(document.activeElement) === true
      if (keys.current.scoped && !inside) return
      const typing =
        e.target instanceof HTMLInputElement && card.current?.contains(e.target) === true
      if (keys.current.scoped && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
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

  return (
    <div
      ref={card}
      className={cn(
        'flex flex-col transition-opacity duration-160',
        disabled && 'opacity-60',
        'gap-3 rounded-lg border bg-background px-3.5 py-3',
        // Desk: the composer's card, its parent brings it in; the chat's rises on its own.
        scoped
          ? 'border-border shadow-composer outline-none'
          : 'animate-in fade-in slide-in-from-bottom-[6px] border-line-strong duration-200 ease-out'
      )}
      aria-disabled={disabled || undefined}
      tabIndex={scoped ? -1 : undefined}
      role="alertdialog"
      aria-label={questions.length === 1 ? questions[0]?.question : 'Claude asks'}
      data-request={permission.requestId}
    >
      {questions.map((q, i) => (
        <fieldset key={q.question} className="flex flex-col gap-1.5" disabled={disabled}>
          <legend className="contents">
            {q.header !== '' && <span className="text-faint text-xs">{q.header}</span>}
            <span className={cn('font-semibold text-pretty', scoped ? 'text-md' : 'text-base')}>
              {q.question}
            </span>
          </legend>
          <div className="mt-0.5 flex flex-col gap-1">
            {q.options.map((o, n) => {
              const on = picked[i]?.includes(o.label) === true
              const { recommended, text } = splitRecommended(o.label)
              const tone = on ? 'border-line-strong bg-active hover:bg-active' : 'border-border'
              return (
                <button
                  key={o.label}
                  type="button"
                  role={q.multiSelect ? 'checkbox' : 'radio'}
                  aria-checked={on}
                  className={cn(ROW, tone)}
                  onClick={() => pick(i, q, o.label)}
                >
                  {/* Desk: the digit that picks it. */}
                  {scoped && n < 9 && (
                    <span
                      className={cn(
                        'w-3 flex-none text-xs leading-5 tabular-nums transition-colors duration-120 ease-out',
                        on ? 'text-foreground' : 'text-faint'
                      )}
                    >
                      {n + 1}
                    </span>
                  )}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-foreground flex items-center gap-1.5 text-sm leading-5 font-medium">
                      {text}
                      {recommended && (
                        <span className="bg-active text-muted-foreground rounded-sm px-1.5 text-xs font-normal">
                          Recommended
                        </span>
                      )}
                    </span>
                    {o.description !== '' && (
                      <span
                        className={cn(
                          'text-muted-foreground text-sm text-pretty',
                          // Desk on a short window: the labels alone, so the report keeps room.
                          scoped && '[@media(max-height:760px)]:hidden'
                        )}
                      >
                        {o.description}
                      </span>
                    )}
                  </span>
                  <CheckIcon
                    className={cn(
                      'mt-[3px] size-3.5 flex-none text-foreground transition-[opacity,scale] duration-160 ease-[var(--ease-settle)]',
                      on ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
                    )}
                  />
                </button>
              )
            })}
            <input
              className={cn(
                'border-border bg-background placeholder:text-faint focus:border-line-strong h-8 w-full rounded-md border px-2.5 text-sm outline-none transition-colors duration-120'
              )}
              placeholder={scoped ? 'Something else…' : 'Other…'}
              aria-label={`Other answer to ${q.question}`}
              value={other[i] ?? ''}
              onChange={(e) => {
                const text = e.target.value
                setOther((all) => all.map((o, j) => (j === i ? text : o)))
                if (!q.multiSelect && text !== '')
                  setPicked((all) => all.map((p, j) => (j === i ? [] : p)))
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.metaKey) {
                  e.preventDefault()
                  submit()
                }
              }}
            />
          </div>
        </fieldset>
      ))}
      {/* No button takes the focus: a key meant for the composer never answers. */}
      <div className="flex justify-end gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          className="disabled:opacity-100"
          aria-keyshortcuts={scoped ? undefined : 'Meta+Backspace'}
          disabled={disabled}
          onClick={() => onAnswer('deny')}
        >
          Decline
          {!scoped && <Kbd>⌘⌫</Kbd>}
        </Button>
        <Button
          size="sm"
          className="disabled:bg-line-strong disabled:opacity-100"
          aria-keyshortcuts="Meta+Enter"
          disabled={disabled || !complete}
          onClick={submit}
        >
          {scoped ? 'Send' : 'Submit'}
          <Kbd className="text-white/60">⌘↩</Kbd>
        </Button>
      </div>
    </div>
  )
}
