// Where a chat's PR cards go: each PR once in the whole chat, under Claude's latest message
// that links it (the freshest word on it is where the card helps; an old mention keeps its
// link). A message still being written gets none until it is done: its link may be half-typed.
import type { Block, Exchange } from './model'

import { prLinksIn, type PrRef } from '../git/pr-link'

// A message's text never changes once written: its links are found once.
const found = new WeakMap<Block, PrRef[]>()
function linksOf(block: Block & { kind: 'text' }): PrRef[] {
  let refs = found.get(block)
  if (refs === undefined) {
    refs = prLinksIn(block.text)
    found.set(block, refs)
  }
  return refs
}

/** The key a card's place goes by: the exchange's, then the item's. */
export const cardSpot = (exchange: string, item: string) => `${exchange}\n${item}`

/** Each text item (by `cardSpot`) and the PR cards under it, in the order they are linked. */
export function chatPrCards(exchanges: readonly Exchange[]): Map<string, PrRef[]> {
  const latest = new Map<string, { spot: string; ref: PrRef }>()
  for (const ex of exchanges) {
    const writing = ex.live ? ex.blocks.at(-1) : undefined
    for (const it of ex.items) {
      if (it.kind !== 'block' || it.block.kind !== 'text' || it.block === writing) continue
      for (const ref of linksOf(it.block)) {
        // Deleted first: the map's order becomes the order of the latest mentions.
        latest.delete(ref.key)
        latest.set(ref.key, { ref, spot: cardSpot(ex.key, it.key) })
      }
    }
  }
  const spots = new Map<string, PrRef[]>()
  for (const { ref, spot } of latest.values()) spots.set(spot, [...(spots.get(spot) ?? []), ref])
  return spots
}
