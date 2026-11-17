// A scene Claude wrote, run away from the window: a dedicated worker drawing on a canvas the
// window handed over. It has no DOM and no Tauri IPC, and loses its network calls before the
// scene's code is compiled, so a scene can only draw.

import { painter } from './paint'
import { flicker, hash } from './wallpapers'

export type ToWorker =
  | { kind: 'start'; canvas: OffscreenCanvas; code: string; cell: number; still: boolean }
  | { kind: 'size'; w: number; h: number; dpr: number; cell: number }

export type FromWorker = { kind: 'frame' } | { kind: 'error'; message: string }

const FPS = 24
/** A frame slower than this, several times running, and the scene is stopped as too heavy. */
const SLOW_MS = 40

type SceneFn = (p: ReturnType<typeof painter>, h: typeof hash, f: typeof flicker) => void

const scope = self as unknown as Record<string, unknown> & {
  postMessage: (m: FromWorker) => void
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null
}
for (const name of [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'importScripts',
  'indexedDB',
  'caches',
  'BroadcastChannel',
  'Worker',
])
  try {
    Object.defineProperty(scope, name, { configurable: false, value: undefined })
  } catch {
    // Already gone in this engine.
  }

let ctx: OffscreenCanvasRenderingContext2D | null = null
let canvas: OffscreenCanvas | null = null
let scene: SceneFn | null = null
let cell = 16
let w = 0
let h = 0
let slow = 0
let timer = 0
const born = performance.now()

const fail = (message: string) => {
  clearTimeout(timer)
  scene = null
  scope.postMessage({ kind: 'error', message })
}

function draw() {
  if (!ctx || !scene || w <= 0 || h <= 0) return
  const start = performance.now()
  try {
    ctx.save()
    scene(painter(ctx, w, h, cell, 60 + (start - born) / 1000), hash, flicker)
    ctx.restore()
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
    return
  }
  slow = performance.now() - start > SLOW_MS ? slow + 1 : 0
  if (slow >= 12) fail('The scene is too slow to draw.')
  else scope.postMessage({ kind: 'frame' })
}

scope.onmessage = (e) => {
  const m = e.data
  if (m.kind === 'start') {
    canvas = m.canvas
    ctx = canvas.getContext('2d')
    cell = m.cell
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the sandboxed scene
      scene = new Function('p', 'hash', 'flicker', `'use strict';\n${m.code}`) as SceneFn
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error))
      return
    }
    if (m.still) return
    const loop = () => {
      timer = setTimeout(loop, 1000 / FPS) as unknown as number
      draw()
    }
    loop()
  } else if (canvas && ctx) {
    w = m.w
    h = m.h
    cell = m.cell
    canvas.width = Math.round(w * m.dpr)
    canvas.height = Math.round(h * m.dpr)
    ctx.setTransform(m.dpr, 0, 0, m.dpr, 0, 0)
    draw()
  }
}
