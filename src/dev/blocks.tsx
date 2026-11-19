// Every report block (src/report/blocks) with realistic content, for screenshots:
// `bun run web:dev`, then http://localhost:1420/?blocks. Each kind at a report's width and at
// the narrow panel's, in its usual states (empty and long where they matter). Dev only.
import { type ReactNode, useRef, useState } from 'react'

import type { ReportBlock } from '../report/blocks/types'

import { Blocks, type Zoom, ZoomedShot } from '../report/blocks'
import { PR_STATES } from './pull-requests'
import { MENU_STEP, shot } from './reports'

const LONG_LINE =
  'An agent that could not stop writing, with a path src/app/very/deep/folder/structure/that-never-ends/component.tsx and a link https://example.com/a/very/long/path?with=many&params=true to see how the text folds.'

/** A PR named among a report's links: its card, nothing written of it beforehand. */
const card = (label: string, url: string): ReportBlock => ({
  kind: 'text',
  links: [{ label, url }],
})

/** Each block kind, its variants, and what they show. */
const KINDS: {
  kind: string
  note: string
  variants: { label: string; blocks: ReportBlock[] }[]
}[] = [
  {
    kind: 'text',
    note: 'The lead (the summary), paragraphs with inline bold, code and links, and the report’s links on one quiet line.',
    variants: [
      {
        blocks: [
          {
            kind: 'text',
            lead: 'Every menu now runs on Base UI and gives the focus back to the composer.',
            paragraphs: [
              'The tab menu, the sidebar’s right-click and the model picker share **one** component, `Menu`, in `src/components/ui/menu.tsx`.',
              'Esc closes one level at a time, as macOS does; see [the Base UI docs](https://base-ui.com/react/components/menu).',
            ],
          },
        ],
        label: 'Lead and paragraphs',
      },
      {
        blocks: [{ kind: 'text', paragraphs: [LONG_LINE], title: 'What changed' }],
        label: 'Titled, long',
      },
      {
        blocks: [
          {
            kind: 'text',
            links: [
              {
                label: 'PR #418 · Seat map on the coach booking',
                url: 'https://github.com/atlas/booking/pull/418',
              },
              { label: 'ATL-79 on Linear', url: 'https://linear.app/atlas/issue/ATL-79' },
              { label: 'Staging', url: 'https://staging.atlas-booking.fr/coach' },
              { label: 'Not a web link (never opens)', url: 'file:///etc/hosts' },
            ],
          },
        ],
        label: 'Links: the PR becomes its card, the rest one line',
      },
    ],
  },
  {
    kind: 'question',
    note: 'The one question the agent waits on: asked, waiting in the chat, or answered.',
    variants: [
      {
        blocks: [
          {
            header: 'Submenus',
            kind: 'question',
            options: [
              {
                description: 'As macOS menus do: rest on the item a moment and it slides out.',
                label: 'On hover, after 150 ms',
                recommended: true,
              },
              {
                description: 'Nothing opens by accident, one more click every time.',
                label: 'Only on click or →',
              },
            ],
            question: 'How should a submenu open: on hover, or only on click and →?',
            status: 'pending',
          },
        ],
        label: 'Waiting in the chat',
      },
      {
        blocks: [
          {
            answer: ['Refund to the card automatically'],
            header: 'Refund',
            kind: 'question',
            options: [
              { label: 'Refund to the card automatically', recommended: true },
              { label: 'An agent approves each refund' },
              { label: 'Credit note only' },
            ],
            question: 'When a trip is cancelled, how does the customer get the money back?',
            status: 'answered',
          },
        ],
        label: 'Answered',
      },
      {
        blocks: [
          {
            kind: 'question',
            options: [],
            question: 'Send through Twilio, or the SMS gateway the agency already pays?',
            status: 'asked',
          },
        ],
        label: 'Asked in the chat, no options',
      },
    ],
  },
  {
    kind: 'context',
    note: 'Why the work exists: the feature, and what people live today.',
    variants: [
      {
        blocks: [
          {
            feature:
              'Agents cancel a trip from the booking page while the customer is on the phone.',
            kind: 'context',
            problem:
              'Today a cancelled trip keeps the customer’s money until someone remembers to refund it by hand, sometimes weeks later.',
          },
        ],
        label: 'Feature and problem',
      },
      {
        blocks: [{ feature: 'Agents find a booking by name, number or city.', kind: 'context' }],
        label: 'Feature only',
      },
    ],
  },
  {
    kind: 'decisions',
    note: 'Product choices made, each with what was set aside.',
    variants: [
      {
        blocks: [
          {
            items: [
              {
                setAside: 'a field over the bookings list only',
                text: 'Search sits in the top bar, on every page (⌘K)',
              },
              {
                setAside: '"New quote" first',
                text: 'Each result has two buttons: "Open" first, "New quote" after',
              },
              { text: 'Cancelled bookings come last, greyed out' },
            ],
            kind: 'decisions',
          },
        ],
        label: 'Three choices',
      },
    ],
  },
  {
    kind: 'screens',
    note: 'A before/after pair, a single screen, or a flow of steps. Click one to zoom.',
    variants: [
      {
        blocks: [
          {
            kind: 'screens',
            steps: [{ after: MENU_STEP.after, before: MENU_STEP.before, caption: MENU_STEP.step }],
          },
        ],
        label: 'Before and after',
      },
      {
        blocks: [
          {
            kind: 'screens',
            steps: [
              {
                after: shot({
                  button: { label: 'New quote' },
                  search: { new: true },
                  title: 'Bookings',
                }),
                before: shot({ button: { label: 'New quote' }, title: 'Bookings' }),
                caption: 'The top bar',
              },
              {
                after: shot({
                  results: ['B-2291 · Martin, Claire', 'B-2304 · Martinez, Noé'],
                  rows: 5,
                  search: { text: 'mart' },
                  title: 'Bookings',
                }),
                caption: 'Results as you type',
              },
              {
                after: shot({
                  button: { label: 'Cancel trip' },
                  cells: [
                    ['Martin, Claire', '12A', 'Lyon → Nice', 'Paid'],
                    ['Martin, Léo', '12B', 'Lyon → Nice', 'Paid'],
                  ],
                  heads: ['Passenger', 'Seat', 'Trip', 'Status'],
                  rows: 2,
                  title: 'Booking B-2291',
                }),
                caption: '"Open" lands on the booking',
              },
            ],
            title: 'Searching a booking',
          },
        ],
        label: 'A flow: a pair, then single screens',
      },
    ],
  },
  {
    kind: 'callout',
    note: 'A note, an assumption made, or a risk.',
    variants: [
      {
        blocks: [
          {
            kind: 'callout',
            text: 'A child whose parent chat was closed showed at the top level of the tree. It now stays under its workspace.',
            title: 'Found on the way',
            tone: 'note',
          },
        ],
        label: 'Note',
      },
      {
        blocks: [
          {
            kind: 'callout',
            text: 'Refunds go back to the card used for the deposit, even when the balance was paid by transfer.',
            tone: 'assumption',
          },
        ],
        label: 'Assumption',
      },
      {
        blocks: [
          {
            kind: 'callout',
            text: 'The migration rewrites 600 drafts in one transaction; run it outside opening hours.',
            title: 'Before the merge',
            tone: 'risk',
          },
        ],
        label: 'Risk',
      },
    ],
  },
  {
    kind: 'steps',
    note: 'What was done, in order.',
    variants: [
      {
        blocks: [
          {
            items: [
              { status: 'done', text: 'Moved the tab menu to Base UI' },
              {
                detail: 'It needs a hover delay first; asked in the report.',
                status: 'skipped',
                text: 'Submenus',
              },
              {
                detail: 'Two snapshots still have the old markup.',
                status: 'failed',
                text: 'Snapshot tests',
              },
              { status: 'done', text: 'Removed the Radix dependency' },
            ],
            kind: 'steps',
          },
        ],
        label: 'Done, skipped, failed',
      },
    ],
  },
  {
    kind: 'table',
    note: 'Key/value pairs or a few columns; scrolls sideways when narrow.',
    variants: [
      {
        blocks: [
          {
            columns: ['Setting', 'Before', 'After'],
            kind: 'table',
            rows: [
              ['Draft lifetime', 'forever', '90 days'],
              ['Warning badge', 'none', '15 days before'],
              ['Trash kept', '—', '30 days'],
            ],
            title: 'Drafts',
          },
        ],
        label: 'Three columns',
      },
    ],
  },
  {
    kind: 'pr',
    note: 'The live PR card (src/cards/pr-card.tsx), as chats and reports show it. What the agent wrote draws until GitHub answers; Merge is the one action (try it: #201, #203 asks louder, #211 is refused).',
    variants: [
      {
        blocks: [
          {
            branch: 'feat/pr-cards',
            ci: 'passing',
            kind: 'pr',
            number: 201,
            review: 'approved',
            title: 'Show a live card for every pull request an agent links',
            url: PR_STATES.passing,
          },
        ],
        label: 'Open, green, approved: Merge',
      },
      {
        blocks: [card('Composer fix', PR_STATES.running)],
        label: 'Checks running (they pass 20 s after the first read)',
      },
      {
        blocks: [card('The chime', PR_STATES.failing)],
        label: 'Failing checks GitHub does not require: Merge asks louder',
      },
      {
        blocks: [card('Host socket', PR_STATES.required)],
        label: 'Blocked: a required check fails, changes asked',
      },
      { blocks: [card('Terminal search', PR_STATES.draft)], label: 'Draft' },
      { blocks: [card('Conflicts', PR_STATES.conflicts)], label: 'Merge conflicts' },
      { blocks: [card('Behind', PR_STATES.behind)], label: 'Out of date with its base' },
      { blocks: [card('Tauri bump', PR_STATES.mergeFails)], label: 'Merge refused by GitHub' },
      { blocks: [card('Update pill', PR_STATES.merged)], label: 'Merged' },
      { blocks: [card('Electron', PR_STATES.closed)], label: 'Closed' },
      { blocks: [card('Long', PR_STATES.long)], label: 'Long title and branch' },
      { blocks: [card('Slow', PR_STATES.slow)], label: 'Loading (gh takes 4 s)' },
      { blocks: [card('Missing', PR_STATES.missing)], label: 'Could not load it: Retry' },
      {
        blocks: [
          {
            ci: 'failing',
            kind: 'pr',
            number: 208,
            review: 'changes',
            title: 'What the agent wrote of it',
            url: PR_STATES.missing,
          },
        ],
        label: 'Could not refresh: the agent’s sketch stays',
      },
    ],
  },
  {
    kind: 'left',
    note: 'What the user still has to do.',
    variants: [
      {
        blocks: [
          {
            items: ['Merge the PR', 'Run the seat migration on production after the merge'],
            kind: 'left',
          },
        ],
        label: 'Two things',
      },
      { blocks: [{ items: [], kind: 'left' }], label: 'Empty (draws nothing)' },
    ],
  },
]

