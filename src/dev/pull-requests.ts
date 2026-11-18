// Pull requests named by their address, as `gh pr view <url>` answers them in the preview: the
// PR card (src/cards/pr-card.tsx) in every state. The workspaces' own PRs (fixtures' `PRS`) are
// the same objects, so a merge from a card shows in the git panel and the other way round.
// `?prs` gives amber a chat and teal a report that link them; `?pr-slow` holds every read 3 s,
// `?pr-fail` fails every read (gh signed out), `?pr-merge-fail` fails every merge.
import type { Report } from '../model/report'

import { assistant, asTranscript, PRS, result, sent } from './fixtures'

type RawPr = { state: string } & Record<string, unknown>

const REPO = 'https://github.com/nbardavid/logit/pull'

const ok = (name: string) => ({ conclusion: 'SUCCESS', name, status: 'COMPLETED' })
const bad = (name: string) => ({ conclusion: 'FAILURE', name, status: 'COMPLETED' })
const runs = (name: string) => ({ conclusion: '', name, status: 'IN_PROGRESS' })

function pr(url: string, fields: Partial<RawPr> & { title: string }): RawPr {
  return {
    additions: 120,
    baseRefName: 'main',
    body: '',
    changedFiles: 6,
    deletions: 34,
    headRefName: 'feat/pr-cards',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    number: Number(url.split('/').pop()),
    reviewDecision: '',
    state: 'OPEN',
    statusCheckRollup: [ok('lint'), ok('test'), ok('build')],
    url,
    ...fields,
  }
}

/** Each state the card draws, by number (`nbardavid/logit#n`). */
export const PR_STATES = {
  behind: `${REPO}/213`,
  closed: `${REPO}/207`,
  conflicts: `${REPO}/210`,
  draft: `${REPO}/205`,
  failing: `${REPO}/203`,
  long: `${REPO}/212`,
  merged: `${REPO}/206`,
  mergeFails: `${REPO}/211`,
  missing: `${REPO}/208`,
  passing: `${REPO}/201`,
  required: `${REPO}/204`,
  running: `${REPO}/202`,
  slow: `${REPO}/209`,
} as const

