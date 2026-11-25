// Moving around by keyboard: what ⌘P lists, which tab takes over from a closed one, and the
// next or previous one of a list (⌃Tab, ⌥⌘↓).

import type { Project, Signal, Workspace } from '../model/catalog'
import type { PickerItem } from './picker'

interface PaletteChat {
  id: string
  title: string
  workspaceId: string
  /** When its last turn moved (ms). */
  activeAt?: number
}

interface Recency {
  /** Places visited (`ws:…`, `chat:…` keys), the latest first. */
  recent?: readonly string[]
  /** The place on screen: never in Recent (nor is the current workspace). */
  here?: string | null
  /** Each workspace's last activity (ms), by id. */
  activeAt?: Record<string, number>
  /** Each workspace's task (its first chat's title, or the name given) and colour word. */
  names?: Record<string, { task: string; colour: string }>
}

/** A workspace's meta: whether it is on screen, then its colour word. */
function metaOf(current: boolean, colour: string | undefined) {
  const parts = [current ? 'current' : undefined, colour].filter((x) => x !== undefined)
  return parts.length === 0 ? undefined : parts.join(' · ')
}

/** How many places Recent lists. */
const RECENT = 5

/**
 * ⌘P: Recent (the last places visited, not the one on screen), then workspaces and chats, the
 * latest active first (sidebar order on a tie), then projects. Keys say what each one is.
 */
export function paletteItems(
  projects: Project[],
  workspaces: Record<string, Workspace[]>,
  chats: PaletteChat[],
  signals: Record<string, Signal | null>,
  currentWorkspaceId: string | null,
  { activeAt = {}, here = null, names = {}, recent = [] }: Recency = {}
): PickerItem[] {
  const ordered = projects
    .flatMap((p) => (workspaces[p.id] ?? []).map((w) => ({ p, w })))
    .toSorted((a, b) => (activeAt[b.w.id] ?? 0) - (activeAt[a.w.id] ?? 0))
  const task = (w: Workspace) => names[w.id]?.task ?? w.name
  const where = new Map(ordered.map(({ p, w }) => [w.id, `${p.name} · ${task(w)}`]))
  const places: PickerItem[] = [
    // By its task, as the sidebar leads with it; the colour word and project say which.
    ...ordered.map(({ p, w }) => ({
      icon: 'workspace' as const,
      key: `ws:${w.id}`,
      label: task(w),
      meta: metaOf(w.id === currentWorkspaceId, names[w.id]?.colour),
      section: 'Workspaces',
      signal: signals[w.id] ?? null,
      sub: p.name,
    })),
    ...chats
      .toSorted((a, b) => (b.activeAt ?? 0) - (a.activeAt ?? 0))
      .flatMap((c) => {
        const sub = where.get(c.workspaceId)
        return sub === undefined
          ? []
          : [
              {
                icon: 'chat' as const,
                key: `chat:${c.id}`,
                label: c.title,
                section: 'Chats',
                sub,
              },
            ]
      }),
  ]
  const valid = recent
    // Not where you are: neither the place on screen nor its workspace.
    .filter((k, i) => k !== here && k !== `ws:${currentWorkspaceId}` && recent.indexOf(k) === i)
    .filter((k) => places.some((item) => item.key === k))
  // A workspace one of its chats already stands for: the chat is the more specific place.
  const covered = new Set(
    chats.filter((c) => valid.includes(`chat:${c.id}`)).map((c) => `ws:${c.workspaceId}`)
  )
  const keys = valid.filter((k) => !covered.has(k)).slice(0, RECENT)
  return [
    ...keys.flatMap((k) => {
      const item = places.find((x) => x.key === k)
      return item ? [{ ...item, section: 'Recent' }] : []
    }),
    ...places.filter((item) => !keys.includes(item.key)),
    ...projects.map((p) => ({
      icon: 'project' as const,
      key: `project:${p.id}`,
      label: p.name,
      meta: `${workspaces[p.id]?.length ?? 0} ${workspaces[p.id]?.length === 1 ? 'workspace' : 'workspaces'}`,
      section: 'Projects',
      sub: p.path,
    })),
  ]
}

/** What a ⌘P key points at. */
export function paletteTarget(key: string): {
  kind: 'ws' | 'chat' | 'project' | 'action'
  id: string
} {
  const at = key.indexOf(':')
  return {
    id: key.slice(at + 1),
    kind: key.slice(0, at) as 'ws' | 'chat' | 'project' | 'action',
  }
}

