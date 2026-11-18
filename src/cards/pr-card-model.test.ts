import { expect, test } from 'bun:test'

import { toPullRequest } from '../git/pr'
import {
  alreadyMerged,
  ciSummary,
  ciWords,
  ghProblem,
  mergeOffer,
  mergeQuestion,
} from './pr-card-model'

const ok = (name: string) => ({ conclusion: 'SUCCESS', name, status: 'COMPLETED' })
const bad = (name: string) => ({ conclusion: 'FAILURE', name, status: 'COMPLETED' })
const runs = (name: string) => ({ conclusion: '', name, status: 'IN_PROGRESS' })

const pr = (fields: Record<string, unknown> = {}) =>
  toPullRequest(
    JSON.stringify({
      additions: 1,
      baseRefName: 'main',
      deletions: 1,
      headRefName: 'feat/x',
      isDraft: false,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      number: 7,
      state: 'OPEN',
      statusCheckRollup: [ok('a'), ok('b')],
      title: 't',
      url: 'https://github.com/o/r/pull/7',
      ...fields,
    })
  )

test('the CI line counts what fails first, then what runs', () => {
  expect(
    ciWords(ciSummary(pr({ statusCheckRollup: [ok('a'), bad('b'), runs('c')] }).checks))
  ).toEqual({ count: 'of 3', text: '1 check failing' })
  expect(
    ciWords(ciSummary(pr({ statusCheckRollup: [ok('a'), runs('b'), runs('c')] }).checks))
  ).toEqual({ count: '1/3', text: 'Checks running' })
  expect(ciWords(ciSummary(pr().checks))).toEqual({ count: '2', text: 'Checks passed' })
  expect(ciSummary(pr({ statusCheckRollup: [] }).checks).tone).toBe('none')
})

test('Merge is offered exactly when the git panel offers it', () => {
  expect(mergeOffer(pr())).toEqual({ kind: 'merge', risky: false })
  // Failing checks GitHub does not require: it merges, and asks out loud.
  const unstable = pr({ mergeStateStatus: 'UNSTABLE', statusCheckRollup: [ok('a'), bad('b')] })
  expect(mergeOffer(unstable)).toEqual({ kind: 'merge', risky: true })
  expect(mergeQuestion(unstable, true)).toBe('1 check failing. Merge anyway?')
  expect(mergeQuestion(pr(), false)).toBe('Merge #7 into main?')
})

test('a PR that cannot merge says why, and a finished one offers nothing', () => {
  const reason = (fields: Record<string, unknown>) => {
    const offer = mergeOffer(pr(fields))
    return offer.kind === 'blocked' ? offer.reason : offer.kind
  }
  expect(reason({ isDraft: true })).toMatch(/draft/i)
  expect(reason({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' })).toMatch(/conflicts/)
  expect(reason({ statusCheckRollup: [runs('a')] })).toMatch(/still running/)
  expect(reason({ mergeStateStatus: 'BLOCKED' })).toMatch(/branch rules/)
  expect(reason({ mergeStateStatus: 'BEHIND' })).toBe(
    'Out of date with main: update the branch first'
  )
  expect(reason({ state: 'MERGED' })).toBe('none')
  expect(reason({ state: 'CLOSED' })).toBe('none')
})

test('gh failures read as what to do', () => {
  expect(ghProblem('gh is not installed (https://cli.github.com)')).toMatch(/Install gh/)
  expect(ghProblem('To get started with GitHub CLI, please run:  gh auth login')).toMatch(
    /gh auth login/
  )
  expect(
    ghProblem('GraphQL: Pull request is not mergeable: the merge commit cannot be cleanly created.')
  ).toMatch(/conflicts/)
  expect(ghProblem('GraphQL: Base branch policy prohibits the merge')).toMatch(/branch rules/)
  expect(ghProblem('GraphQL: Required status check "test" is expected.')).toMatch(/Required checks/)
  expect(ghProblem('HTTP 403: Resource not accessible by integration')).toMatch(/allowed/)
  expect(ghProblem('GraphQL: Could not resolve to a PullRequest with the number of 9.')).toMatch(
    /wasn’t found/
  )
  expect(ghProblem('gh did not answer in time (network?)')).toMatch(/connection/)
  const push = 'Push first: 2 commits on feat/x not on GitHub yet would be left out.'
  expect(ghProblem(push)).toBe(push)
  expect(ghProblem('something odd\nmore')).toBe('something odd')
})

test('a PR merged meanwhile is a merge done', () => {
  expect(alreadyMerged('Pull request o/r#7 was already merged')).toBe(true)
  expect(alreadyMerged('GraphQL: Pull Request has already been merged')).toBe(true)
  expect(alreadyMerged('not mergeable')).toBe(false)
})
