import { CircleAlertIcon, InfoIcon, LightbulbIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

import type { CalloutBlock } from './types'

import { has, Inline } from './primitives'

const TONE = {
  assumption: { box: 'bg-warn-wash', Icon: LightbulbIcon, icon: 'text-warn', word: 'Assumption' },
  note: { box: 'bg-chrome border border-border', Icon: InfoIcon, icon: 'text-faint', word: 'Note' },
  risk: { box: 'bg-critical-wash', Icon: CircleAlertIcon, icon: 'text-critical', word: 'Risk' },
} as const

/** A note, an assumption the agent made, or a risk: its own quiet tint and icon. */
export function Callout({ text, title, tone }: Omit<CalloutBlock, 'kind'>) {
  if (!has(text)) return null
  const t = TONE[tone]
  return (
    <aside className={cn('flex gap-2.5 rounded-lg px-3.5 py-3', t.box)} aria-label={t.word}>
      <t.Icon className={cn('mt-0.5 size-4 flex-none', t.icon)} strokeWidth={1.75} />
      <div className="min-w-0 flex-1 text-sm leading-5">
        <p className="text-foreground font-medium">{has(title) ? title : t.word}</p>
        <p className="text-ink-soft mt-0.5 text-pretty break-words select-text">
          <Inline text={text} />
        </p>
      </div>
    </aside>
  )
}
