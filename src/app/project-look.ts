// A project's look: the tone of its avatar and sidebar folder, and its avatar's icon. Picked in
// Settings › Projects and kept in the catalog; unpicked, the tone follows the name and the
// avatar shows the initial. Kept here by name too, for the places that only know the name.

import {
  BookOpenIcon,
  BotIcon,
  BriefcaseIcon,
  CodeIcon,
  DatabaseIcon,
  FlaskConicalIcon,
  Gamepad2Icon,
  GlobeIcon,
  HeartIcon,
  LeafIcon,
  type LucideIcon,
  MusicIcon,
  PaletteIcon,
  PlaneIcon,
  RocketIcon,
  ShoppingCartIcon,
  SmartphoneIcon,
  SquareTerminalIcon,
  ZapIcon,
} from 'lucide-react'
import { useSyncExternalStore } from 'react'

import type { Project } from '../model/catalog'

/** The tones a project can take; the first six are the ones a name picks. */
export const PROJECT_TONES: readonly { id: string; label: string }[] = [
  { id: '#525890', label: 'Indigo' },
  { id: '#5b7a5e', label: 'Sage' },
  { id: '#8a5a44', label: 'Clay' },
  { id: '#6b5b8a', label: 'Plum' },
  { id: '#44707f', label: 'Teal' },
  { id: '#8a6d2f', label: 'Ochre' },
  { id: '#2f5f8a', label: 'Blue' },
  { id: '#8a4a5e', label: 'Rose' },
  { id: '#3f6f62', label: 'Pine' },
  { id: '#5a6473', label: 'Slate' },
]

export const PROJECT_ICONS: Readonly<Record<string, LucideIcon>> = {
  bolt: ZapIcon,
  book: BookOpenIcon,
  bot: BotIcon,
  briefcase: BriefcaseIcon,
  cart: ShoppingCartIcon,
  code: CodeIcon,
  database: DatabaseIcon,
  flask: FlaskConicalIcon,
  game: Gamepad2Icon,
  globe: GlobeIcon,
  heart: HeartIcon,
  leaf: LeafIcon,
  music: MusicIcon,
  palette: PaletteIcon,
  phone: SmartphoneIcon,
  plane: PlaneIcon,
  rocket: RocketIcon,
  terminal: SquareTerminalIcon,
}

/** The tone a name picks, so a project keeps it until one is chosen. */
export function nameTone(name: string): string {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return PROJECT_TONES[hash % 6]?.id ?? '#525890'
}

let projects: readonly Project[] = []
const listeners = new Set<() => void>()

/** The catalog's projects, as loaded: every avatar and folder follows. */
export function noteProjects(next: readonly Project[]) {
  if (next === projects) return
  projects = next
  for (const listener of listeners) listener()
}

export const currentProjects = () => projects

export function useProjects(): readonly Project[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => projects
  )
}

const byName = (name: string) => projects.find((p) => p.name === name)

/** A project's tone: the one picked, else its name's. */
export function projectTone(name: string): string {
  return byName(name)?.color ?? nameTone(name)
}

/** A project's picture (a data URL), or null. */
export function projectImage(name: string): string | null {
  const icon = byName(name)?.icon
  return icon?.startsWith('data:image/') === true ? icon : null
}

/** A project's picked icon, or null for its initial. */
export function projectIcon(name: string): LucideIcon | null {
  const icon = byName(name)?.icon
  return icon === undefined ? null : (PROJECT_ICONS[icon] ?? null)
}
