// The window colour picker, a port of Yab's space look editor (github.com/yetanotherbrowser/yab:
// SpaceLook.swift's ColorEditor, ColorField, FieldDots and LookPresetRow, LookSlider.swift's
// slider, wave and grain tracks), Copyright 2026 Serafim Korablev, under the Apache License 2.0
// (http://www.apache.org/licenses/LICENSE-2.0). Modified: ported from SwiftUI to React; no
// light/dark looks, site colour, glass bead or drawings; blur and a readability clamp added.

import { MinusIcon, PaletteIcon, PlusIcon, RotateCcwIcon } from 'lucide-react'
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

import {
  BLURS,
  DEFAULT_GROUND,
  fromHex,
  fromRgb,
  GRAIN_STANDARD,
  type Ground,
  isEven,
  linkedTones,
  linkOf,
  MAX_LINKS,
  maxChroma,
  moveTo,
  oklchRgb,
  opacityOf,
  paintOf,
  pointOf,
  type Preset,
  PRESET_PAGES,
  presetPageOf,
  PRESETS,
  suggestedLinks,
  toHex,
  type Tone,
  toneRgb,
  transparencyOf,
  withPreset,
} from './ground'
import {
  commitGround,
  openGroundPicker,
  previewGround,
  useGround,
  useGroundPickerOpen,
} from './ground-store'
import { Segmented } from './settings-controls'

/** The card's inside: Yab's look card, 290 wide less its 12 inset each side. */
const WIDTH = 266
/** The field: three quarters as tall as wide, less the −/+ row under the dots. */
const FIELD_H = Math.round(WIDTH * 0.75)
const DOTS_H = FIELD_H - 28
const HANDLE = 36
const LINKED = 24
const PITCH = 10
const TRAVEL = { h: DOTS_H - HANDLE, w: WIDTH - HANDLE }

// SwiftUI's springs as CSS `linear()` curves: the same response and damping, sampled.
interface Spring {
  duration: number
  easing: string
}
function spring(response: number, damping: number): Spring {
  const w0 = (2 * Math.PI) / response
  const decay = damping * w0
  const wd = w0 * Math.sqrt(Math.max(0, 1 - damping * damping))
  const at = (t: number) =>
    damping < 1
      ? 1 - Math.exp(-decay * t) * (Math.cos(wd * t) + (decay / wd) * Math.sin(wd * t))
      : 1 - Math.exp(-w0 * t) * (1 + w0 * t)
  let end = 0
  for (let t = 0; t < 2; t += 0.005) if (Math.abs(1 - at(t)) > 0.002) end = t
  const steps = 48
  const points = Array.from({ length: steps + 1 }, (_, i) =>
    (i === steps ? 1 : at((end * i) / steps)).toFixed(4)
  )
  return { duration: Math.round(end * 1000), easing: `linear(${points.join(', ')})` }
}
/** A preset's dot going to it: 0.27 s, a little past and back (Arc's film, read by Yab). */
const SETTLE = spring(0.27, 0.65)
/** Linked dots parting after + or closing up after −. */
const PART = spring(0.2, 0.75)
/** The preset pages sliding across, with no give. */
const SLIDE = spring(0.32, 1)
const moving = (s: Spring, props = 'left, top') => ({
  transitionDuration: `${s.duration}ms`,
  transitionProperty: props,
  transitionTimingFunction: s.easing,
})

type Motion = 'part' | 'settle' | null

const centreOf = (p: { x: number; y: number }) => ({
  x: HANDLE / 2 + p.x * TRAVEL.w,
  y: HANDLE / 2 + p.y * TRAVEL.h,
})
const pointAt = (x: number, y: number) => ({
  x: Math.min(1, Math.max(0, (x - HANDLE / 2) / TRAVEL.w)),
  y: Math.min(1, Math.max(0, (y - HANDLE / 2) / TRAVEL.h)),
})
const fillOf = (t: Tone) => toHex(toneRgb(t))

/**
 * The print: a dot every 10 px, each the colour the handle would give there, printed no paler
 * or deeper than reads (0.55–0.75 lightness) and holding no more colour than the real
 * lightness can. Worked out once per lightness; only the lens moves with the handle.
 */