/** What the git panel's Push button would do for this branch: push commits, publish it, or nothing. */
export function pushKind(b: { upstream: boolean; ahead: number }): 'push' | 'publish' | null {
  if (!b.upstream) return 'publish'
  return b.ahead > 0 ? 'push' : null
}

/** What ⌘P's actions depend on: where you are and what its git can do. */
export interface ActionContext {
  /** A workspace is on screen: tabs, git and its panel apply. */
  workspace: boolean
  sideOpen: boolean
  panelOpen: boolean
  /** The PR's number, when it has one. */
  pr: number | null
  /** Ready to merge now (not merged, nothing to push first). */
  canMerge: boolean
  /** Commits to push, or a branch to publish. */
  push: 'push' | 'publish' | null
  /** No PR yet, and a branch with work on it. */
  canAskPr: boolean
  /** Settings' panes, in their order. */
  panes: readonly { id: string; label: string }[]
}

/**
 * ⌘P's actions, each with its shortcut: what the keyboard and the panels already do, so a
 * pick runs the same host command. Only what applies where you are is listed.
 */
export function paletteActions(c: ActionContext): PickerItem[] {
  const all: (PickerItem | false)[] = [
    c.workspace && { key: 'action:chat', label: 'New chat', meta: '⌘T' },
    c.workspace && { key: 'action:terminal', label: 'New terminal', meta: '⇧⌘T' },
    { key: 'action:workspace', label: 'New workspace', meta: '⌘N' },
    c.canAskPr && { key: 'action:ask-pr', label: 'Ask for PR' },
    c.push !== null && {
      key: 'action:push',
      label: c.push === 'publish' ? 'Publish the branch' : 'Push',
    },
    c.canMerge && c.pr !== null && { key: 'action:merge', label: `Merge #${c.pr}` },
    c.pr !== null && { key: 'action:open-pr', label: `Open #${c.pr} on GitHub` },
    c.workspace && { key: 'action:diff', label: 'Review the diff', meta: '⌘G' },
    {
      key: 'action:sidebar',
      label: c.sideOpen ? 'Hide the sidebar' : 'Show the sidebar',
      meta: '⌘S',
    },
    c.workspace && {
      key: 'action:panel',
      label: c.panelOpen ? 'Hide the right panel' : 'Show the right panel',
      meta: '⌥⌘B',
    },
    { key: 'action:settings', label: 'Settings', meta: '⌘,' },
    { key: 'action:ground', label: 'Window colour' },
    ...c.panes.map((p) => ({ key: `action:pane:${p.id}`, label: `Settings › ${p.label}` })),
    { key: 'action:open-folder', label: 'Open a folder as a project', meta: '⌘O' },
  ]
  return all
    .filter((item) => item !== false)
    .map((item) => ({ ...item, icon: 'action' as const, section: 'Actions' }))
}

/**
 * The tab to show once `closing` goes: the one to its right, or to its left when it was the
 * last, as browsers do. Closing a tab that is not on screen changes nothing.
 */
export function afterClose(ids: string[], closing: string, active: string | undefined) {
  if (closing !== active) return active
  const at = ids.indexOf(closing)
  return ids[at + 1] ?? ids[at - 1]
}

/** The next (`step` 1) or previous (-1) of `ids` after `current`, wrapping around. */
export function stepThrough(ids: string[], current: string | undefined, step: 1 | -1) {
  if (ids.length === 0) return
  const at = current === undefined ? -1 : ids.indexOf(current)
  if (at === -1) return step === 1 ? ids[0] : ids.at(-1)
  return ids[(at + step + ids.length) % ids.length]
}

/**
 * ⌘ keys the window's listeners own (app.tsx; ⌘L, chat-view.tsx), by `code`: Option changes
 * `key`.
 */
const APP_KEYS = new Set([
  'KeyB',
  'KeyG',
  'KeyL',
  'KeyN',
  'KeyO',
  'KeyP',
  'KeyS',
  'KeyT',
  'KeyW',
  'Comma',
])

/**
 * A shortcut of the app's rather than of the shell: a focused terminal lets it through to the
 * window. ⌘C, ⌘V, ⌘K and the rest stay the terminal's.
 */
export function appShortcut(
  e: Pick<KeyboardEvent, 'altKey' | 'code' | 'ctrlKey' | 'key' | 'metaKey'>
): boolean {
  if (e.ctrlKey && !e.metaKey && (e.key === 'Tab' || /^Digit[1-9]$/.test(e.code))) return true
  if (!e.metaKey) return false
  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return true
  return APP_KEYS.has(e.code) || /^Digit[1-9]$/.test(e.code)
}
