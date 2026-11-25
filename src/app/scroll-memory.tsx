// A chat keeps where it was read: switched back to, it opens on the same exchange at the same
// height, and what Claude wrote meanwhile shows as "N new" on the ↓ button.
import { ChevronDownIcon } from 'lucide-react'
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

import type { Turn } from '../chat/model'

/** Where a chat was left: the exchange at the top of the view and how far into it. */
export interface Spot {
  /** Following the bottom: it comes back there. */
  pinned: boolean
  /** The exchange at the top of the view, and its top's offset from the view's (px). */
  anchor: { key: string; offset: number } | null
  /** The scroll offset, if the anchor is gone. */
  top: number
  /** The first exchange built (the window), so the anchor is there again. */
  first: number
  /** How many messages Claude had written: more since, and a pill says how many. */
  spoken: number
}

/** Each chat's spot, kept for the window's life: a chat switched back to opens where it was. */
const spots = new Map<string, Spot>()

/** What Claude has written in a chat, counted in messages: its text blocks. */
export function spokenCount(turns: readonly Turn[]): number {
  let n = 0
  for (const t of turns)
    if (t.role === 'assistant') for (const b of t.blocks) if (b.kind === 'text') n += 1
  return n
}

/** The pill's words for what came in below while the reader was up: "3 new", "1 new". */
export const newLabel = (n: number) => `${n} new`

/** Where the chat `memory` was left, if it was left scrolled up (null: at the bottom). */
export function useLeftSpot(memory: string | undefined): Spot | null {
  const [left] = useState(() => {
    const spot = memory === undefined ? undefined : spots.get(memory)
    return spot?.pinned === false ? spot : null
  })
  return left
}

/** The exchange at the top of `el`'s view, and how far below the view's top it starts. */
function anchorIn(el: HTMLElement): Spot['anchor'] {
  const view = el.getBoundingClientRect().top
  for (const node of el.querySelectorAll<HTMLElement>('[data-exchange]')) {
    const box = node.getBoundingClientRect()
    if (box.bottom > view) return { key: node.dataset.exchange ?? '', offset: box.top - view }
  }
  return null
}

/**
 * Restores `left` once, keeps the spot as the reader scrolls (`keep`, once per frame), saves it
 * when the chat goes, and counts what Claude wrote since the reader left the bottom (`fresh`).
 * Exchanges carry `data-exchange` with their key.
 */
export function useScrollMemory(o: {
  memory: string | undefined
  left: Spot | null
  scroller: RefObject<HTMLElement | null>
  /** Called after the restore, with the scroller (the column's size to remember). */
  restored: (el: HTMLElement) => void
  first: number
  following: boolean
  turns: readonly Turn[]
}) {
  const { first, following, left, memory, scroller } = o
  const spoken = spokenCount(o.turns)
  const [seen, setSeen] = useState(() => left?.spoken ?? spoken)
  if (following && seen !== spoken) setSeen(spoken)
  const fresh = following ? 0 : Math.max(0, spoken - seen)

  const restored = useRef(o.restored)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || left === null) return
    const at =
      left.anchor === null
        ? null
        : el.querySelector<HTMLElement>(`[data-exchange="${CSS.escape(left.anchor.key)}"]`)
    if (at && left.anchor)
      el.scrollTop +=
        at.getBoundingClientRect().top - el.getBoundingClientRect().top - left.anchor.offset
    else el.scrollTop = left.top
    restored.current(el)
  }, [left, scroller])

  const spot = useRef<Pick<Spot, 'anchor' | 'top'>>({
    anchor: left?.anchor ?? null,
    top: left?.top ?? 0,
  })
  const frame = useRef(0)
  const keep = () => {
    if (memory === undefined || frame.current !== 0) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      const el = scroller.current
      if (el) spot.current = { anchor: anchorIn(el), top: el.scrollTop }
    })
  }
  // The latest of what the spot needs, for when the chat goes.
  const now = useRef({ first, pinned: following, spoken: seen })
  now.current = { first, pinned: following, spoken: following ? spoken : seen }
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current)
      if (memory !== undefined) spots.set(memory, { ...spot.current, ...now.current })
    },
    [memory]
  )
  return { fresh, keep }
}

/**
 * ↓, 8px above the composer (or the question over it), centred on the column, over a fade
 * that keeps the text from running into it; in the left gutter, beside the 680px column, once
 * there is room. With news below, it says how much: "3 new ↓".
 */
export function LatestButton(p: {
  fresh: number
  /** At the bottom, or the question's line stands there instead. */
  hidden: boolean
  /** At the bottom: no fade. */
  faded: boolean
  onClick: () => void
}) {
  return (
    <>
      <div
        className={cn(
          'from-background pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-t to-transparent transition-opacity',
          p.faded ? 'opacity-0 duration-100 ease-in' : 'opacity-100 duration-140 ease-out'
        )}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-2 mx-auto flex w-full max-w-[768px] justify-center px-6 @min-[840px]:justify-start">
        <button
          type="button"
          aria-label={p.fresh > 0 ? `${newLabel(p.fresh)}, jump to latest` : 'Jump to latest'}
          aria-hidden={p.hidden}
          tabIndex={p.hidden ? -1 : 0}
          className={cn(
            'bg-background text-faint hover:bg-hover hover:text-foreground inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-md border transition-[color,background-color] duration-120 @min-[840px]:-ml-11',
            p.fresh > 0 && 'text-foreground shadow-composer pr-1.5 pl-2.5 text-xs font-medium',
            p.hidden
              ? 'opacity-0 transition-opacity duration-100 ease-in'
              : 'animate-in fade-in slide-in-from-bottom-[4px] pointer-events-auto duration-140 ease-out'
          )}
          onClick={p.onClick}
        >
          {p.fresh > 0 && (
            <span key={p.fresh} className="animate-in fade-in tabular-nums duration-160 ease-out">
              {newLabel(p.fresh)}
            </span>
          )}
          <ChevronDownIcon className="size-3.5" />
        </button>
      </div>
    </>
  )
}