function useDots(light: number) {
  return useMemo(() => {
    const print = Math.min(0.75, Math.max(0.55, light))
    const dots: { fill: string; x: number; y: number }[] = []
    for (let x = PITCH / 2; x < WIDTH; x += PITCH) {
      for (let y = PITCH / 2; y < DOTS_H; y += PITCH) {
        const at = moveTo({ hue: 0, intensity: 0, light: print }, pointAt(x, y))
        const most = Math.min(maxChroma(print, at.hue), maxChroma(light, at.hue))
        dots.push({ fill: toHex(oklchRgb(print, most * at.intensity, at.hue)), x, y })
      }
    }
    return dots
  }, [light])
}

type Grab = { index: number | null; dx: number; dy: number }

const QUIET =
  'text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-ring/50 grid size-6 place-items-center rounded-md outline-none transition-[background-color,color,opacity] duration-120 focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-35 [&_svg]:size-3.5 [&_svg]:stroke-[2.25]'

/**
 * The field: a rounded ground printed with dots, the colour's own dot ringed in white dragged
 * across it, hue round the middle and more colour outwards; its linked colours' smaller dots
 * turn with it. − and + under the dots take a colour away or add one.
 */
function Field({
  corner,
  ground,
  motion,
  onCommit,
  onLive,
  onParts,
  single = false,
}: {
  /** One colour only: no linked dots, no − and +. */
  single?: boolean
  corner: ReactNode
  ground: Ground
  motion: Motion
  onLive: (g: Ground) => void
  onCommit: (g: Ground, how: Motion) => void
  onParts: (g: Ground) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [grab, setGrab] = useState<Grab | null>(null)
  const [over, setOver] = useState(false)
  const [chosen, setChosen] = useState<number | null>(null)
  const [born, setBorn] = useState<{ at: { x: number; y: number }; index: number } | null>(null)
  const dots = useDots(ground.light)
  const centre = centreOf(pointOf(ground))
  const links = linkedTones(ground)
  const centres = links.map((t) => centreOf(pointOf(t)))

  // A linked dot just added starts on the one it splits from, then parts to its place.
  useEffect(() => {
    if (born === null) return
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setBorn(null)))
    return () => cancelAnimationFrame(id)
  }, [born])

  useEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const dpr = window.devicePixelRatio || 1
    el.width = WIDTH * dpr
    el.height = DOTS_H * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, WIDTH, DOTS_H)
    for (const dot of dots) {
      const d2 = (dot.x - centre.x) ** 2 + (dot.y - centre.y) ** 2
      const r = 1.6 + 2.2 * Math.exp(-d2 / (2 * 24 * 24))
      ctx.beginPath()
      ctx.arc(dot.x, dot.y, r, 0, Math.PI * 2)
      ctx.fillStyle = dot.fill
      ctx.fill()
    }
  }, [dots, centre.x, centre.y])

  const local = (e: PointerEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - box.left, y: e.clientY - box.top }
  }
  /** Which dot a press takes: the main one within its radius, else the nearest linked one. */
  const hit = (at: { x: number; y: number }): number | null | undefined => {
    if (Math.hypot(at.x - centre.x, at.y - centre.y) <= HANDLE / 2) return null
    let best: number | undefined
    let nearest = LINKED / 2
    for (const [i, c] of centres.entries()) {
      const d = Math.hypot(at.x - c.x, at.y - c.y)
      if (d <= nearest) {
        nearest = d
        best = i
      }
    }
    return best
  }
  const moved = (taken: Grab, at: { x: number; y: number }): Ground => {
    const p = pointAt(at.x - taken.dx, at.y - taken.dy)
    if (taken.index === null) return moveTo(ground, p)
    const index = taken.index
    const color = moveTo(links[index] ?? ground, p)
    return {
      ...ground,
      links: ground.links.map((l, i) =>
        i === index ? { ...linkOf(ground, color), light: l.light } : l
      ),
    }
  }

  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const turns: Record<string, [number, number]> = {
      ArrowDown: [0, -0.05],
      ArrowLeft: [-15, 0],
      ArrowRight: [15, 0],
      ArrowUp: [0, 0.05],
    }
    const by = turns[e.key]
    if (!by) return
    e.preventDefault()
    const intensity = Math.min(1, Math.max(0, ground.intensity + by[1]))
    onCommit({ ...ground, hue: (ground.hue + by[0] + 360) % 360, intensity }, 'settle')
  }

  const add = () => {
    if (ground.links.length >= MAX_LINKS) return
    const from = centres.at(-1) ?? centre
    setBorn({ at: from, index: ground.links.length })
    setChosen(null)
    onParts({ ...ground, links: suggestedLinks(ground.links.length + 1) })
  }
  const remove = () => {
    if (ground.links.length === 0) return
    const index = chosen !== null && chosen < ground.links.length ? chosen : ground.links.length - 1
    const fewer = ground.links.filter((_, i) => i !== index)
    setChosen(null)
    setBorn(null)
    // An even set closes up evenly; colours placed by hand stay where they are.
    onParts({ ...ground, links: isEven(ground.links) ? suggestedLinks(fewer.length) : fewer })
  }

  const still = grab !== null || motion === null
  const handleMotion = (s: Spring) =>
    still
      ? { transitionDuration: '140ms', transitionProperty: 'scale' }
      : moving(s, 'left, top, scale')

  return (
    <div
      className="bg-foreground/5 relative overflow-hidden rounded-lg"
      style={{ height: single ? DOTS_H : FIELD_H, width: WIDTH }}
    >
      <div
        role="slider"
        tabIndex={0}
        aria-label="Colour"
        aria-valuetext={fillOf(ground)}
        aria-description={
          single
            ? 'Drag the dot: hue round the middle, more colour outwards.'
            : 'Drag the main dot to move linked colours, or a small dot to change that colour.'
        }
        className={cn(
          'focus-visible:ring-ring/50 absolute inset-x-0 top-0 touch-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-inset',
          grab !== null ? 'cursor-grabbing' : over && 'cursor-grab'
        )}
        style={{ height: DOTS_H }}
        onKeyDown={key}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId)
          const at = local(e)
          const index = hit(at)
          const taken: Grab =
            index === undefined
              ? { dx: 0, dy: 0, index: null }
              : {
                  dx: at.x - (index === null ? centre : (centres[index] ?? centre)).x,
                  dy: at.y - (index === null ? centre : (centres[index] ?? centre)).y,
                  index,
                }
          setChosen(taken.index)
          setGrab(taken)
          onLive(moved(taken, at))
        }}
        onPointerMove={(e) => {
          const at = local(e)
          if (grab) onLive(moved(grab, at))
          else setOver(hit(at) !== undefined)
        }}
        onPointerUp={(e) => {
          if (!grab) return
          setGrab(null)
          onCommit(moved(grab, local(e)), null)
        }}
        onPointerLeave={() => setOver(false)}
      >
        <canvas
          ref={canvas}
          aria-hidden
          className="absolute inset-0"
          style={{ height: DOTS_H, width: WIDTH }}
        />
        {links.map((t, i) => {
          const newborn = born?.index === i
          const at = newborn ? born.at : (centres[i] ?? centre)
          let scale = newborn ? 0.75 : 1
          if (grab?.index === i) scale = 1.1
          return (
            <span
              key={i}
              aria-hidden
              className="pointer-events-none absolute -translate-1/2 rounded-full border-[3px] border-white shadow-[0_1px_3px_rgb(0_0_0/0.25)]"
              style={{
                background: fillOf(t),
                height: LINKED,
                left: at.x,
                scale,
                top: at.y,
                width: LINKED,
                zIndex: newborn ? 0 : 1,
                ...(newborn ? {} : handleMotion(PART)),
              }}
            />
          )
        })}
        <span
          aria-hidden
          className="pointer-events-none absolute z-2 -translate-1/2 rounded-full border-[3px] border-white shadow-[0_0_0_0.5px_rgb(0_0_0/0.14),0_1px_3px_rgb(0_0_0/0.25)]"
          style={{
            background: fillOf(ground),
            height: HANDLE,
            left: centre.x,
            scale: grab?.index === null ? 1.1 : 1,
            top: centre.y,
            width: HANDLE,
            ...handleMotion(motion === 'part' ? PART : SETTLE),
          }}
        />
      </div>
      <div
        className={cn(
          'absolute inset-x-0 bottom-0.5 flex justify-center gap-1',
          single && 'hidden'
        )}
      >
        <button
          type="button"
          className={QUIET}
          aria-label="Remove colour"
          data-tip="Remove Colour"
          disabled={ground.links.length === 0}
          onClick={remove}
        >
          <MinusIcon />
        </button>
        <button
          type="button"
          className={QUIET}
          aria-label="Add colour"
          data-tip="Add Colour"
          disabled={ground.links.length >= MAX_LINKS}
          onClick={add}
        >
          <PlusIcon />
        </button>
      </div>
      {corner}
    </div>
  )
}