const LISTED: RawPr[] = [
  // The fixtures' reports link these.
  pr('https://github.com/atlas/booking/pull/418', {
    additions: 640,
    deletions: 85,
    headRefName: 'feat/coach-seat-map',
    reviewDecision: 'APPROVED',
    statusCheckRollup: [ok('unit'), ok('e2e'), ok('lint')],
    title: 'Seat map on the coach booking',
  }),
  pr('https://github.com/nbardavid/logit/pull/999', {
    title:
      'Un titre de pull request qui ne s’arrête jamais, pour voir comment la carte le coupe quand il dépasse',
  }),
  pr('https://github.com/pragma/labo-app/pull/412', {
    additions: 96,
    deletions: 12,
    headRefName: 'feat/draft-trash',
    reviewDecision: 'REVIEW_REQUIRED',
    title: 'Brouillons à la corbeille après 90 jours',
  }),
  pr(PR_STATES.behind, {
    headRefName: 'fix/quota-poll',
    mergeStateStatus: 'BEHIND',
    title: 'Poll the quota endpoint every 180 s at most',
  }),
  pr(PR_STATES.closed, {
    additions: 6,
    deletions: 1,
    headRefName: 'try/electron',
    state: 'CLOSED',
    statusCheckRollup: [],
    title: 'Try Electron instead of Tauri',
  }),
  pr(PR_STATES.conflicts, {
    headRefName: 'feat/sidebar-groups',
    mergeable: 'CONFLICTING',
    mergeStateStatus: 'DIRTY',
    title: 'Group the sidebar by project',
  }),
  pr(PR_STATES.draft, {
    additions: 18,
    deletions: 2,
    headRefName: 'wip/terminal-search',
    isDraft: true,
    mergeStateStatus: 'DRAFT',
    statusCheckRollup: [ok('lint'), runs('test')],
    title: 'Search inside a terminal tab',
  }),
  pr(PR_STATES.failing, {
    additions: 58,
    deletions: 9,
    headRefName: 'feat/desk-sounds',
    mergeStateStatus: 'UNSTABLE',
    statusCheckRollup: [ok('lint'), ok('test'), bad('visual snapshots'), bad('a11y audit')],
    title: 'A soft chime when an agent waits on you',
  }),
  pr(PR_STATES.long, {
    additions: 4210,
    deletions: 3876,
    headRefName: 'feat/a-very-long-branch-name-that-goes-on-and-on-past-any-panel',
    reviewDecision: 'REVIEW_REQUIRED',
    title:
      'Rework how the host restarts when its protocol changed, so chats come back reloaded from the transcript and resumed, and terminals say plainly that they could not',
  }),
  pr(PR_STATES.merged, {
    headRefName: 'fix/update-pill',
    reviewDecision: 'APPROVED',
    state: 'MERGED',
    title: 'The update pill waits for the window to come back',
  }),
  pr(PR_STATES.mergeFails, {
    headRefName: 'chore/bump-tauri',
    title: 'Bump Tauri to 2.9',
  }),
  pr(PR_STATES.passing, {
    additions: 412,
    deletions: 268,
    headRefName: 'feat/pr-cards',
    reviewDecision: 'APPROVED',
    title: 'Show a live card for every pull request an agent links',
  }),
  pr(PR_STATES.required, {
    headRefName: 'refactor/host-socket',
    mergeStateStatus: 'BLOCKED',
    reviewDecision: 'CHANGES_REQUESTED',
    statusCheckRollup: [ok('lint'), bad('cargo test'), ok('build')],
    title: 'Move the host socket under the profile folder',
  }),
  pr(PR_STATES.running, {
    headRefName: 'fix/composer-focus',
    mergeStateStatus: 'BLOCKED',
    reviewDecision: 'REVIEW_REQUIRED',
    statusCheckRollup: [
      ok('lint'),
      ok('typecheck'),
      ok('unit'),
      runs('e2e (macos-14)'),
      runs('e2e (ubuntu)'),
      runs('build'),
    ],
    title: 'Keep the composer focused after a slash command',
  }),
  pr(PR_STATES.slow, {
    headRefName: 'perf/transcript-window',
    title: 'Window the transcript past 200 exchanges',
  }),
]
const BY_URL: Record<string, RawPr> = Object.fromEntries(
  [...Object.values(PRS), ...LISTED].map((p) => [String(p.url), p])
)

const wait = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
/** When #202's checks were first read: they finish 20 s later. */
let runningSince = 0

/** `pr_view_url`: the PR at that address, as gh prints it. */
export async function prViewUrl(url: string, flags: URLSearchParams): Promise<string> {
  const canonical = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.exec(url)?.[0] ?? url
  let ms = 450
  if (canonical === PR_STATES.slow) ms = 4000
  if (flags.has('pr-slow')) ms = 3000
  await wait(ms)
  if (flags.has('pr-fail'))
    throw new Error(
      'To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.'
    )
  const found = BY_URL[canonical]
  if (found === undefined || canonical === PR_STATES.missing)
    throw new Error(
      `GraphQL: Could not resolve to a PullRequest with the number of ${canonical.split('/').pop()}. (repository.pullRequest)`
    )
  if (canonical === PR_STATES.running) {
    if (runningSince === 0) runningSince = Date.now()
    else if (Date.now() - runningSince > 20_000)
      Object.assign(found, {
        mergeStateStatus: 'CLEAN',
        statusCheckRollup: [
          ok('lint'),
          ok('typecheck'),
          ok('unit'),
          ok('e2e (macos-14)'),
          ok('e2e (ubuntu)'),
          ok('build'),
        ],
      })
  }
  return JSON.stringify(found)
}

