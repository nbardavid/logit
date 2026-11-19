// What every report block shares: its header, its inline text, its surface, and the two
// things a block may ask of the surface around it (zoom a screen, open a link).
import { openUrl } from '@tauri-apps/plugin-opener'
import { createContext, type ReactNode, use } from 'react'

import { cn } from '@/lib/utils'

import type { ScreenStep } from './types'

/** A screen to show larger: which step of which list, which side. */
export interface Zoom {
  steps: ScreenStep[]
  step: number
  side: 'before' | 'after'
}

export interface BlockActions {
  /** Shows a screen larger; absent, screens don't zoom. */
  onZoom?: (zoom: Zoom, from: HTMLButtonElement) => void
  /** The workspace's folder, where gh reads and merges the report's PRs; absent, home. */
  cwd?: string
  /** Reads a screen the blocks name by path (a chat's `show`); absent, they are URLs. */
  image?: (src: string) => Shot
}

/** A screen read from disk: on its way, there, or not to be had (and why). */
export type Shot =
  | { state: 'loading' }
  | { state: 'ready'; url: string }
  | { state: 'missing'; reason: string }

export const BlockContext = createContext<BlockActions>({})
export const useBlockActions = () => use(BlockContext)

/** Only web links open (the host checks it too). */
export function isWeb(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

export const openLink = (url: string) => {
  if (isWeb(url)) void openUrl(url)
}

export const has = (v: string | undefined): v is string => v !== undefined && v.trim() !== ''

/** The surface a block's list sits on: a card with a hairline, as the app's cards. */
export const CARD = 'rounded-lg border border-border bg-background'

/** A block's header: a small label, an optional count, an optional aside at the right. */
export function BlockHead({
  aside,
  children,
  count,
}: {
  children: ReactNode
  count?: ReactNode
  aside?: ReactNode
}) {
  return (
    <h3 className="text-muted-foreground mb-2 flex min-h-5 items-center gap-1.5 text-xs font-medium">
      <span className="min-w-0 truncate">{children}</span>
      {count !== undefined && <span className="text-faint font-normal tabular-nums">{count}</span>}
      {aside !== undefined && <span className="ml-auto flex-none">{aside}</span>}
    </h3>
  )
}

const TOKEN = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g

/** Light inline formatting: **bold**, `code`, [label](url). Everything else stays text. */
export function Inline({ text }: { text: string }) {
  const parts = text.split(TOKEN)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
          // oxlint-disable-next-line no-array-index-key -- a sentence's pieces, in order
          return (
            <strong key={i} className="text-foreground font-semibold">
              {part.slice(2, -2)}
            </strong>
          )
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
          return (
            // oxlint-disable-next-line no-array-index-key -- a sentence's pieces, in order
            <code key={i} className="bg-hover rounded-sm px-1 py-px font-mono text-[0.88em]">
              {part.slice(1, -1)}
            </code>
          )
        const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part)
        if (link !== null) {
          const [, label = '', url = ''] = link
          return (
            <button
              // oxlint-disable-next-line no-array-index-key -- a sentence's pieces, in order
              key={i}
              type="button"
              title={url}
              className="decoration-line-strong hover:decoration-foreground inline underline underline-offset-[3px] transition-[text-decoration-color] duration-120 ease-out"
              onClick={() => openLink(url)}
            >
              {label}
            </button>
          )
        }
        return part
      })}
    </>
  )
}

/** "Recommended" beside an option, said quietly, as the chat's question card says it. */
export function Recommended() {
  return (
    <span className="bg-active text-muted-foreground rounded-sm px-1.5 text-xs font-normal">
      Recommended
    </span>
  )
}

/** A mark at the start of a line: done, failed, skipped, passed, waiting. */
export function Mark({ tone }: { tone: 'good' | 'bad' | 'muted' | 'warn' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-4 flex-none place-items-center rounded-full',
        tone === 'good' && 'bg-good-wash text-good',
        tone === 'bad' && 'bg-critical-wash text-critical',
        tone === 'muted' && 'bg-active text-faint',
        tone === 'warn' && 'bg-warn-wash text-warn-ink'
      )}
    >
      <svg
        viewBox="0 0 16 16"
        className="size-2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {tone === 'good' && <path d="m3.5 8.5 3 3 6-7" />}
        {tone === 'bad' && <path d="m4.5 4.5 7 7m0-7-7 7" />}
        {tone === 'muted' && <path d="M4.5 8h7" />}
        {tone === 'warn' && <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />}
      </svg>
    </span>
  )
}
