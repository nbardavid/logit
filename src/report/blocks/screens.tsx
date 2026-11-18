import { cn } from '@/lib/utils'

import type { ScreensBlock, ScreenStep } from './types'

import { BlockHead, has, useBlockActions } from './primitives'

const SIDE_WORD = { after: 'After', before: 'Before' } as const

type Side = 'before' | 'after'

/** One screen in its rounded frame: a click shows it larger. */
function Frame({
  onOpen,
  side,
  src,
  word,
}: {
  side: Side
  src: string | undefined
  word: string | null
  onOpen: ((from: HTMLButtonElement) => void) | null
}) {
  if (!has(src)) {
    return (
      <div className="bg-chrome border-border text-faint hidden aspect-[16/10] place-items-center rounded-lg border border-dashed text-xs @min-[420px]/report:grid">
        No {side} screen
      </div>
    )
  }
  return (
    <figure className="group/frame min-w-0">
      <button
        type="button"
        disabled={onOpen === null}
        className="frame bg-background block w-full cursor-zoom-in overflow-hidden rounded-lg disabled:cursor-default"
        aria-label={`${word ?? 'Screen'}: view larger`}
        onClick={(e) => onOpen?.(e.currentTarget)}
      >
        <img
          src={src}
          alt={word ?? 'Screen'}
          draggable={false}
          loading="lazy"
          className="block aspect-[16/10] w-full object-cover object-top"
        />
      </button>
      {word !== null && (
        <figcaption className="mt-2 flex items-center gap-1.5 text-xs leading-4">
          <span
            className={cn(
              'size-1.5 rounded-full',
              side === 'after' ? 'bg-foreground' : 'bg-line-strong'
            )}
          />
          <span
            className={side === 'after' ? 'text-foreground font-medium' : 'text-muted-foreground'}
          >
            {word}
          </span>
        </figcaption>
      )}
    </figure>
  )
}

function Step({
  i,
  n,
  step,
  steps,
}: {
  step: ScreenStep
  i: number
  n: number
  steps: ScreenStep[]
}) {
  const { onZoom } = useBlockActions()
  const sides = (['before', 'after'] as const).filter((s) => has(step[s]))
  const pair = sides.length === 2
  return (
    <div className="flex flex-col gap-2">
      {(has(step.caption) || n > 1) && (
        <p className="flex gap-2 text-sm leading-5">
          {n > 1 && <span className="text-faint w-3 flex-none tabular-nums">{i + 1}</span>}
          <span className="text-foreground min-w-0 font-medium break-words select-text">
            {step.caption}
          </span>
        </p>
      )}
      <div className={cn('grid gap-3', pair ? '@min-[420px]/report:grid-cols-2' : 'max-w-[560px]')}>
        {(pair ? (['before', 'after'] as const) : sides).map((side) => (
          <Frame
            key={side}
            side={side}
            src={step[side]}
            word={pair ? SIDE_WORD[side] : null}
            onOpen={onZoom === undefined ? null : (from) => onZoom({ side, step: i, steps }, from)}
          />
        ))}
      </div>
    </div>
  )
}

/** Screens: one before/after pair, one screen alone, or a flow of numbered steps. */
export function Screens({ steps, title = 'Screens' }: Omit<ScreensBlock, 'kind'>) {
  const list = steps.filter((s) => has(s.before) || has(s.after) || has(s.caption))
  if (list.length === 0) return null
  return (
    <section>
      <BlockHead count={list.length > 1 ? `${list.length} steps` : undefined}>{title}</BlockHead>
      <div className="flex flex-col gap-5">
        {list.map((s, i) => (
          // oxlint-disable-next-line no-array-index-key -- steps are in order and may repeat
          <Step key={i} step={s} i={i} n={list.length} steps={list} />
        ))}
      </div>
    </section>
  )
}