/** `pr_merge_url`: armed → merging (1.4 s) → merged, or gh's refusal. */
export async function prMergeUrl(url: string, flags: URLSearchParams): Promise<null> {
  await wait(1400)
  const found = BY_URL[url]
  if (found === undefined) throw new Error('GraphQL: Could not resolve to a PullRequest.')
  if (flags.has('pr-merge-fail') || url === PR_STATES.mergeFails)
    throw new Error(
      'GraphQL: Base branch policy prohibits the merge: at least 1 approving review is required by reviewers with write access. (mergePullRequest)'
    )
  if (found.mergeable === 'CONFLICTING')
    throw new Error(
      'GraphQL: Pull request is not mergeable: the merge commit cannot be cleanly created. (mergePullRequest)'
    )
  Object.assign(found, { mergeStateStatus: 'UNKNOWN', state: 'MERGED' })
  return null
}

/** `?prs`: amber's chat that links every state, as Claude would mention them. */
export const PR_CHAT = {
  record: (now: number) => ({
    activeAt: now - 60_000,
    createdAt: now - 30 * 60_000,
    effort: 'high',
    id: 'chat-prs',
    model: 'opus',
    sessionId: 'session-prs',
    title: 'Ship this week’s pull requests',
    workspaceId: 'ws-amber',
  }),
  transcript: () =>
    asTranscript([
      sent('u-prs-1', 'Where do this week’s PRs stand?'),
      assistant('m-prs-1', [
        {
          text: `Here is where each one stands.

The PR card work is ready: [#201](${PR_STATES.passing}) is green and approved. The composer fix, ${PR_STATES.running}, is still running its end-to-end checks; I will look again once they finish. As said, [#201](${PR_STATES.passing}) can go first.`,
          type: 'text',
        },
      ]),
      result(0.0412, 18_400),
      sent('u-prs-2', 'And the rest?'),
      assistant('m-prs-2', [
        {
          text: `- The chime, ${PR_STATES.failing}, fails two checks GitHub does not require (visual snapshots, a11y).
- The host socket move, ${PR_STATES.required}, has changes requested and a failing required check.
- Terminal search is a draft: ${PR_STATES.draft}.
- ${PR_STATES.conflicts} conflicts with main since the sidebar refactor.
- The Tauri bump, ${PR_STATES.mergeFails}, still needs an approving review: merging will be refused.

Older ones, for the record: ${PR_STATES.merged} (merged) and ${PR_STATES.closed} (closed). One link I could not open: ${PR_STATES.missing}.

\`\`\`sh
gh pr view ${PR_STATES.slow} --json state
\`\`\`

The transcript windowing PR is slow to answer: ${PR_STATES.slow}. The long one is ${PR_STATES.long}, and ${PR_STATES.behind} is behind main.`,
          type: 'text',
        },
      ]),
      result(0.0631, 24_900),
    ]),
}

/** `?prs`: teal's report names PRs every way an agent can: a `pr` block, its text, its links. */
export const prReport = (now: number): Report => ({
  at: now - 4 * 60_000,
  blocks: [
    {
      kind: 'text',
      lead: 'The PR card is in, and the three PRs it rests on are listed with it.',
      paragraphs: [
        `The chime (${PR_STATES.failing}) fails two checks GitHub does not require; it can go, at your risk.`,
      ],
    },
    {
      branch: 'feat/pr-cards',
      ci: 'passing',
      kind: 'pr',
      number: 201,
      review: 'approved',
      title: 'Show a live card for every pull request an agent links',
      url: PR_STATES.passing,
    },
    {
      kind: 'callout',
      text: `The composer fix, ${PR_STATES.running}, waits on its end-to-end checks.`,
      tone: 'note',
    },
  ],
  chatId: 'chat-notes',
  choices: [],
  left: [],
  links: [
    { label: 'The composer fix', url: PR_STATES.running },
    { label: 'Terminal search (draft)', url: PR_STATES.draft },
    { label: 'Design notes', url: 'https://www.figma.com/file/pr-cards' },
  ],
  screens: [],
  state: 'ready',
  summary: 'Every PR an agent links shows as a live card, with one Merge.',
  title: 'Live PR cards',
  workspaceId: 'ws-teal',
})
