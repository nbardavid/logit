import { expect, test } from 'bun:test'

import { answerOf, digitTarget, splitRecommended } from './question-card'

const q = (multiSelect: boolean) => ({ header: '', multiSelect, options: [], question: 'Q?' })

test('one choice: the typed answer wins over the option', () => {
  expect(answerOf(q(false), ['Apple'], '')).toBe('Apple')
  expect(answerOf(q(false), [], '  Kiwi ')).toBe('Kiwi')
  expect(answerOf(q(false), [], '')).toBe('')
})

test('several choices: the labels, then what was typed, joined by ", "', () => {
  expect(answerOf(q(true), ['Apple', 'Pear'], 'Kiwi')).toBe('Apple, Pear, Kiwi')
  expect(answerOf(q(true), [], '')).toBe('')
})

test('"(Recommended)" at the end of a label becomes a badge', () => {
  expect(splitRecommended('Seuil 200 car. (Recommended)')).toEqual({
    recommended: true,
    text: 'Seuil 200 car.',
  })
  expect(splitRecommended('Garder (recommandé)')).toEqual({ recommended: true, text: 'Garder' })
  expect(splitRecommended('Rien')).toEqual({ recommended: false, text: 'Rien' })
})

test('a digit picks in the focused question, else the first unanswered, else the first', () => {
  const q = (question: string, labels: string[]) => ({
    header: '',
    multiSelect: false,
    options: labels.map((label) => ({ description: '', label })),
    question,
  })
  const qs = [q('One', ['a', 'b']), q('Two', ['c', 'd', 'e'])]
  expect(digitTarget(qs, ['', ''], -1, 2)).toEqual({ label: 'b', question: 0 })
  expect(digitTarget(qs, ['a', ''], -1, 3)).toEqual({ label: 'e', question: 1 })
  expect(digitTarget(qs, ['a', 'c'], -1, 1)).toEqual({ label: 'a', question: 0 })
  expect(digitTarget(qs, ['', ''], 1, 1)).toEqual({ label: 'c', question: 1 })
  expect(digitTarget(qs, ['', ''], -1, 5)).toBe(null)
})
