// The frame every connected card shares (a PR today; a ticket, a file, a table later), in a
// chat or a report alike. DESIGN.md › Cards holds its anatomy, spacing, states and motion.
//
//   ┌──────────────────────────────────────────────────────────────┐
//   │ [tile]  Title, one line, opens the thing          [ action ] │  14 / 22, medium
//   │         meta · meta · meta (wraps when narrow)               │  12 / 16, faint
//   ├──────────────────────────────────────────────────────────────┤
//   │ notice: what failed and what to do                  Retry    │  12 / 16, on a wash
//   └──────────────────────────────────────────────────────────────┘
import { type ReactNode, useRef } from 'react'

import { cn } from '@/lib/utils'

/** The tile's tones: a neutral chip, or a wash when the thing is done or failing. */
const TILE = {
  done: 'bg-good-wash text-good border-[color:color-mix(in_srgb,var(--good)_16%,var(--border))]',
  failing:
    'bg-critical-wash text-critical border-[color:color-mix(in_srgb,var(--critical)_16%,var(--border))]',
  faint: 'bg-chrome text-faint',
  neutral: 'bg-chrome text-foreground',
} as const

export type TileTone = keyof typeof TILE

/** A swap in place (a label, a status, a line): a fade, nothing moves. */
export const SWAP = 'animate-in fade-in duration-160 ease-out'

/** A skeleton bar, centred in a line of `line` px; a slow breath, still when motion is reduced. */
export function Bar({ className }: { className: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'bg-active block h-2.5 animate-pulse rounded-full motion-reduce:animate-none',
        className
      )}
    />
  )
}

/**
 * One card. `title` and `meta` are its two lines; `action` sits at the right, centred on
 * them; `notice` folds open under them. Below 420px of card the tile goes and the title may
 * take two lines; below 320px the action moves under the text.
 */
export function CardFrame({
  action,
  className,
  label,
  meta,
  notice,
  tile,
  tileTone = 'neutral',
  title,
}: {
  /** What a screen reader hears for the whole card. */
  label: string
  tile: ReactNode
  tileTone?: TileTone
  title: ReactNode
  meta: ReactNode
  action?: ReactNode
  notice?: { tone: 'critical' | 'quiet'; body: ReactNode; aside?: ReactNode } | null
  className?: string
}) {
  // The last notice stays drawn while it folds away.
  const last = useRef(notice)
  if (notice) last.current = notice
  const shown = notice ?? last.current
  return (
    <section
      aria-label={label}
      className={cn(
        '@container/card border-border bg-background overflow-hidden rounded-lg border select-none',
        className
      )}
    >
      <div className="flex min-h-16 items-center gap-3 px-3.5 py-3 @max-[320px]/card:flex-wrap">
        <span
          aria-hidden
          className={cn(
            'grid size-8 flex-none place-items-center rounded-md border border-transparent transition-colors duration-160 ease-out @max-[420px]/card:hidden [&_svg]:size-4',
            TILE[tileTone]
          )}
        >
          {tile}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* Narrow, the title may take two lines rather than end after a few words. */}
          <div className="flex min-h-[22px] min-w-0 items-center gap-1.5 text-base leading-5.5 @max-[420px]/card:items-baseline">
            {title}
          </div>
          <div className="text-faint min-h-4 text-xs">{meta}</div>
        </div>
        {/* Narrower still (a slim right panel), the action goes under the text. */}
        {action !== undefined && (
          <div className="flex flex-none items-center @max-[320px]/card:w-full">{action}</div>
        )}
      </div>
      {/* Folds open (180ms, height and fade): nothing under the card jumps. */}
      <div
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-180 ease-in-out',
          notice ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        )}
        inert={!notice}
      >
        <div className="min-h-0 overflow-hidden">
          {shown && (
            <div
              role={shown.tone === 'critical' ? 'alert' : undefined}
              className={cn(
                'flex min-h-9 items-center gap-3 border-t py-1.5 pr-2 pl-3.5 text-xs leading-4',
                shown.tone === 'critical'
                  ? 'bg-critical-wash text-critical-ink border-[color:color-mix(in_srgb,var(--critical)_14%,var(--border))]'
                  : 'bg-chrome text-muted-foreground'
              )}
            >
              <span className="min-w-0 flex-1 py-0.5 select-text">{shown.body}</span>
              {shown.aside}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

/** Meta items in a row, wrapping when narrow; each item keeps its icon with its words. */
export function MetaRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 leading-4">
      {children}
    </div>
  )
}

export function MetaItem({
  children,
  className,
  title,
}: {
  children: ReactNode
  className?: string
  title?: string
}) {
  return (
    <span
      className={cn('flex min-w-0 items-center gap-1.5 whitespace-nowrap', className)}
      title={title}
    >
      {children}
    </span>
  )
}
