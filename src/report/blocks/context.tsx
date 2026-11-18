import type { ContextBlock } from './types'

import { BlockHead, has, Inline } from './primitives'

/** Why the work exists: the feature and the problem, side by side when there is room. */
export function Context({ feature, problem }: Omit<ContextBlock, 'kind'>) {
  const parts: [string, string][] = []
  if (has(feature)) parts.push(['The feature', feature])
  if (has(problem)) parts.push(['The problem', problem])
  if (parts.length === 0) return null
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-5 @min-[520px]/report:grid-cols-2">
      {parts.map(([label, text]) => (
        <section key={label}>
          <BlockHead>{label}</BlockHead>
          <p className="text-ink-soft text-sm leading-5 text-pretty break-words whitespace-pre-line select-text">
            <Inline text={text} />
          </p>
        </section>
      ))}
    </div>
  )
}
