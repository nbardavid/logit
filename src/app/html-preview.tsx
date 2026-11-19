import { openUrl } from '@tauri-apps/plugin-opener'
import {
  createContext,
  isValidElement,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

import { Segmented } from './settings-controls'

/** True while the answer around a code block is still being written. */
export const Streaming = createContext(false)

// The preview fetches nothing but pictures, styles and fonts: no scripts, no requests.
const POLICY =
  "default-src 'none'; style-src 'unsafe-inline' https:; img-src data: https:; font-src data: https:"

/** The document the preview frame loads: the snippet under a policy that keeps it inert. */
export function previewDocument(html: string) {
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${POLICY}"><style>html{font-family:system-ui,sans-serif;color-scheme:light}body{margin:0;padding:16px}</style>${html}`
}

// Past this the frame scrolls inside itself.
const MAX_HEIGHT = 560

/** The snippet drawn as a page, as tall as its content. Links open in the browser. */
function PreviewFrame({ html }: { html: string }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(0)

  useEffect(() => {
    const el = frame.current
    if (el === null) return
    let observer: ResizeObserver | undefined
    const onLoad = () => {
      const doc = el.contentDocument
      if (doc === null) return
      const measure = () => setHeight(Math.min(doc.documentElement.scrollHeight, MAX_HEIGHT))
      measure()
      observer?.disconnect()
      observer = new ResizeObserver(measure)
      observer.observe(doc.body)
      doc.addEventListener('click', (e) => {
        const link = (e.target as Element | null)?.closest('a')
        if (link === null || link === undefined) return
        e.preventDefault()
        const href = link.getAttribute('href') ?? ''
        if (/^https?:/.test(href)) void openUrl(href)
      })
    }
    el.addEventListener('load', onLoad)
    return () => {
      el.removeEventListener('load', onLoad)
      observer?.disconnect()
    }
  }, [])

  return (
    <iframe
      ref={frame}
      title="HTML preview"
      // Same origin so the frame can be measured; no scripts, so it can do nothing with it.
      sandbox="allow-same-origin"
      srcDoc={previewDocument(html)}
      className="block w-full bg-white transition-[height] duration-180 ease-out"
      style={{ height: height || 120 }}
    />
  )
}

export /** The source of an ```html block, or null for any other block. */
function htmlSource(children: ReactNode): string | null {
  if (!isValidElement<{ className?: string; children?: ReactNode }>(children)) return null
  const { children: code, className } = children.props
  if (!/\blanguage-html\b/.test(className ?? '') || typeof code !== 'string') return null
  return code
}

const VIEWS = ['Preview', 'Code']

/** An ```html block: its page by default, its source one click away. Copy stays on top. */
export function HtmlBlock({ copy, html, pre }: { html: string; pre: ReactNode; copy: ReactNode }) {
  const streaming = useContext(Streaming)
  const [view, setView] = useState('Preview')
  // While Claude writes it, the source grows in place; the page comes once it is whole.
  const shown = streaming ? 'Code' : view
  return (
    <div data-ui className="bg-chrome mb-3 overflow-hidden rounded-lg border last:mb-0">
      <div className="flex h-9 items-center gap-2 border-b pr-1.5 pl-3">
        <span className="text-faint font-mono text-xs">html</span>
        <div className="ml-auto flex items-center gap-1">
          {!streaming && <Segmented label="View" options={VIEWS} value={view} onChange={setView} />}
          {copy}
        </div>
      </div>
      {shown === 'Preview' ? (
        <div key="preview" className="animate-in fade-in duration-160">
          <PreviewFrame html={html} />
        </div>
      ) : (
        <div
          key="code"
          className="animate-in fade-in duration-160 [&>pre]:m-0 [&>pre]:rounded-none [&>pre]:border-0"
        >
          {pre}
        </div>
      )}
    </div>
  )
}
