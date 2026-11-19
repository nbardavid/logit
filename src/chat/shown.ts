// logit's MCP `show` tool: blocks Claude draws in the conversation, where it calls it. Nothing
// is stored: the blocks are the call's own arguments, so a chat reloaded from Claude Code's
// transcript draws them again. The host checked them before answering; this reads them
// leniently all the same (a transcript is data from disk).
import type { ReportBlock, ScreenStep } from '../report/blocks/types'
import type { Block } from './model'

import { prLinksIn, type PrRef } from '../git/pr-link'

/** logit's MCP server's `show` tool, as Claude Code names it in the stream. */
export const SHOW_TOOL = 'mcp__logit__show'

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (typeof v === 'object' && v !== null ? (v as Json) : {})
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const strings = (v: unknown) =>
  list(v)
    .map(str)
    .filter((s) => s !== '')
const opt = (v: unknown) => str(v) || undefined

/** A `show` call that went through: drawn as its blocks. In flight or refused, a tool row. */
export const isShown = (b: Block): b is Block & { kind: 'tool' } =>
  b.kind === 'tool' && b.name === SHOW_TOOL && b.result !== undefined && !b.result.isError

const TONES = new Set(['note', 'assumption', 'risk'])
const STATUSES = new Set(['done', 'failed', 'skipped'])

/** One block of the kinds an agent may send; null for anything else. */
function blockOf(raw: unknown): ReportBlock | null {
  const b = obj(raw)
  const title = opt(b.title)
  const withTitle = <T extends object>(block: T) =>
    title === undefined ? block : { ...block, title }
  switch (b.kind) {
    case 'text': {
      const paragraphs = strings(b.paragraphs)
      const links = list(b.links)
        .map((l) => ({ label: str(obj(l).label), url: str(obj(l).url) }))
        .filter((l) => l.label !== '' && l.url !== '')
      if (paragraphs.length === 0 && links.length === 0) return null
      return withTitle({ kind: 'text' as const, links, paragraphs })
    }
    case 'callout': {
      const text = str(b.text)
      const tone = str(b.tone)
      if (text === '') return null
      return withTitle({
        kind: 'callout' as const,
        text,
        tone: TONES.has(tone) ? (tone as 'note') : 'note',
      })
    }
    case 'steps': {
      const items = list(b.items).flatMap((raw) => {
        const s = obj(raw)
        const text = str(s.text)
        if (text === '') return []
        const status = STATUSES.has(str(s.status)) ? (str(s.status) as 'done') : 'done'
        const detail = opt(s.detail)
        return [detail === undefined ? { status, text } : { detail, status, text }]
      })
      return items.length === 0 ? null : withTitle({ items, kind: 'steps' as const })
    }
    case 'table': {
      const columns = list(b.columns).map(str)
      const rows = list(b.rows).map((r) => columns.map((_, i) => str(list(r)[i])))
      if (columns.length === 0 || rows.length === 0) return null
      return withTitle({ columns, kind: 'table' as const, rows })
    }
    case 'decisions': {
      const items = list(b.items).flatMap((raw) => {
        const d = obj(raw)
        const text = str(d.text)
        const setAside = opt(d.setAside)
        if (text === '') return []
        return [setAside === undefined ? { text } : { setAside, text }]
      })
      return items.length === 0 ? null : withTitle({ items, kind: 'decisions' as const })
    }
    case 'screens': {
      const steps = list(b.steps).flatMap((raw): ScreenStep[] => {
        const s = obj(raw)
        const step: ScreenStep = { caption: str(s.caption) }
        const before = opt(s.before)
        const after = opt(s.after)
        if (before !== undefined) step.before = before
        if (after !== undefined) step.after = after
        return before === undefined && after === undefined ? [] : [step]
      })
      return steps.length === 0 ? null : withTitle({ kind: 'screens' as const, steps })
    }
    case 'left': {
      const items = strings(b.items)
      return items.length === 0 ? null : withTitle({ items, kind: 'left' as const })
    }
    default:
      return null
  }
}

/** A `show` call's blocks, as the window draws them (screens keep their paths). */
export function shownBlocks(input: Record<string, unknown>): ReportBlock[] {
  return list(input.blocks).flatMap((raw) => {
    const block = blockOf(raw)
    return block === null ? [] : [block]
  })
}

/** The pull requests shown blocks link, in order, each once. */
export function shownPrLinks(blocks: readonly ReportBlock[]): PrRef[] {
  const refs: PrRef[] = []
  for (const b of blocks) {
    let words: string[] = []
    if (b.kind === 'text') {
      words = [...(b.paragraphs ?? []), ...(b.links ?? []).map((l) => l.url)]
    } else if (b.kind === 'callout') words = [b.text]
    else if (b.kind === 'left') words = b.items
    else if (b.kind === 'steps') words = b.items.map((s) => `${s.text}\n${s.detail ?? ''}`)
    for (const w of words) refs.push(...prLinksIn(w))
  }
  return refs.filter((r, i) => refs.findIndex((o) => o.key === r.key) === i)
}

/** Every image a shown block names, in order. */
export function shownImages(blocks: readonly ReportBlock[]): string[] {
  return blocks.flatMap((b) =>
    b.kind === 'screens'
      ? b.steps.flatMap((s) => [s.before, s.after].filter((p) => p !== undefined))
      : []
  )
}
