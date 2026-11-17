import { invoke } from '@tauri-apps/api/core'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import type { FromWorker, ToWorker } from './scene-worker'

import {
  NO_WALLPAPER,
  pickedScene,
  type SceneFile,
  WALLPAPER_BLUR_SETTING,
  WALLPAPER_SETTING,
  WALLPAPER_TEXT_BLUR_SETTING,
  WALLPAPER_VEIL_SETTING,
} from './wallpapers'

/** A frame must come this soon after the scene starts, or it is stuck and stopped. */
const STUCK_MS = 4000

/**
 * A scene Claude wrote, drawn in its sandbox (`scene-worker.ts`) on a canvas that fills its
 * box. `onError` hears why it stopped: it threw, it hung, or it was too slow.
 */
export function SceneCanvas({
  cell = 16,
  className,
  code,
  cols,
  onError,
}: {
  code: string
  cell?: number
  /** Draw as this many columns across, whatever the box's width: a window in miniature. */
  cols?: number
  className?: string
  onError?: (message: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const report = useRef(onError)
  report.current = onError
  useEffect(() => {
    // A canvas hands its control over once: each run draws on a fresh one.
    const box = ref.current
    if (!box) return
    const canvas = document.createElement('canvas')
    canvas.className = 'block size-full'
    box.append(canvas)
    const worker = new Worker(new URL('./scene-worker.ts', import.meta.url), { type: 'module' })
    const send = (m: ToWorker, transfer: Transferable[] = []) => worker.postMessage(m, transfer)
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let watchdog = 0
    const stop = (message: string) => {
      clearTimeout(watchdog)
      worker.terminate()
      report.current?.(message)
    }
    const arm = () => {
      clearTimeout(watchdog)
      watchdog = window.setTimeout(() => stop('The scene stopped responding.'), STUCK_MS)
    }
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      if (e.data.kind === 'error') stop(e.data.message)
      else if (!still) arm()
    }
    worker.onerror = (e) => stop(e.message || 'The scene could not start.')
    const offscreen = canvas.transferControlToOffscreen()
    send({ canvas: offscreen, cell, code, kind: 'start', still }, [offscreen])
    const fit = () => {
      const size = canvas.getBoundingClientRect()
      send({
        cell: cols === undefined ? cell : size.width / cols,
        dpr: window.devicePixelRatio || 1,
        h: size.height,
        kind: 'size',
        w: size.width,
      })
    }
    const observer = new ResizeObserver(fit)
    observer.observe(canvas)
    arm()
    return () => {
      clearTimeout(watchdog)
      observer.disconnect()
      worker.terminate()
      canvas.remove()
    }
  }, [code, cell, cols])
  return <div ref={ref} aria-hidden className={className} />
}

/**
 * Behind the whole window: the scene, under every surface. The panes around the chat
 * (sidebar, bars, panels, pages) sit on it as glass (`.glass`, while `data-wallpaper` is set).
 */
export function AppWallpaper() {
  const { blur, textBlur, veil } = useWallpaperState()
  const scene = usePickedScene()
  // A scene that broke while playing leaves the plain backdrop, not a frozen frame.
  const [failed, setFailed] = useState('')
  const shown = scene !== undefined && failed !== scene.code ? scene : undefined
  useEffect(() => {
    const root = document.documentElement
    if (shown === undefined) delete root.dataset.wallpaper
    else root.dataset.wallpaper = shown.id
    return () => {
      delete root.dataset.wallpaper
    }
  }, [shown])
  // The frost behind the text column (`.wallpaper-veil`), as Settings sets it.
  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--veil-blur', `${textBlur}px`)
    root.setProperty('--veil-white', `${veil}%`)
  }, [textBlur, veil])
  // A blurred background is blurred once: the glass over it stops adding its own.
  useEffect(() => {
    const root = document.documentElement
    if (blur > 0) root.dataset.wallpaperBlur = ''
    else delete root.dataset.wallpaperBlur
    return () => {
      delete root.dataset.wallpaperBlur
    }
  }, [blur])
  if (shown === undefined) return null
  // A blur pulls the edges in: the layer overflows the window by twice the radius.
  const style = blur > 0 ? { filter: `blur(${blur}px)`, inset: -blur * 2 } : undefined
  const layer = 'animate-in fade-in pointer-events-none fixed inset-0 -z-10 duration-300 ease-out'
  return (
    <div aria-hidden style={style} className={layer}>
      <SceneCanvas
        key={shown.code}
        code={shown.code}
        className="size-full"
        onError={() => setFailed(shown.code)}
      />
    </div>
  )
}

