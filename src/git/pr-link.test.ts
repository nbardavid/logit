import { expect, test } from 'bun:test'

import { prLinksIn, prRef } from './pr-link'

const R = 'https://github.com/nbardavid/logit/pull'

test('an address names its PR, whatever follows the number', () => {
  expect(prRef(`${R}/128`)).toEqual({
    key: 'nbardavid/logit#128',
    number: 128,
    owner: 'nbardavid',
    repo: 'logit',
    url: `${R}/128`,
  })
  expect(prRef(`${R}/128/files#diff-1`)?.url).toBe(`${R}/128`)
  expect(prRef('https://github.com/NBardavid/Logit/pull/128')?.key).toBe('nbardavid/logit#128')
})

test('anything but a GitHub PR address is no PR', () => {
  expect(prRef(`${R}/`)).toBeNull()
  expect(prRef('https://github.com/nbardavid/logit/issues/3')).toBeNull()
  expect(prRef('https://gitlab.com/a/b/pull/3')).toBeNull()
  expect(prRef(`see ${R}/3`)).toBeNull()
  expect(prRef(`http://github.com/nbardavid/logit/pull/3`)).toBeNull()
  expect(prRef(`${R}/1234567890`)).toBeNull()
})

test('a text links each PR once, in the order it first names them', () => {
  const text = `[#3](${R}/3) then ${R}/1, again ${R}/3/files and (${R}/2).`
  expect(prLinksIn(text).map((r) => r.number)).toEqual([3, 1, 2])
  expect(prLinksIn('no link here')).toEqual([])
})

test('reading one address leaves the next text read from its start', () => {
  // A global regex shared by both would start the second read past the first address.
  expect(prRef(`${R}/77`)?.number).toBe(77)
  expect(prLinksIn(`- One, ${R}/5, then more.`).map((r) => r.number)).toEqual([5])
})

test('code shown in a fence links nothing; the prose around it does', () => {
  const text = [
    `Merged ${R}/1.`,
    '```sh',
    `gh pr view ${R}/2`,
    `gh pr checks ${R}/3`,
    '```',
    `And ${R}/4.`,
  ].join('\n')
  expect(prLinksIn(text).map((r) => r.number)).toEqual([1, 4])
  // Still open (an agent writing it, or a broken fence): it runs to the end.
  expect(prLinksIn(`${R}/1\n~~~\n${R}/2\nstill code ${R}/3`).map((r) => r.number)).toEqual([1])
})
