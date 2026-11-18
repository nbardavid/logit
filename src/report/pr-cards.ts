// Where a report's PR cards go: each PR once, under the first block that names it. A `pr`
// block is the card itself, wherever it stands; a PR among a text's links leaves the line for
// a card; a PR in the text gets its card under that text.
import type { ReportBlock } from './blocks/types'

import { prLinksIn, type PrRef, prRef } from '../git/pr-link'

/** The words of a block a PR link may sit in. */
function textOf(block: ReportBlock): string {
  switch (block.kind) {
    case 'text':
      return [block.lead ?? '', ...(block.paragraphs ?? [])].join('\n')
    case 'callout':
      return block.text
    case 'left':
      return block.items.join('\n')
    case 'steps':
      return block.items.map((s) => `${s.text}\n${s.detail ?? ''}`).join('\n')
    default:
      return ''
  }
}

/** The blocks to draw (links without their PRs) and, per block, the cards under it. */
export function placePrCards(blocks: readonly ReportBlock[]): {
  blocks: ReportBlock[]
  cards: PrRef[][]
} {
  const shown = new Set<string>()
  for (const b of blocks) {
    if (b.kind !== 'pr') continue
    const ref = prRef(b.url)
    if (ref) shown.add(ref.key)
  }
  const claim = (refs: PrRef[]) =>
    refs.filter((r) => {
      if (shown.has(r.key)) return false
      shown.add(r.key)
      return true
    })
  const cards: PrRef[][] = []
  const out = blocks.map((b): ReportBlock => {
    if (b.kind === 'text' && b.links !== undefined) {
      const refs = b.links.map((l) => prRef(l.url))
      const inText = prLinksIn(textOf(b))
      cards.push(claim([...inText, ...refs.filter((r): r is PrRef => r !== null)]))
      return { ...b, links: b.links.filter((_, i) => refs[i] === null) }
    }
    cards.push(b.kind === 'pr' ? [] : claim(prLinksIn(textOf(b))))
    return b
  })
  return { blocks: out, cards }
}
