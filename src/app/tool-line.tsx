import {
  BotIcon,
  FileIcon,
  GlobeIcon,
  ListTodoIcon,
  type LucideIcon,
  PencilIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
} from 'lucide-react'
import { createElement } from 'react'

/** A work line's 14px icon, in its 16px column. */
export const LINE_ICON = 'size-3.5 flex-none text-faint'

/** Each tool's mark on its line: monochrome, the line's words say the rest. */
function toolIcon(name: string): LucideIcon {
  if (name === 'Bash' || name === 'BashOutput' || name === 'KillShell') return TerminalIcon
  if (name === 'Read' || name === 'NotebookRead') return FileIcon
  if (name === 'Grep' || name === 'Glob' || name === 'ToolSearch') return SearchIcon
  if (name === 'WebFetch' || name === 'WebSearch') return GlobeIcon
  if (name === 'TodoWrite') return ListTodoIcon
  if (name === 'Task' || name === 'Agent') return BotIcon
  if (/Edit|Write/.test(name)) return PencilIcon
  return WrenchIcon
}

export function ToolIcon({ className, name }: { className?: string; name: string }) {
  return createElement(toolIcon(name), { className })
}

/** What a tool did, as a past verb for its line ("Read", "Ran", "Searched"). */
export function toolVerb(name: string): string {
  if (name === 'Bash') return 'Ran'
  if (name === 'Grep' || name === 'Glob') return 'Searched'
  if (name === 'WebFetch') return 'Fetched'
  if (name === 'WebSearch') return 'Searched the web'
  return name
}
