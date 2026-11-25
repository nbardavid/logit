import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

interface Props {
  label: string
  value: number
  min: number
  max: number
  /** +1 when dragging right grows the panel (the sidebar), -1 when it shrinks it (the git panel). */
  direction: 1 | -1
  onChange: (width: number) => void
  /** While it is held: a native view beside it would take the pointer, so it steps aside. */
  onDragging?: (dragging: boolean) => void
  /** Its width when it is the gap between two sheets (`w-gap`); 1px by default. */
  className?: string
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(v)))

/** The panel's width as drawn: it may follow the window rather than a stored value. */
function drawn(splitter: HTMLElement, direction: 1 | -1, value: number) {
  const panel = direction === 1 ? splitter.previousElementSibling : splitter.nextElementSibling
  return panel?.getBoundingClientRect().width ?? value
}

/**
 * The ground between two surfaces, invisible at rest (Canvas: the gap is the divider), with a
 * wider grab area, wider on the side it pushes into (the panel's own side may be a native page,
 * which takes the pointer). Under the pointer or held, a faint line shows where it drags. Drag
 * it, or focus it and use the arrows.
 */
export function Splitter({
  className,
  direction,
  label,
  max,
  min,
  onChange,
  onDragging,
  value,
}: Props) {
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const start = e.clientX
    const target = e.currentTarget
    const from = drawn(target, direction, value)
    target.setPointerCapture(e.pointerId)
    const move = (ev: globalThis.PointerEvent) =>
      onChange(clamp(from + direction * (ev.clientX - start), min, max))
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      document.body.classList.remove('resizing')
      onDragging?.(false)
    }
    document.body.classList.add('resizing')
    onDragging?.(true)
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -16, ArrowRight: 16 }[e.key]
    if (step === undefined) return
    e.preventDefault()
    onChange(clamp(drawn(e.currentTarget, direction, value) + direction * step, min, max))
  }
  return (
    <div
      className={cn(
        'relative z-2 flex-none cursor-col-resize before:absolute before:inset-y-0 after:absolute after:inset-y-3 after:left-1/2 after:w-px after:-translate-x-1/2 after:rounded-full after:bg-transparent after:transition-[background-color] after:duration-150 hover:after:bg-line-strong focus-visible:outline-none focus-visible:after:bg-line-strong active:after:bg-line-strong',
        direction === 1
          ? 'before:-right-2.5 before:-left-1.5'
          : 'before:-left-2.5 before:-right-1.5',
        className ?? 'w-px'
      )}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  )
}

const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Panels slide in 200ms, ease-in-out (DESIGN.md › Motion). */
const SLIDE = { duration: 200, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }

/** An element's left edge as drawn, its transform included; null when it isn't there. */
const drawnLeft = (el: HTMLElement | null | undefined) =>
  el ? el.getBoundingClientRect().left : null

/**
 * A panel that slides open and shut (⌘S, ⌥⌘B; DESIGN.md: 200ms ease-in-out) without any
 * reflow mid-way: the layout takes its final widths at once, and what moves is drawn there and
 * slid into place with a transform (FLIP), the panel over a box of its final width, and with
 * it `follow` (the content beside a left panel, which its opening pushes over). Shut, the panel
 * stays mounted but hidden, so opening it again draws what was there, with no entrance replayed.
 * A change of `widthKey` (a list ↔ a page) slides to the new width the same way; a window
 * resized, or a splitter dragged, moves it at once. Reduced motion: no slide.
 */
export function Slide({
  children,
  follow,
  onSliding,
  open,
  side = 'left',
  width,
  widthKey,
}: {
  open: boolean
  /** The panel's width, its splitter included. */
  width: string
  /** Which edge of the window it lives at. */
  side?: 'left' | 'right'
  /** A change of key (a list ↔ a page) slides to the new width; a drag doesn't. */
  widthKey?: string
  /** What sits beside it and moves with it (the content right of the sidebar). */
  follow?: RefObject<HTMLElement | null>
  /** While it slides: a native view laid over the panel waits for it to settle. */
  onSliding?: (sliding: boolean) => void
  children: ReactNode
}) {
  // Mounted the first time it opens, then kept.
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)
  const [sliding, setSliding] = useState(false)
  const inner = useRef<HTMLDivElement>(null)
  const report = useRef(onSliding)
  report.current = onSliding

  // Where things were drawn before this commit: read while rendering, before the DOM moves.
  const last = useRef({ key: widthKey, open })
  const from = useRef<{ inner: number | null; follow: number | null } | null>(null)
  if (last.current.open !== open || last.current.key !== widthKey) {
    from.current = { follow: drawnLeft(follow?.current), inner: drawnLeft(inner.current) }
    last.current = { key: widthKey, open }
  }

  useLayoutEffect(() => {
    const before = from.current
    from.current = null
    const panel = inner.current
    if (before === null || panel === null) return
    const moving = [panel, follow?.current ?? null].filter((el) => el !== null)
    for (const el of moving) for (const a of el.getAnimations()) a.cancel()
    if (still()) return
    // Shut, the panel rests off its edge (its inline transform); open, in place.
    const off = (side === 'left' ? -1 : 1) * panel.getBoundingClientRect().width
    const rest = open ? 0 : off
    const now = drawnLeft(panel) ?? 0
    // Mounted by this very opening, it was drawn shut: off its edge.
    const shift = before.inner === null ? off - rest : before.inner - now
    const runs: Animation[] = []
    if (shift !== 0)
      runs.push(
        panel.animate(
          [{ transform: `translateX(${rest + shift}px)` }, { transform: `translateX(${rest}px)` }],
          SLIDE
        )
      )
    const beside = follow?.current
    const was = before.follow
    if (beside && was !== null) {
      const by = was - beside.getBoundingClientRect().left
      if (by !== 0) {
        // Pushed left of where it lands, its right edge would leave a gap: its own fill
        // stands in there, a shadow the width of the push.
        if (by < 0) beside.style.boxShadow = `${-by}px 0 0 var(--ground-tint)`
        const run = beside.animate(
          [{ transform: `translateX(${by}px)` }, { transform: 'none' }],
          SLIDE
        )
        const clear = () => {
          beside.style.boxShadow = ''
        }
        run.addEventListener('finish', clear)
        run.addEventListener('cancel', clear)
        runs.push(run)
      }
    }
    if (runs.length === 0) return
    setSliding(true)
    report.current?.(true)
    let left = runs.length
    const done = () => {
      left -= 1
      if (left > 0) return
      setSliding(false)
      report.current?.(false)
    }
    for (const run of runs) {
      run.addEventListener('finish', done)
      run.addEventListener('cancel', done)
    }
  }, [open, widthKey, side, follow])

  if (!mounted) return null
  const shut = !open && !sliding
  return (
    <div
      className="relative z-10 flex-none"
      style={{ width: open ? width : 0 }}
      data-sliding={sliding || undefined}
    >
      <div
        ref={inner}
        className={cn(
          'absolute inset-y-0 flex',
          side === 'left' ? 'left-0' : 'right-0',
          shut && 'invisible'
        )}
        style={{
          transform: open ? undefined : `translateX(${side === 'left' ? '-100%' : '100%'})`,
          width,
        }}
        inert={!open}
        aria-hidden={!open || undefined}
      >
        {children}
      </div>
    </div>
  )
}
