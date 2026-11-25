import { invoke } from '@tauri-apps/api/core'
import { useSyncExternalStore } from 'react'

import {
  DEFAULT_GROUND,
  GRAIN_ALPHA,
  type Ground,
  GROUND_SETTING,
  paintOf,
  parseGround,
  serializeGround,
} from './ground'

// The ground picked (null: the app's own), drawn as CSS variables on the root, once a frame
// at most, and the native material under the window when it is see-through.

interface State {
  /** As stored; null is the app's own neutral, tokens untouched. */
  stored: Ground | null
  /** What shows now: the stored ground, or the one a drag is previewing. */
  live: Ground
}

let state: State = { live: DEFAULT_GROUND, stored: null }
let loaded = false
const listeners = new Set<() => void>()

function emit(next: State) {
  state = next
  for (const l of listeners) l()
}

/** What the native window wears: opaque, see-through, or see-through over a material. */
export type Effect = 'solid' | 'clear' | 'soft' | 'strong'
export function effectOf(g: Ground | null, opacity: number): Effect {
  if (g === null || opacity >= 1) return 'solid'
  return g.blur === 'off' ? 'clear' : g.blur
}

let frame = 0
let pending: Ground | null | undefined
let effect: Effect = 'solid'
let tile = ''

/** A 128px noise tile, made once (Yab's grain): black and white specks at random alpha. */
function grainTile() {
  if (tile !== '') return tile
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(size, size)
  let x = 0x9e3779b9
  for (let i = 0; i < img.data.length; i += 4) {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    const v = x >>> 0
    const shade = v & 1 ? 255 : 0
    img.data[i] = shade
    img.data[i + 1] = shade
    img.data[i + 2] = shade
    img.data[i + 3] = (v >>> 8) & 0x5f
  }
  ctx.putImageData(img, 0, 0)
  tile = `url(${canvas.toDataURL()})`
  return tile
}

const VARS = [
  '--ground',
  '--ground-paint',
  '--ground-tint',
  '--ground-layer',
  '--ground-hover',
  '--grain',
  '--grain-tile',
]

function paint(g: Ground | null) {
  const root = document.documentElement
  const style = root.style
  for (const name of [...VARS, ...Object.keys(paintOf(DEFAULT_GROUND).inks).map(inkVar)])
    style.removeProperty(name)
  delete root.dataset.ground
  let opacity = 1
  if (g !== null) {
    const p = paintOf(g)
    opacity = p.opacity
    root.dataset.ground = p.light ? 'dark' : 'light'
    style.setProperty('--ground', p.solid)
    style.setProperty('--ground-paint', p.paint)
    style.setProperty('--ground-tint', p.tint)
    style.setProperty('--ground-layer', p.layer)
    style.setProperty('--ground-hover', p.hover)
    for (const [token, ink] of Object.entries(p.inks)) style.setProperty(inkVar(token), ink)
    if (g.grain > 0) {
      style.setProperty('--grain', String(Math.round(g.grain * GRAIN_ALPHA * 1000) / 1000))
      style.setProperty('--grain-tile', grainTile())
    }
  }
  const next = effectOf(g, opacity)
  if (next !== effect) {
    effect = next
    invoke('window_ground', { effect: next }).catch(() => {
      // An older host or a window that can't: the ground stays a colour.
    })
  }
}

/** `--foreground` → `--gi-foreground`: the sidebar's ink, applied under `.ground-inks`. */
const inkVar = (token: string) => `--gi-${token.slice(2)}`

function schedule(g: Ground | null) {
  pending = g
  if (frame !== 0) return
  frame = requestAnimationFrame(() => {
    frame = 0
    if (pending !== undefined) paint(pending)
    pending = undefined
  })
}

/** Shows a ground while it is dragged, without writing it. */
export function previewGround(g: Ground) {
  emit({ ...state, live: g })
  schedule(g)
}

/** Keeps a ground in settings.json (null goes back to the app's own). */
export function commitGround(g: Ground | null) {
  emit({ live: g ?? DEFAULT_GROUND, stored: g })
  schedule(g)
  invoke('write_setting', {
    id: GROUND_SETTING,
    value: g === null ? null : serializeGround(g),
  }).catch(() => {
    // Unsaved: it still shows until the app restarts.
  })
}

/** The setting changed elsewhere (Settings' reset): follow it. */
export function noteGroundSetting(id: string, value: unknown) {
  if (id !== GROUND_SETTING) return
  const g = parseGround(value)
  emit({ live: g ?? DEFAULT_GROUND, stored: g })
  schedule(g)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!loaded) {
    loaded = true
    invoke<{ settings: Record<string, unknown> }>('read_settings')
      .then((read) => noteGroundSetting(GROUND_SETTING, read.settings[GROUND_SETTING]))
      .catch(() => {
        // Unreadable settings: the app's own ground.
      })
  }
  return () => listeners.delete(listener)
}

/** The ground stored and the one showing; read from settings.json once. */
export const useGround = () => useSyncExternalStore(subscribe, () => state)

// The picker hangs from the sidebar footer's palette button; ⌘P opens it there too.
let pickerOpen = false
const openListeners = new Set<() => void>()
export function openGroundPicker(open: boolean) {
  if (open === pickerOpen) return
  pickerOpen = open
  for (const l of openListeners) l()
}
export const useGroundPickerOpen = () =>
  useSyncExternalStore(
    (l) => {
      openListeners.add(l)
      return () => openListeners.delete(l)
    },
    () => pickerOpen
  )
