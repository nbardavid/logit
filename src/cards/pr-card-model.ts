// What the PR card says, as plain functions: its checks in one line, whether Merge is offered
// (as the git panel's head decides it), which workspace a merged PR closes, and gh's and git's
// failures in words a person can act on.
import { type Check, prHeadline, type PullRequest, uncommittedRefusal } from '../git/pr'

export interface CiSummary {
  tone: 'none' | 'running' | 'passing' | 'failing'
  failing: number
  running: number
  passed: number
  /** Every check that counts (skipped ones don't). */
  total: number
}

export function ciSummary(checks: readonly Check[]): CiSummary {
  const count = (state: Check['state']) => checks.filter((c) => c.state === state).length
  const failing = count('failing')
  const running = count('pending')
  const passed = count('passing')
  const total = failing + running + passed
  let tone: CiSummary['tone'] = 'none'
  if (failing > 0) tone = 'failing'
  else if (running > 0) tone = 'running'
  else if (passed > 0) tone = 'passing'
  return { failing, passed, running, tone, total }
}

/** The CI line's words: the state, then its count, quieter. */
export function ciWords(ci: CiSummary): { text: string; count: string } {
  if (ci.tone === 'failing')
    return {
      count: `of ${ci.total}`,
      text: `${ci.failing} ${ci.failing === 1 ? 'check' : 'checks'} failing`,
    }
  if (ci.tone === 'running')
    return { count: `${ci.total - ci.running}/${ci.total}`, text: 'Checks running' }
  if (ci.tone === 'passing') return { count: `${ci.passed}`, text: 'Checks passed' }
  return { count: '', text: 'No checks' }
}

export type MergeOffer =
  /** Merge is the action. `risky`: checks fail that GitHub does not require; it asks out loud. */
  | { kind: 'merge'; risky: boolean }
  /** Merge shows, disabled, and says why. */
  | { kind: 'blocked'; reason: string }
  /** Merged or closed: nothing left to do here. */
  | { kind: 'none' }

/** Whether Merge is offered, from the same headline the git panel's head uses. */
export function mergeOffer(pr: PullRequest): MergeOffer {
  const headline = prHeadline(pr)
  if (pr.state === 'Merged' || pr.state === 'Closed') return { kind: 'none' }
  if (headline.action === 'merge')
    return { kind: 'merge', risky: pr.checks.some((c) => c.state === 'failing') }
  const reason: Record<string, string> = {
    'Blocked': 'Blocked by the branch rules: a required review or check is missing',
    'Checking…': 'GitHub is still working out whether it can merge',
    'Checks running': 'Checks are still running',
    'Draft': 'A draft: mark it ready for review first',
    'Merge conflicts': 'It has merge conflicts: resolve them on the branch first',
    'Out of date': `Out of date with ${pr.base || 'its base'}: update the branch first`,
  }
  return { kind: 'blocked', reason: reason[headline.label] ?? headline.label }
}

/** What the armed Merge asks, in the card's second line (the warning first, as the panel). */
export function mergeQuestion(pr: PullRequest, risky: boolean): string {
  const into = pr.base === '' ? '' : ` into ${pr.base}`
  if (!risky) return `Merge #${pr.number}${into}?`
  const failing = pr.checks.filter((c) => c.state === 'failing').length
  return `${failing} ${failing === 1 ? 'check' : 'checks'} failing. Merge anyway?`
}

/**
 * The workspace a merged PR closes: the one the card sits in (`cwd`, its folder: a chat's or a
 * report's workspace), when the PR's head is its branch. Someone else's PR, or one of another
 * branch, has none.
 */
export function workspaceOfPr<W extends { path: string; branch: string }>(
  workspaces: readonly W[],
  cwd: string | undefined,
  pr: Pick<PullRequest, 'head' | 'state'>
): W | null {
  if (pr.state !== 'Merged' || pr.head === '' || cwd === undefined || cwd === '') return null
  return workspaces.find((w) => w.path === cwd && w.branch === pr.head) ?? null
}

/** What the armed Delete workspace asks, as the git panel's Clean up does. */
export function deleteQuestion(name: string, force: boolean): string {
  if (force) return 'Its uncommitted changes will be lost. Delete anyway?'
  return `Delete ${name}? Its worktree folder goes; the branch stays.`
}

/** A refused delete in words: git's own first line unless it is the uncommitted changes. */
export function deleteProblem(raw: string): string {
  if (uncommittedRefusal(raw)) return 'It has uncommitted changes. Delete anyway to discard them.'
  // A thrown Error (not the host's plain string) says so first: not words for the user.
  const e = raw.trim().replace(/^Error:\s*/, '')
  return e.split('\n')[0] ?? e
}

/** gh said the PR is merged already: what the user wanted is done. */
export const alreadyMerged = (error: string) => /already (been )?merged/i.test(error)

/**
 * A gh failure as one sentence that says what to do. gh's own words when nothing better
 * is known (its first line).
 */
export function ghProblem(raw: string): string {
  const e = raw.trim()
  if (e.startsWith('Push first')) return e
  if (/gh is not installed|gh: .*no such file/i.test(e))
    return 'The GitHub CLI isn’t installed. Install gh, then retry.'
  if (/gh auth login|not logged in|authenticat|bad credentials|HTTP 401/i.test(e))
    return 'gh isn’t signed in to GitHub. Run gh auth login, then retry.'
  if (/is (still )?a draft/i.test(e)) return 'It’s a draft. Mark it ready for review first.'
  // Before the conflicts: gh says "not mergeable" for a missing review too.
  if (/approving review|review is required|review required/i.test(e))
    return 'It needs an approving review before it can be merged.'
  if (
    /required status check|checks? (are|is) (expected|required|pending)|checks? must pass/i.test(e)
  )
    return 'Required checks haven’t passed yet.'
  if (/base branch policy|branch protection/i.test(e))
    return 'The branch rules block it: a required review or check is missing.'
  if (/not mergeable|merge conflict|cannot be cleanly created/i.test(e))
    return 'It has merge conflicts. Resolve them on the branch, then retry.'
  if (/permission|not authorized|must have (admin|write)|HTTP 403|forbidden/i.test(e))
    return 'Your GitHub account isn’t allowed to merge this pull request.'
  if (/could not resolve to a (pullrequest|repository)|HTTP 404|not found/i.test(e))
    return 'This pull request wasn’t found, or gh can’t see its repository.'
  if (/did not answer|could not resolve host|dial tcp|connection|timed? ?out|network|EOF/i.test(e))
    return 'GitHub didn’t answer. Check the connection, then retry.'
  return e.split('\n')[0] ?? e
}
