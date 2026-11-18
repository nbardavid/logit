// A screen shown larger, over the surface's main area: Esc or × closes, ← → turns the pair,
// ↑ ↓ steps through the flow. A surface, not a modal: no veil.
import { XIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { ScreenStep } from './types'

import { has, type Zoom } from './primitives'

/** The next step that has a screen, on the same side when it has it. */
function stepTo(steps: readonly ScreenStep[], zoom: Zoom, by: 1 | -1): Zoom | null {
  for (let i = zoom.step + by; i >= 0 && i < steps.length; i += by) {
    const s = steps[i]
    if (s === undefined) continue
    if (has(s[zoom.side])) return { ...zoom, step: i }
    const other = zoom.side === 'before' ? 'after' : 'before'
    if (has(s[other])) return { ...zoom, side: other, step: i }
  }
  return null
}

export function ZoomedShot({
  host,
  onClose,
  onZoom,
  zoom,
}: {
  host: HTMLElement
  zoom: Zoom
  onZoom: (zoom: Zoom) => void
  onClose: () => void
}) {
  const close = useRef<HTMLButtonElement>(null)
  const [actual, setActual] = useState(false)
  useEffect(() => close.current?.focus({ preventScroll: true }), [])
  const screen = zoom.steps[zoom.step]
  if (screen === undefined) return null
  const src = screen[zoom.side]
  const sides = (['before', 'after'] as const).filter((s) => has(screen[s]))
  const steps = zoom.steps.length
  return createPortal(
    <div
      className="glass bg-background animate-in fade-in zoom-in-[0.98] @container/zoom absolute inset-0 z-30 flex flex-col duration-160 ease-out"
      role="dialog"
      aria-label={`Step ${zoom.step + 1}: ${screen.caption}, ${zoom.side}`}
      onKeyDown={(e) => {
        let next: Zoom | null = null
        if (e.key === 'Escape') {
          // Esc closes this, and goes no further (it would stop a working chat).
          e.preventDefault()
          e.stopPropagation()
          onClose()
          return
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          const other = sides.find((s) => s !== zoom.side)
          if (other !== undefined) next = { ...zoom, side: other }
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          next = stepTo(zoom.steps, zoom, e.key === 'ArrowDown' ? 1 : -1)
        }
        if (next !== null) {
          e.preventDefault()
          setActual(false)
          onZoom(next)
        }
      }}
    >
      <div className="border-border flex h-bar flex-none items-center gap-2 border-b pr-2 pl-4">
        <span className="text-faint flex-none text-sm tabular-nums">
          {zoom.step + 1}
          {steps > 1 && <span className="text-label">/{steps}</span>}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={screen.caption}>
          {screen.caption}
        </span>
        <span className="text-faint hidden flex-none text-xs @min-[560px]/zoom:inline">
          {sides.length > 1 && '← → before / after'}
          {sides.length > 1 && steps > 1 && ' · '}
          {steps > 1 && '↑ ↓ steps'}
        </span>
        {sides.length > 1 && (
          <span className="bg-muted flex flex-none rounded-lg p-0.5" role="group">
            {sides.map((s) => (
              <button
                type="button"
                key={s}
                aria-pressed={zoom.side === s}
                className={cn(
                  'h-6 rounded-md px-2.5 text-xs font-medium transition-[color,background-color,box-shadow] duration-120 ease-out',
                  zoom.side === s
                    ? 'bg-background text-foreground shadow-composer'
                    : 'text-faint hover:text-muted-foreground'
                )}
                onClick={() => onZoom({ ...zoom, side: s })}
              >
                {s === 'before' ? 'Before' : 'After'}
              </button>
            ))}
          </span>
        )}
        <Button
          ref={close}
          variant="ghost"
          size="icon"
          aria-label="Close the screen"
          aria-keyshortcuts="Escape"
          title="Close (Esc)"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </div>
      {/* Fitted whole (the thumbnail crops it); a click shows it at its own size. */}
      <div className={cn('min-h-0 flex-1 overflow-auto p-6', !actual && 'grid place-items-center')}>
        {src !== undefined && (
          <button
            type="button"
            className={cn(
              'block',
              actual ? 'w-max cursor-zoom-out' : 'h-full w-full cursor-zoom-in'
            )}
            aria-label={actual ? 'Fit to the window' : 'Show at actual size'}
            aria-pressed={actual}
            onClick={() => setActual(!actual)}
          >
            <img
              key={`${zoom.step}:${zoom.side}`}
              src={src}
              alt={zoom.side === 'before' ? 'Before' : 'After'}
              draggable={false}
              className={cn(
                'frame animate-in fade-in mx-auto block rounded-lg duration-160 ease-out',
                actual ? 'max-w-none' : 'h-full w-full object-contain'
              )}
            />
          </button>
        )}
      </div>
    </div>,
    host
  )
}
