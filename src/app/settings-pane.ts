// Which Settings pane shows: the window's nav picks it, ⌃Tab steps it.
// Remembered for the session.

import {
  BellIcon,
  GitBranchIcon,
  InfoIcon,
  type LucideIcon,
  MessageSquareIcon,
  PaletteIcon,
  ServerCogIcon,
  SquareTerminalIcon,
  UsersIcon,
} from 'lucide-react'
import { useSyncExternalStore } from 'react'

import { SECTIONS } from '../settings/schema'
import { currentProjects } from './project-look'

export interface Pane {
  id: string
  label: string
  icon: LucideIcon
}

const ICONS: Record<string, LucideIcon> = {
  appearance: PaletteIcon,
  chats: MessageSquareIcon,
  notifications: BellIcon,
  terminal: SquareTerminalIcon,
  workspaces: GitBranchIcon,
}

export const PANES: Pane[] = [
  ...SECTIONS.map((s) => ({ icon: ICONS[s.id] ?? InfoIcon, id: s.id, label: s.label })),
  { icon: UsersIcon, id: 'accounts', label: 'Accounts' },
  { icon: ServerCogIcon, id: 'host', label: 'Background process' },
  { icon: InfoIcon, id: 'about', label: 'About' },
]

const FIRST: Pane = { icon: PaletteIcon, id: 'appearance', label: 'Appearance' }
let current = FIRST.id
const listeners = new Set<() => void>()

/** A project's own pane, under Projects in the nav. */
export const projectPane = (id: string) => `project:${id}`
export const paneProject = (pane: string) =>
  pane.startsWith('project:') ? pane.slice('project:'.length) : null

/** Every pane in the nav's order: the app's, then one per project. */
const allPanes = () => [
  ...PANES.map((p) => p.id),
  ...currentProjects().map((p) => projectPane(p.id)),
]

export const currentPane = () => current

export function setPane(id: string) {
  if (id === current || !allPanes().includes(id)) return
  current = id
  for (const listener of listeners) listener()
}

/** Moves `by` panes, wrapping: ⌃Tab and the nav's arrows. */
export function stepPane(by: number) {
  const ids = allPanes()
  const i = ids.indexOf(current)
  setPane(ids[(i + by + ids.length) % ids.length] ?? current)
}

/** The pane on screen; a project's comes back as its id (`paneProject` reads it). */
export function usePaneId(): string {
  const id = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current
  )
  return paneProject(id) !== null || PANES.some((p) => p.id === id) ? id : FIRST.id
}

export function usePane(): Pane {
  const id = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current
  )
  return PANES.find((p) => p.id === id) ?? FIRST
}