/** Over the scene, behind a chat: a light veil where its text runs, so it stays easy to read. */
export function ChatVeil() {
  if (usePickedScene() === undefined) return null
  return <div aria-hidden className="wallpaper-veil pointer-events-none absolute inset-0 -z-10" />
}

// The picked background, the scenes in the backgrounds folder, and the frost: read once, then
// kept in step with Settings and with the folder (a scene Claude writes shows within seconds).

interface WallpaperState {
  /** The stored pick: 'None' or a scene's id. */
  picked: string
  scenes: readonly SceneFile[]
  /** The backgrounds folder, where Claude writes new scenes; '' until it was read. */
  dir: string
  /** Why the folder couldn't be read, or null. */
  error: string | null
  blur: number
  /** The frost behind the text column: its blur in px, its white in percent. */
  textBlur: number
  veil: number
}

const TEXT_BLUR = 28
const VEIL = 40
/** How often the folder is read again while the window is in front. */
const POLL_MS = 2500

let state: WallpaperState = {
  blur: 0,
  dir: '',
  error: null,
  picked: NO_WALLPAPER,
  scenes: [],
  textBlur: TEXT_BLUR,
  veil: VEIL,
}
let loaded = false
/** The folder was read once: what appears after is new. */
let listed = false
const listeners = new Set<() => void>()

function set(patch: Partial<WallpaperState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

/** A stored number within [0, max], or the fallback. */
const numberFrom = (v: unknown, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : fallback
const pickFrom = (v: unknown) => (typeof v === 'string' && v !== '' ? v : NO_WALLPAPER)

/** A background setting written (or reset, `null`) in Settings: the window follows at once. */
export function noteWallpaperSetting(id: string, value: unknown) {
  if (id === WALLPAPER_SETTING) set({ picked: pickFrom(value) })
  if (id === WALLPAPER_BLUR_SETTING) set({ blur: numberFrom(value, 40, 0) })
  if (id === WALLPAPER_TEXT_BLUR_SETTING) set({ textBlur: numberFrom(value, 60, TEXT_BLUR) })
  if (id === WALLPAPER_VEIL_SETTING) set({ veil: numberFrom(value, 90, VEIL) })
}

/** Picks a background and stores it, as Settings would. */
export function pickWallpaper(id: string) {
  set({ picked: id })
  invoke('write_setting', { id: WALLPAPER_SETTING, value: id }).catch(() => {
    // Not saved: it still shows until the window reloads.
  })
}

const same = (a: readonly SceneFile[], b: readonly SceneFile[]) =>
  a.length === b.length && a.every((s, i) => s.id === b[i]?.id && s.code === b[i]?.code)

/** The folder read again; a scene that wasn't there before is picked: Claude just made it. */
export async function refreshScenes() {
  let read: { dir: string; scenes: SceneFile[] }
  try {
    read = await invoke<{ dir: string; scenes: SceneFile[] }>('backgrounds_list')
  } catch (error) {
    if (state.error === null) set({ error: String(error) })
    return
  }
  if (state.error !== null) set({ error: null })
  const before = state.scenes
  if (!same(before, read.scenes) || read.dir !== state.dir)
    set({ dir: read.dir, scenes: read.scenes })
  const fresh = listed
    ? read.scenes.filter((s) => !before.some((b) => b.id === s.id)).at(-1)
    : undefined
  listed = true
  if (fresh !== undefined) pickWallpaper(fresh.id)
}

/** Deletes a scene's file; the plain chat when it was the picked one. */
export async function deleteScene(id: string) {
  await invoke('background_delete', { id })
  if (pickedScene(state.scenes, state.picked)?.id === id) pickWallpaper(NO_WALLPAPER)
  set({ scenes: state.scenes.filter((s) => s.id !== id) })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!loaded) {
    loaded = true
    invoke<{ settings: Record<string, unknown> }>('read_settings')
      .then((read) =>
        set({
          blur: numberFrom(read.settings[WALLPAPER_BLUR_SETTING], 40, 0),
          picked: pickFrom(read.settings[WALLPAPER_SETTING]),
          textBlur: numberFrom(read.settings[WALLPAPER_TEXT_BLUR_SETTING], 60, TEXT_BLUR),
          veil: numberFrom(read.settings[WALLPAPER_VEIL_SETTING], 90, VEIL),
        })
      )
      .catch(() => {
        // Unreadable settings: the plain chat.
      })
    const poll = () => {
      if (document.visibilityState === 'visible') void refreshScenes()
    }
    poll()
    setInterval(poll, POLL_MS)
  }
  return () => listeners.delete(listener)
}

export const useWallpaperState = () => useSyncExternalStore(subscribe, () => state)
/** The scene on screen, if the pick names one that exists. */
export const usePickedScene = () =>
  useSyncExternalStore(subscribe, () => pickedScene(state.scenes, state.picked))
