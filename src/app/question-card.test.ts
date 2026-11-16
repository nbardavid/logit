import { expect, test } from 'bun:test'

import { answerOf, splitRecommended } from './question-card'

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
