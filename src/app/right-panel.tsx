// The right panel: the git panel's lists, or a page (an artifact) at its own wider width. A
// workspace with a task page splits the area with its chat instead, whatever the tab.
import { useState } from 'react'

import type { useArtifacts } from './use-artifacts'

import { isNew } from '../model/catalog'
import { isBrowser, pageCap, withPageTitles } from './browser-tabs'
import { BrowserView, nativePages, PageStandIn, PausedPage } from './browser-view'
import { GitPanel, type GitPanelProps, spinner } from './git-panel'
import { Slide, Splitter } from './splitter'
import { browserShown, useBrowser, useCovered, usePageTitles } from './use-browser'
import {
  GIT_WIDTH,
  gitWidthNow,
  type Layout,
  LIMITS,
  SIDE_WIDTH,
  sideWidthNow,
  splitWidth,
  splitWidthNow,
} from './use-layout'

type Owned = 'width' | 'artifacts' | 'view' | 'onView' | 'browser'

/** The sidebar's width as CSS, its hairline included; 0px while it is hidden. */
const sideCss = (layout: Layout) =>
  layout.sideOpen
    ? `(${layout.sideWidth === null ? SIDE_WIDTH : `${layout.sideWidth}px`} + 1px)`
    : '0px'

export function RightPanel({
  artifacts,
  layout,
  open,
  panel,
  split,
  update,
}: {
  open: boolean
  /** The workspace has a task page: its Report tab takes about half the area beside its chat. */
  split: boolean
  layout: Layout
  update: (patch: Partial<Layout>) => void
  artifacts: ReturnType<typeof useArtifacts>
  /** The workspace's git panel, or undefined with no workspace. */
  panel: Omit<GitPanelProps, Owned> | undefined
}) {
  // Held in state: the effects that lay the page over it run again once it mounts.
  const [placeholder, setPlaceholder] = useState<HTMLDivElement | null>(null)
  const [titles, setTitles] = useState<Record<string, string>>({})
  usePageTitles((id, title) => setTitles((t) => ({ ...t, [id]: title })))
  const tabs = withPageTitles(artifacts.tabs, titles)
  const { view } = artifacts
  const page = isBrowser(view) ? tabs.find((a) => a.url === view.browser) : undefined

  // A page never leaves the chat less than its minimum, whatever was dragged or the window does.
  const side = layout.sideWidth === null ? SIDE_WIDTH : `${layout.sideWidth}px`
  const sideNow = layout.sideOpen ? (layout.sideWidth ?? sideWidthNow()) + 1 : 0
  // Report and a published page read wide, at one width the user sets; the other tabs stay narrow.
  const wide = page !== undefined || (split && view === 'report')
  const kind = wide ? 'split' : 'list'
  const wideWanted =
    layout.splitWidth === null ? splitWidth(sideCss(layout)) : `${layout.splitWidth}px`
  const narrowWanted = layout.gitWidth === null ? GIT_WIDTH : `${layout.gitWidth}px`
  const wanted = wide ? wideWanted : narrowWanted
  // The chat's 360px minimum, the splitters and the gaps around the sheets.
  const room = layout.sideOpen
    ? `calc(100vw - ${side} - 420px - 3 * var(--gap))`
    : 'calc(100vw - 419px - 3 * var(--gap))'
  const width = wide ? `min(${wanted}, ${room})` : wanted
  const cap = pageCap(window.innerWidth, sideNow)
  const [min, max] = wide ? [LIMITS.split[0], Math.min(LIMITS.split[1], cap)] : LIMITS.git
  const value = wide
    ? (layout.splitWidth ?? splitWidthNow(sideNow))
    : (layout.gitWidth ?? gitWidthNow())
  const patch = (w: number): Partial<Layout> => (wide ? { splitWidth: w } : { gitWidth: w })

  const [sliding, setSliding] = useState(false)
  const [dragging, setDragging] = useState(false)
  const covered = useCovered(placeholder)
  const settled = !sliding && !dragging
  const shown = browserShown({ covered, mode: 'normal', panelOpen: open, sliding: !settled, view })
  const loaded = useBrowser(page?.url, placeholder, shown && page !== undefined)
  let cover = null
  if (!nativePages && page) cover = <PageStandIn artifact={page} />
  else if (!loaded) cover = <div className="grid h-full place-items-center">{spinner}</div>
  else if (page) cover = <PausedPage artifact={page} />
  return (
    <Slide
      open={open}
      side="right"
      width={`calc(${width} + var(--gap))`}
      widthKey={kind}
      onSliding={setSliding}
    >
      {panel && (
        <>
          <Splitter
            label={wide ? 'Resize the page' : 'Resize the git panel'}
            value={value}
            min={min}
            max={max}
            direction={-1}
            className="w-gap"
            onChange={(w) => update(patch(w))}
            onDragging={setDragging}
          />
          <GitPanel
            {...panel}
            width={width}
            artifacts={{ count: tabs.length, unread: tabs.some(isNew) }}
            view={view}
            onView={artifacts.setView}
            browser={
              page && (
                <BrowserView
                  artifact={page}
                  list={tabs}
                  chatOf={artifacts.chatOf}
                  onPick={(url) => artifacts.setView({ browser: url })}
                  onClose={artifacts.close}
                  placeholder={setPlaceholder}
                  cover={cover}
                />
              )
            }
          />
        </>
      )}
    </Slide>
  )
}
