// How a chat that finished or asks something gets heard: a sound (the aimux TUI's three,
// played by the window itself) and, with the window in the back, a system notification.
// Everything here fails quietly; a sound that cannot play is a silent one.
import { invoke } from '@tauri-apps/api/core'
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification'

import type { Attention } from './toast'
import type { ChatTab } from './use-chats'

import bell from '../assets/sounds/bell.wav'
import ding from '../assets/sounds/ding.wav'
import plane from '../assets/sounds/plane.wav'
import { toolSummary } from '../chat/model'
import { effectiveValue, rowById, type SettingValue } from '../settings/schema'

const FILES: Record<string, string> = { Bell: bell, Ding: ding, Plane: plane }

/** No more than one sound in this window, however many chats finish at once. */
const THROTTLE_MS = 700

/** Whether enough time has passed since the last sound. */
export function shouldPlayNow(now: number, previous: number): boolean {
  return now - previous >= THROTTLE_MS
}

let lastPlayedAt = Number.NEGATIVE_INFINITY
let playing: HTMLAudioElement | null = null

/** Plays `sound` (Plane, Bell, Ding; anything else is silence) at `volume` percent. */
export function playSound(sound: string, volume: number): void {
  const file = FILES[sound]
  const now = Date.now()
  if (file === undefined || !shouldPlayNow(now, lastPlayedAt)) return
  lastPlayedAt = now
  // Cut the previous one rather than layer on top of it.
  playing?.pause()
  playing = new Audio(file)
  playing.volume = Math.min(100, Math.max(0, volume)) / 100
  void playing.play().catch(() => {})
}

/** Plays the sound and volume `settings` hold (Settings › Notifications). */
export function playSettingsSound(settings: Record<string, SettingValue | undefined>): void {
  const value = (id: string) => effectiveValue(rowById(id), settings[id])
  playSound(String(value('notifications.sound')), Number(value('notifications.volume')))
}

/** Plays the chosen sound, read fresh so a change in Settings applies at once. */
export async function playChosenSound(): Promise<void> {
  try {
    const { settings } = await invoke<{ settings: Record<string, SettingValue> }>('read_settings')
    playSettingsSound(settings)
  } catch {
    // Unreadable settings: stay quiet.
  }
}

/** A system notification, once macOS allows them. */
export async function notify(body: string): Promise<void> {
  const granted = (await isPermissionGranted()) || (await requestPermission()) === 'granted'
  if (granted) sendNotification({ body, title: 'logit' })
}

/** The toast for a chat that waits on the user, in workspace `w` of project `p`. */
export function waitingAttention(
  chat: ChatTab,
  p: { id: string; name: string },
  w: { id: string; name: string }
): Attention {
  const ask = chat.state.pending[0]
  const what = ask && (toolSummary(ask.toolName, ask.input, chat.cwd) || (ask.description ?? ''))
  return {
    asks: ask ? { tool: ask.toolName, what: what ?? '' } : null,
    chatId: chat.record.id,
    projectId: p.id,
    title: chat.record.title,
    where: `${w.name} · ${p.name}`,
    workspaceId: w.id,
  }
}
