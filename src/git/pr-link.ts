// GitHub pull-request links in what agents write: a chat message, a report's text or links.
// Each distinct PR becomes one card (src/cards/pr-card.tsx); the host refuses any other address.

export interface PrRef {
  /** The canonical address: `https://github.com/<owner>/<repo>/pull/<n>`, nothing after. */
  url: string
  owner: string
  repo: string
  number: number
  /** One PR, however it is written: `owner/repo#n`, lower case (GitHub ignores case there). */
  key: string
}

const NAME = '[A-Za-z0-9_][\\w.-]*'
const ADDRESS = `https://github\\.com/(${NAME})/(${NAME})/pull/(\\d{1,9})(?!\\d)`
// Two of them: a global regex keeps a `lastIndex`, which `matchAll` would start from. This one
// only ever goes to `matchAll` (it matches on a copy), the anchored one only to `exec`.
const PR_URL = new RegExp(ADDRESS, 'g')
const PR_AT_START = new RegExp(`^${ADDRESS}`)

const toRef = (owner: string, repo: string, n: string): PrRef => ({
  key: `${owner}/${repo}#${n}`.toLowerCase(),
  number: Number(n),
  owner,
  repo,
  url: `https://github.com/${owner}/${repo}/pull/${n}`,
})

/** The PR an address names (`/files`, a `#comment` and the like ignored), or null. */
export function prRef(url: string): PrRef | null {
  const m = PR_AT_START.exec(url)
  if (m === null) return null
  const [, owner = '', repo = '', n = ''] = m
  return toRef(owner, repo, n)
}

// A fenced block is code shown, not a PR pointed at (a `gh` command, a log).
// Unclosed, it runs to the end of the text (`(?![\s\S])`: `$` is any line's end here).
const FENCED = /^ {0,3}(```|~~~)[^\n]*\n[\s\S]*?(?:\n {0,3}\1[^\n]*(?=\n|$)|(?![\s\S]))/gm

/** Every distinct PR the text links to, in the order they first appear. */
export function prLinksIn(text: string): PrRef[] {
  if (!text.includes('github.com/')) return []
  const prose = text.replaceAll(FENCED, '')
  const seen = new Map<string, PrRef>()
  for (const m of prose.matchAll(PR_URL)) {
    const [, owner = '', repo = '', n = ''] = m
    const ref = toRef(owner, repo, n)
    if (!seen.has(ref.key)) seen.set(ref.key, ref)
  }
  return [...seen.values()]
}