/** A preset as its dot: the main colour top left, its links on to the bottom right. */
const swatchFill = (p: Preset) =>
  p.links.length === 0
    ? p.main
    : `linear-gradient(to bottom right, ${[p.main, ...p.links.toReversed()].join(', ')})`

const SWATCH = 20
const GAP = 4
const TRACK = WIDTH - 24 * 2
/** A page of nine with what's left either side, as much as the ends fade. */
const FADE = (TRACK - (SWATCH * 9 + GAP * 8)) / 2

function ChevronMark({ left }: { left: boolean }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden className="size-3" fill="none">
      <path
        d={left ? 'M7.5 2.5 4 6l3.5 3.5' : 'M4.5 2.5 8 6 4.5 9.5'}
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * The presets under the field: ‹ nine dots ›, a page at a time, sliding across on a spring
 * with no give and fading at the ends. No mark on the one picked: the field and the window
 * show it.
 */
function PresetRow({ ground, onPick }: { ground: Ground; onPick: (p: Preset) => void }) {
  const [page, setPage] = useState(() => presetPageOf(ground))
  const chevron = (way: -1 | 1) => {
    const to = page + way
    const room = to >= 0 && to < PRESET_PAGES.length
    return (
      <button
        type="button"
        className={QUIET}
        aria-label={way < 0 ? 'Previous colours' : 'More colours'}
        disabled={!room}
        onClick={() => setPage(to)}
      >
        <ChevronMark left={way < 0} />
      </button>
    )
  }
  return (
    <div className="flex h-7 items-center" style={{ width: WIDTH }}>
      {chevron(-1)}
      <div
        className="overflow-hidden"
        style={{
          maskImage: `linear-gradient(to right, transparent, black ${FADE}px, black calc(100% - ${FADE}px), transparent)`,
          width: TRACK,
        }}
      >
        <div
          className="flex"
          style={{ transform: `translateX(${-page * TRACK}px)`, ...moving(SLIDE, 'transform') }}
        >
          {PRESET_PAGES.map((p, at) => (
            <div
              key={p.name}
              className="flex shrink-0 items-center justify-center"
              style={{ gap: GAP, height: 28, width: TRACK }}
              inert={at !== page}
            >
              {p.presets.map((preset, i) => (
                <button
                  type="button"
                  key={preset.main + preset.links.join()}
                  aria-label={
                    PRESETS.find((x) => x.page === at && x.main === preset.main)?.name ??
                    `${p.name} ${i + 1}`
                  }
                  className="focus-visible:ring-ring/50 shrink-0 rounded-full shadow-[inset_0_0_0_1.5px_rgb(0_0_0/0.12)] transition-[scale] duration-120 ease-out outline-none focus-visible:ring-2 active:scale-92"
                  style={{ background: swatchFill(preset), height: SWATCH, width: SWATCH }}
                  onClick={() => onPick(preset)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      {chevron(1)}
    </div>
  )
}

// The look's sliders: the pill taken where it's held, a press on the track glides it there,
// ⌥ slows a drag to a quarter, a sideways scroll moves it, a double click puts it back.

/** The grain's scatter: sparse at none, thick at the roughest; the same every time. */
const GRAIN_DOTS = (() => {
  let seed = 0x9e3779b97f4a7c15n
  const mask = (1n << 64n) - 1n
  const next = () => {
    seed = (seed * 6364136223846793005n + 1442695040888963407n) & mask
    return Number(seed >> 33n) / 2 ** 31
  }
  const out: { r: number; x: number; y: number }[] = []
  while (out.length < 170) {
    const x = next()
    if (next() < 0.12 + x * 0.88) out.push({ r: 0.8 + next() * 0.6, x, y: next() * 2 - 1 })
  }
  return out
})()

const THUMB = { h: 26, w: 10 }
const SLIDER_H = 32
const RUN = WIDTH - THUMB.w

/** The track: transparency a wave that flattens past the pill; grain dots dark as far as it. */
function useTrack(kind: 'grain' | 'wave', value: number) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const el = ref.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const dpr = window.devicePixelRatio || 1
    el.width = RUN * dpr
    el.height = SLIDER_H * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, RUN, SLIDER_H)
    const ink = getComputedStyle(el).color
    const mid = SLIDER_H / 2
    if (kind === 'wave') {
      const cut = value * RUN
      ctx.beginPath()
      for (let t = 0; t <= RUN; t += 1) {
        const amp = t < cut ? 5 : 5 * Math.exp(-(t - cut) / 10)
        const y = mid - amp * Math.sin((t / RUN) * 5 * 2 * Math.PI)
        if (t === 0) ctx.moveTo(t, y)
        else ctx.lineTo(t, y)
      }
      ctx.strokeStyle = ink
      ctx.globalAlpha = 0.55
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.stroke()
    } else {
      ctx.fillStyle = ink
      for (const dot of GRAIN_DOTS) {
        ctx.globalAlpha = dot.x <= value ? 0.72 : 0.16
        ctx.beginPath()
        ctx.arc(dot.x * RUN, mid + dot.y * 8, dot.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }, [kind, value])
  return ref
}

function LookSlider({
  kind,
  onCommit,
  onLive,
  reset,
  says,
  stops,
  value,
}: {
  kind: 'grain' | 'wave'
  value: number
  reset: number
  stops?: number
  says: (v: number) => string
  onLive: (v: number) => void
  onCommit: (v: number) => void
}) {
  const track = useTrack(kind, value)
  const box = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState(false)
  const [held, setHeld] = useState(false)
  const hand = useRef({
    current: value,
    dead: false,
    glide: 0,
    lastX: 0,
    moved: false,
    offset: 0,
    raw: value,
    start: 0,
  })
  hand.current.current = value
  const live = useRef(onLive)
  live.current = onLive
  const commit = useRef(onCommit)
  commit.current = onCommit

  const put = (raw: number) => {
    const clamped = Math.min(1, Math.max(0, raw))
    const v = stops === undefined ? clamped : Math.round(clamped * stops) / stops
    if (v === hand.current.current) return
    hand.current.current = v
    live.current(v)
  }
  const stop = () => {
    cancelAnimationFrame(hand.current.glide)
    hand.current.glide = 0
  }
  const glide = (to: number, then?: () => void) => {
    stop()
    const from = hand.current.current
    const began = performance.now()
    const target = Math.min(1, Math.max(0, to))
    const frame = () => {
      const p = Math.min(1, (performance.now() - began) / 160)
      put(from + (target - from) * (1 - (1 - p) ** 3))
      if (p < 1) hand.current.glide = requestAnimationFrame(frame)
      else {
        hand.current.glide = 0
        then?.()
      }
    }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      put(target)
      then?.()
    } else hand.current.glide = requestAnimationFrame(frame)
  }

  // A scroll more sideways than up or down moves the pill with the fingers, and is taken.
  useEffect(() => {
    const el = box.current
    if (!el) return
    let settle = 0
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
      e.preventDefault()
      stop()
      put(hand.current.current - (e.deltaX * (e.deltaMode === 0 ? 1 : 8)) / RUN)
      clearTimeout(settle)
      settle = window.setTimeout(() => commit.current(hand.current.current), 250)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      clearTimeout(settle)
    }
  })

  const x = THUMB.w / 2 + value * RUN
  const lifted = hover || held
  return (
    <div
      ref={box}
      role="slider"
      tabIndex={0}
      aria-label={says(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-valuetext={says(value)}
      className="focus-visible:ring-ring/50 relative touch-none rounded-md outline-none focus-visible:ring-2"
      style={{ height: SLIDER_H, width: WIDTH }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={(e) => e.currentTarget.matches(':focus-visible') && setHover(true)}
      onBlur={() => setHover(false)}
      onKeyDown={(e) => {
        const by: Record<string, number> = {
          ArrowDown: -0.1,
          ArrowLeft: -0.1,
          ArrowRight: 0.1,
          ArrowUp: 0.1,
          End: 1,
          Home: -1,
        }
        const step = by[e.key]
        if (step === undefined) return
        e.preventDefault()
        put(hand.current.current + step)
        commit.current(hand.current.current)
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        const at = e.clientX - e.currentTarget.getBoundingClientRect().left
        const h = hand.current
        setHeld(true)
        h.moved = false
        h.dead = false
        h.start = at
        h.lastX = at
        h.raw = h.current
        // The second click of a double one puts it back.
        if (e.detail === 2) {
          h.dead = true
          glide(reset, () => commit.current(hand.current.current))
          return
        }
        // On the pill (and a little round it) it's taken where it's held; else it glides there.
        if (Math.abs(at - x) <= THUMB.w / 2 + 6) {
          h.offset = at - x
          stop()
        } else {
          h.offset = 0
          glide((at - THUMB.w / 2) / RUN)
        }
      }}
      onPointerMove={(e) => {
        if (!held) return
        const at = e.clientX - e.currentTarget.getBoundingClientRect().left
        const h = hand.current
        if (h.dead) return
        if (!h.moved) {
          if (Math.abs(at - h.start) <= 3) return
          h.moved = true
          stop()
          h.raw = h.current
        }
        if (e.altKey) {
          h.raw = Math.min(1, Math.max(0, h.raw + ((at - h.lastX) * 0.25) / RUN))
          h.offset = at - (THUMB.w / 2 + h.raw * RUN)
        } else {
          h.raw = (at - h.offset - THUMB.w / 2) / RUN
        }
        h.lastX = at
        put(h.raw)
      }}
      onPointerUp={() => {
        if (!held) return
        setHeld(false)
        // A glide still going commits where it lands.
        if (hand.current.glide !== 0) {
          const target = hand.current
          const wait = () =>
            target.glide === 0 ? commit.current(target.current) : requestAnimationFrame(wait)
          requestAnimationFrame(wait)
        } else commit.current(hand.current.current)
      }}
    >
      <canvas
        ref={track}
        aria-hidden
        className="text-foreground pointer-events-none absolute top-0"
        style={{ height: SLIDER_H, left: THUMB.w / 2, width: RUN }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 -translate-1/2 rounded-full bg-white shadow-[0_0_0_0.5px_rgb(0_0_0/0.22),0_1px_3px_rgb(0_0_0/0.25)] transition-[height] duration-140 ease-out"
        style={{ height: THUMB.h + (lifted ? 4 : 0), left: x, width: THUMB.w }}
      />
      {lifted && (
        <span
          aria-hidden
          className="bg-foreground text-background pointer-events-none absolute -top-2 -translate-1/2 rounded-full px-1.5 py-0.5 text-[11px] leading-[13px] font-medium whitespace-nowrap tabular-nums"
          style={{ left: Math.min(Math.max(x, 44), WIDTH - 44) }}
        >
          {says(value)}
        </span>
      )}
    </div>
  )
}

const pct = (v: number) => `${Math.round(v * 100)}%`
const BLUR_LABEL: Record<Ground['blur'], string> = { off: 'None', soft: 'Soft', strong: 'Strong' }

/** The picker's body, as Yab's look card: the field and its presets, then the wave and the grain. */
export function GroundPanel() {
  const { live, stored } = useGround()
  const [motion, setMotion] = useState<Motion>(null)
  // Where a double click puts the transparency back: as the picker opened.
  const [opened] = useState(() => transparencyOf(live.opacity))
  const transparency = transparencyOf(live.opacity)

  const drag = (g: Ground) => {
    setMotion(null)
    previewGround(g)
  }
  const settle = (g: Ground, how: Motion) => {
    setMotion(how)
    commitGround(g)
  }

  const corner = stored !== null && (
    <div className="absolute top-1 right-1 rounded-md bg-[color-mix(in_srgb,var(--background)_70%,transparent)]">
      <button
        type="button"
        className={QUIET}
        aria-label="Back to the app's own colour"
        data-tip="Reset"
        onClick={() => commitGround(null)}
      >
        <RotateCcwIcon />
      </button>
    </div>
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Field
          corner={corner}
          ground={live}
          motion={motion}
          onLive={drag}
          onCommit={settle}
          onParts={(g) => settle(g, 'part')}
        />
        <PresetRow ground={live} onPick={(p) => settle(withPreset(live, p), 'settle')} />
      </div>
      <div className="flex flex-col gap-1">
        <LookSlider
          kind="wave"
          value={transparency}
          reset={opened}
          says={(v) => `Transparency ${pct(v)}`}
          onLive={(v) => previewGround({ ...live, opacity: opacityOf(v) })}
          onCommit={(v) => commitGround({ ...live, opacity: opacityOf(v) })}
        />
        <LookSlider
          kind="grain"
          value={live.grain}
          reset={GRAIN_STANDARD}
          stops={20}
          says={(v) => (v === 0 ? 'No grain' : `Grain ${pct(v)}`)}
          onLive={(v) => previewGround({ ...live, grain: v })}
          onCommit={(v) => commitGround({ ...live, grain: v })}
        />
      </div>
      {/* Blur only means something once the desktop shows through. */}
      {transparency > 0 && (
        <div className="animate-in fade-in flex flex-col gap-1.5 duration-150">
          <div className="flex h-7 items-center justify-between">
            <span className="text-xs font-semibold">Blur</span>
            <Segmented
              label="Blur behind the window"
              options={BLURS.map((b) => BLUR_LABEL[b])}
              value={BLUR_LABEL[live.blur]}
              onChange={(v) =>
                commitGround({ ...live, blur: BLURS.find((b) => BLUR_LABEL[b] === v) ?? 'soft' })
              }
            />
          </div>
        </div>
      )}
    </div>
  )
}

/** The tones a free colour may take: dark enough under white, light enough to tell apart. */
const TONE_LIGHT = { max: 0.72, min: 0.32 }

/**
 * One free colour, as the window colour's field picks it: the dot for hue and colour, a slider
 * for lightness. Settings › Projects' Custom colour. `onLive` follows a drag, `onCommit` a
 * release.
 */
export function ToneField({
  onCommit,
  onLive,
  value,
}: {
  /** A hex colour. */
  value: string
  onLive: (hex: string) => void
  onCommit: (hex: string) => void
}) {
  const [motion, setMotion] = useState<Motion>(null)
  const tone = fromRgb(fromHex(value))
  const ground: Ground = { ...DEFAULT_GROUND, ...tone, links: [] }
  const light = Math.min(TONE_LIGHT.max, Math.max(TONE_LIGHT.min, tone.light))
  const at = (l: number) => fillOf({ ...tone, light: l })
  return (
    <div className="flex flex-col gap-3">
      <Field
        single
        corner={null}
        ground={ground}
        motion={motion}
        onLive={(g) => {
          setMotion(null)
          onLive(fillOf(g))
        }}
        onCommit={(g, how) => {
          setMotion(how)
          onCommit(fillOf(g))
        }}
        onParts={() => {}}
      />
      <input
        type="range"
        aria-label="Lightness"
        min={TONE_LIGHT.min}
        max={TONE_LIGHT.max}
        step={0.01}
        value={light}
        className="h-2 w-full cursor-pointer appearance-none rounded-full [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-[3px] [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-transparent [&::-webkit-slider-thumb]:shadow-[0_0_0_0.5px_rgb(0_0_0/0.2),0_1px_3px_rgb(0_0_0/0.25)]"
        style={{
          background: `linear-gradient(to right, ${at(TONE_LIGHT.min)}, ${at(TONE_LIGHT.max)})`,
        }}
        onChange={(e) => onLive(at(Number(e.target.value)))}
        onPointerUp={(e) => onCommit(at(Number(e.currentTarget.value)))}
        onKeyUp={(e) => onCommit(at(Number(e.currentTarget.value)))}
      />
    </div>
  )
}

/** Opened by the pointer, the focus stays put (no ring on the first control); by keys, it moves in. */
const keyboardOnly = (how: string) => how === 'keyboard'

/** The card's frame: Yab's 290 wide, 12 in. */
const CARD = 'w-[290px] p-3'

/** Settings › Appearance: the colour now, opening the picker under it. */
export function GroundSwatch() {
  const { live } = useGround()
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="gap-2 pr-2.5 pl-1.5">
            <span
              aria-hidden
              className="size-4 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.1)]"
              style={{ background: paintOf({ ...live, opacity: 1 }).paint }}
            />
            Choose…
          </Button>
        }
      />
      <PopoverContent align="end" className={CARD} initialFocus={keyboardOnly}>
        <GroundPanel />
      </PopoverContent>
    </Popover>
  )
}

/**
 * The sidebar footer's palette button, beside Settings: the picker opens above it (⌘P's
 * "Window colour" too); Esc or a click outside closes it and the focus comes back here.
 */
export function GroundButton() {
  const open = useGroundPickerOpen()
  useGround()
  return (
    <Popover open={open} onOpenChange={openGroundPicker}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className={cn('hover:bg-ground-hover', open && 'bg-ground-hover')}
            aria-label="Window colour"
            data-tip="Window colour"
            data-tip-side="top"
            data-tip-align="end"
          >
            <PaletteIcon className="size-4" />
          </Button>
        }
      />
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className={CARD}
        initialFocus={keyboardOnly}
      >
        <GroundPanel />
      </PopoverContent>
    </Popover>
  )
}
