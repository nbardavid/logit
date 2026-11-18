import { Fragment } from 'react'

import type { TextBlock } from './types'

import { BlockHead, has, Inline, isWeb, openLink } from './primitives'

/** Links out on one quiet line, as the app's inline metadata: muted, `·` between. */
function LinkLine({ links }: { links: NonNullable<TextBlock['links']> }) {
  return (
    <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
      {links.map((link, i) => {
        const web = isWeb(link.url)
        return (
          <Fragment key={link.url}>
            {i > 0 && (
              <span aria-hidden className="text-faint">
                ·
              </span>
            )}
            <button
              type="button"
              disabled={!web}
              title={web ? link.url : `Not a web link, so it won't open: ${link.url}`}
              className="decoration-line-strong enabled:hover:text-foreground enabled:hover:decoration-foreground max-w-full truncate underline underline-offset-[3px] transition-[color,text-decoration-color] duration-120 ease-out disabled:cursor-default disabled:no-underline"
              onClick={() => openLink(link.url)}
            >
              {has(link.label) ? link.label : link.url}
            </button>
          </Fragment>
        )
      })}
    </p>
  )
}

/** Lead and paragraphs: the report's voice. The lead reads first, a step larger. */
export function Text({ lead, links = [], paragraphs = [], title }: Omit<TextBlock, 'kind'>) {
  const body = paragraphs.filter(has)
  const out = links.filter((l) => has(l.url))
  if (!has(lead) && body.length === 0 && out.length === 0) return null
  return (
    <section className="flex flex-col gap-2">
      {has(title) && <BlockHead>{title}</BlockHead>}
      {has(lead) && (
        <p className="text-foreground text-base text-pretty break-words whitespace-pre-line select-text @min-[520px]/report:text-md">
          <Inline text={lead} />
        </p>
      )}
      {body.map((p, i) => (
        <p
          // oxlint-disable-next-line no-array-index-key -- the agent's paragraphs, in order
          key={i}
          className="text-ink-soft text-sm leading-5 text-pretty break-words whitespace-pre-line select-text @min-[520px]/report:text-base"
        >
          <Inline text={p} />
        </p>
      ))}
      {out.length > 0 && <LinkLine links={out} />}
    </section>
  )
}
