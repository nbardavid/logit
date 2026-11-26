// What Claude shows with logit's `show` tool, drawn in the transcript where it called it: the
// report's blocks, in the chat's column. Its screens are paths in the worktree, read through
// `shown_image` (images inside a workspace only) and kept while the window lives.
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import type { Block } from '../chat/model'
import type { Shot } from '../report/blocks/primitives'

import { PrCards } from '../cards/pr-card'
import { shownBlocks, shownImages } from '../chat/shown'
import { prRef, type PrRef } from '../git/pr-link'
import { Blocks, type ReportBlock, type Zoom, ZoomedShot } from '../report/blocks'

// The screens read so far, by folder and path. Data URLs are heavy: past a few dozen, the
// oldest no drawn block uses go, and come back from disk if their chat is drawn again.
const MAX_SHOTS = 48
const shots = new Map<string, Shot>()
const inUse = new Map<string, number>()
const listeners = new Set<() => void>()
let version = 0

const keyOf = (cwd: string, path: string) => `${cwd}\n${path}`

function settle(key: string, shot: Shot) {
  shots.set(key, shot)
  for (const old of shots.keys()) {
    if (shots.size <= MAX_SHOTS) break
    if ((inUse.get(old) ?? 0) === 0) shots.delete(old)
  }
  version += 1
  for (const l of listeners) l()
}

/** Holds a block's screens while it is drawn, reading those not read yet. */
function hold(keys: readonly string[], cwd: string, paths: readonly string[]) {
  for (const k of keys) inUse.set(k, (inUse.get(k) ?? 0) + 1)
  for (const p of paths) load(cwd, p)
  return () => {
    for (const k of keys) inUse.set(k, (inUse.get(k) ?? 1) - 1)
  }
}

function load(cwd: string, path: string) {
  const key = keyOf(cwd, path)
  if (shots.has(key)) return
  shots.set(key, { state: 'loading' })
  invoke<string>('shown_image', { cwd, path }).then(
    (url) => settle(key, { state: 'ready', url }),
    (error: unknown) => settle(key, { reason: String(error), state: 'missing' })
  )
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const snapshot = () => version

const shotOf = (cwd: string, path: string): Shot =>
  shots.get(keyOf(cwd, path)) ?? { state: 'loading' }

/** A text block's links without the PRs whose cards stand under the blocks. */
function withoutCarded(blocks: ReportBlock[], cards: readonly PrRef[]): ReportBlock[] {
  const carded = new Set(cards.map((c) => c.key))
  return blocks.map((b) =>
    b.kind === 'text' && b.links !== undefined
      ? { ...b, links: b.links.filter((l) => !carded.has(prRef(l.url)?.key ?? '')) }
      : b
  )
}

export function ShownBlocks({
  block,
  cards,
  cwd,
}: {
  block: Block & { kind: 'tool' }
  /** The PR cards this chat places under these blocks (`chatPrCards`). */
  cards: readonly PrRef[]
  cwd: string
}) {
  const blocks = useMemo(() => shownBlocks(block.input), [block.input])
  const paths = useMemo(() => shownImages(blocks).join('\n'), [blocks])
  // Drawn again each time a screen arrives.
  useSyncExternalStore(subscribe, snapshot)
  useEffect(() => {
    const list = paths === '' ? [] : paths.split('\n')
    return hold(
      list.map((p) => keyOf(cwd, p)),
      cwd,
      list
    )
  }, [cwd, paths])

  const [zoom, setZoom] = useState<Zoom | null>(null)
  const from = useRef<HTMLButtonElement | null>(null)
  const url = (p: string | undefined) => {
    const shot: Shot = p === undefined ? { state: 'loading' } : shotOf(cwd, p)
    return shot.state === 'ready' ? shot.url : undefined
  }
  const close = () => {
    setZoom(null)
    requestAnimationFrame(() => from.current?.focus({ preventScroll: true }))
  }

  if (blocks.length === 0) return null
  return (
    <div className="@container/report flex flex-col gap-3 py-1">
      <Blocks
        blocks={withoutCarded(blocks, cards)}
        prCards={false}
        className="gap-5 @min-[520px]/report:gap-6"
        actions={{
          cwd,
          image: (p) => shotOf(cwd, p),
          onZoom: (z, button) => {
            from.current = button
            setZoom({
              ...z,
              steps: z.steps.map((s) => ({
                ...s,
                after: url(s.after),
                before: url(s.before),
              })),
            })
          },
        }}
      />
      <PrCards links={cards} cwd={cwd} />
      {zoom !== null && <ZoomedShot zoom={zoom} onZoom={setZoom} onClose={close} />}
    </div>
  )
}
