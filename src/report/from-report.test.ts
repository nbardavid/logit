import { expect, test } from 'bun:test'

import type { Report } from '../model/report'

import { fromLegacy, type LegacyReport } from '../dev/legacy'
import { pageOf, trailingEmpty } from './from-report'

const PR = 'https://github.com/o/r/pull/7'

const report = (o: Partial<Report> = {}): Report => ({
  at: 1,
  chatId: 'c',
  sections: {},
  state: 'working',
  summary: 'Badges show unread counts.',
  title: 'Badges',
  workspaceId: 'w',
  ...o,
})

test('the six sections come in their fixed order, empty ones marked', () => {
  const page = pageOf(
    report({
      sections: {
        progress: [{ status: 'current', text: 'Code' }],
        understood: [{ feature: 'The sidebar.', kind: 'context' }],
      },
      updated: { understood: 5 },
    })
  )
  expect(page.sections.map((s) => s.label)).toEqual([
    'The ticket',
    'What I understood',
    'What I will do',
    'Progress',
    'Result',
    'Left for you',
  ])
  expect(page.sections.map((s) => s.empty)).toEqual([true, false, true, false, true, true])
  expect(page.sections[1]?.at).toBe(5)
  expect(page.sections[3]?.progress).toEqual([{ status: 'current', text: 'Code' }])
  expect(page.lead).toEqual([{ kind: 'text', lead: 'Badges show unread counts.' }])
  // The empty ones that close the page fold into one line; a single one does not.
  expect(trailingEmpty(page.sections)).toBe(2)
  const one = pageOf(report({ sections: { result: [{ kind: 'text', lead: 'x' }] } }))
  expect(trailingEmpty(one.sections)).toBe(0)
  expect(trailingEmpty(pageOf(report()).sections)).toBe(6)
})

test('blocked leads with its reason; a question shows only while it is the state', () => {
  expect(pageOf(report({ state: 'blocked' })).lead).toEqual([
    { kind: 'callout', text: 'Badges show unread counts.', title: 'Blocked', tone: 'risk' },
  ])
  const asked = report({ question: 'Which colour?', state: 'question' })
  expect(pageOf(asked).asks).toEqual([
    { kind: 'question', options: [], question: 'Which colour?', status: 'asked' },
  ])
  // Where it is asked elsewhere (the chat's card, beside the Report tab), it is written once, there.
  expect(pageOf(asked, { question: false }).asks).toEqual([])
  expect(pageOf({ ...asked, state: 'review' }).asks).toEqual([])
})

test("a PR's card shows once across the page, under the first block naming it", () => {
  const page = pageOf(
    report({
      sections: {
        plan: [{ kind: 'text', paragraphs: [`Rests on ${PR}.`] }],
        result: [{ kind: 'text', links: [{ label: 'The PR', url: PR }] }],
      },
    })
  )
  const plan = page.sections.find((s) => s.name === 'plan')
  const result = page.sections.find((s) => s.name === 'result')
  expect(plan?.cards[0]?.map((c) => c.number)).toEqual([7])
  expect(result?.cards[0]).toEqual([])
  // Its link left the line for the card.
  expect(result?.blocks[0]).toEqual({ kind: 'text', links: [] })
})

test('left for you draws as a list without its head; merged, the merge is done', () => {
  const page = pageOf(report({ sections: { left: ['Merge the PR', 'Run the migration'] } }), {
    merged: true,
  })
  expect(page.sections.at(-1)?.blocks).toEqual([
    { items: ['Run the migration'], kind: 'left', title: '' },
  ])
})

test('a page saved before sections reads into them', () => {
  const old: LegacyReport = {
    at: 1,
    chatId: 'c',
    choices: [
      { open: false, setAside: 'red', text: 'Blue badges' },
      { open: true, text: 'Which corner?' },
    ],
    feature: 'The sidebar.',
    left: ['Merge it', ' '],
    links: [{ label: 'Ticket', url: 'https://x/1' }],
    problem: 'You miss replies.',
    screens: [{ after: 'data:a', step: 'The row' }],
    state: 'question',
    summary: 's',
    title: 't',
    workspaceId: 'w',
  }
  const page = fromLegacy(old)
  expect(page.question).toBe('Which corner?')
  expect(page.sections).toEqual({
    left: ['Merge it'],
    plan: [{ items: [{ setAside: 'red', text: 'Blue badges' }], kind: 'decisions' }],
    result: [
      { kind: 'screens', steps: [{ after: 'data:a', before: undefined, caption: 'The row' }] },
      { kind: 'text', links: [{ label: 'Ticket', url: 'https://x/1' }] },
    ],
    understood: [{ feature: 'The sidebar.', kind: 'context', problem: 'You miss replies.' }],
  })
  expect(pageOf(page).asks).toHaveLength(1)
})