function Variant({
  blocks,
  label,
  onZoom,
  width,
}: {
  label: string
  blocks: ReportBlock[]
  width: number
  onZoom: (zoom: Zoom, from: HTMLButtonElement) => void
}): ReactNode {
  return (
    <div className="flex flex-none flex-col gap-2" style={{ width }}>
      <span className="text-faint text-xs">{label}</span>
      <div className="@container/report">
        <Blocks blocks={blocks} actions={{ onZoom }} />
      </div>
    </div>
  )
}

export function BlocksGallery() {
  const [zoom, setZoom] = useState<Zoom | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const zoomTo = (z: Zoom) => setZoom(z)
  return (
    <div ref={host} className="bg-background relative h-dvh">
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-14 px-8 py-8">
          <header>
            <h1 className="text-title font-semibold">Report blocks</h1>
            <p className="text-muted-foreground text-sm">
              Every block an agent composes a report from, as the Report tab and a chat draw them:
              at a report’s width (left) and in the narrow right panel (right).
            </p>
          </header>
          {KINDS.map((k) => (
            <section key={k.kind} className="flex flex-col gap-6" aria-label={k.kind}>
              <div className="flex items-baseline gap-2 border-b pb-2">
                <h2 className="font-mono text-sm font-medium">{k.kind}</h2>
                <span className="text-muted-foreground text-sm">{k.note}</span>
              </div>
              {k.variants.map((v) => (
                <div key={v.label} className="flex items-start gap-16">
                  <Variant {...v} width={720} onZoom={zoomTo} />
                  <Variant {...v} width={340} onZoom={zoomTo} />
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
      {zoom !== null && host.current !== null && (
        <ZoomedShot
          host={host.current}
          zoom={zoom}
          onZoom={setZoom}
          onClose={() => setZoom(null)}
        />
      )}
    </div>
  )
}
