// A page saved before sections (one snapshot per call: feature, problem, choices, screens,
// links, left), as the host maps it when it reads one (`Mapped::new` in report.rs): the browser
// preview has no host to do it, so the old fixture goes through this mirror of it.
import type { Report, ReportSections } from '../model/report'
import type { ReportBlock } from '../report/blocks/types'

export interface LegacyReport extends Omit<Report, 'sections' | 'question'> {
  feature?: string
  problem?: string
  choices: { text: string; open: boolean; setAside?: string }[]
  screens: { step: string; before?: string; after?: string }[]
  links: { label: string; url: string }[]
  left: string[]
}

const SCREEN_STEPS = 8

export function fromLegacy(old: LegacyReport): Report {
  const { choices, feature, left, links, problem, screens, ...head } = old
  const s: ReportSections = {}
  const said = (t?: string) => (t?.trim() === '' ? undefined : t?.trim())
  if (said(feature) !== undefined || said(problem) !== undefined)
    s.understood = [{ feature: said(feature), kind: 'context', problem: said(problem) }]
  const made = choices.filter((c) => !c.open)
  if (made.length > 0)
    s.plan = [
      { items: made.map((c) => ({ setAside: said(c.setAside), text: c.text })), kind: 'decisions' },
    ]
  const result: ReportBlock[] = []
  for (let i = 0; i < screens.length; i += SCREEN_STEPS)
    result.push({
      kind: 'screens',
      steps: screens.slice(i, i + SCREEN_STEPS).map((x) => ({
        after: x.after,
        before: x.before,
        caption: x.step,
      })),
    })
  if (links.length > 0) result.push({ kind: 'text', links })
  if (result.length > 0) s.result = result
  const kept = left.map((l) => l.trim()).filter((l) => l !== '')
  if (kept.length > 0) s.left = kept
  const question = choices.find((c) => c.open)?.text
  return { ...head, question, sections: s }
}
