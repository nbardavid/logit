import { cn } from '@/lib/utils'

import type { Signal } from '../model/catalog'

import { BrailleDots } from './braille-spinner'
import { useEnter } from './enter'
import { useLoaderChoice } from './loader-choice'

const LABEL: Record<Signal, string> = {
  done: 'Done',
  waiting: 'Waiting for you',
  working: 'Working',
}

// `.breathe` and the `pop` keyframes live in styles.css; `working` is a braille loader.
const TONE = {
  done: 'bg-good',
  failing: 'bg-critical',
  idle: 'bg-neutral',
  waiting: 'bg-warn breathe',
  working: '',
} as const

/** A done dot that arrives pops in; one already there when its surface drew stays still. */
const POP = 'animate-[pop_0.3s_cubic-bezier(0.2,0,0,1)]'

export type Tone = keyof typeof TONE

/** A status dot's classes: 6px, round, coloured by what it says (not for `working`). */
export const dotClass = (tone: Exclude<Tone, 'working'>, className?: string) =>
  cn('size-1.5 flex-none rounded-full', TONE[tone], className)

/** The braille loader Settings › Appearance picked for statuses, drawn as ink dots. */
function Working(a11y: { 'aria-label'?: string; 'role'?: string }) {
  const { status } = useLoaderChoice()
  return (
    <span {...a11y} className="text-foreground grid size-[11px] flex-none place-items-center">
      <BrailleDots loader={status} />
    </span>
  )
}

/** A status dot, or for `working` the status loader, 11px square. */
export function Dot({ label, tone }: { tone: Tone; label?: string }) {
  const a11y = label === undefined ? {} : { 'aria-label': label, 'role': 'img' }
  const enter = useEnter()
  if (tone === 'working') return <Working {...a11y} />
  return <span {...a11y} className={dotClass(tone, tone === 'done' && enter ? POP : undefined)} />
}

/** A dot alone where space is tight; `withLabel` adds the word. */
export function StatusDot({ signal, withLabel = false }: { signal: Signal; withLabel?: boolean }) {
  const dot = <Dot tone={signal} label={withLabel ? undefined : LABEL[signal]} />
  if (!withLabel) return dot
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs font-medium">
      {dot}
      {LABEL[signal]}
    </span>
  )
}
