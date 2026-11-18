import { beforeEach, expect, mock, test } from 'bun:test'

// gh, as the window's commands answer it: never a real PR.
const calls: { cmd: string; args: Record<string, unknown> }[] = []
let answer: (cmd: string, args: Record<string, unknown>) => Promise<unknown> = async () => null
void mock.module('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    calls.push({ args, cmd })
    return answer(cmd, args)
  },
}))

const { prRef } = await import('../git/pr-link')
const { loadPr, mergePr, onPrMerged, prEntry, resetPrStore } = await import('./pr-store')

const raw = (n: number, state = 'OPEN') =>
  JSON.stringify({
    baseRefName: 'main',
    headRefName: 'feat/x',
    mergeStateStatus: 'CLEAN',
    number: n,
    state,
    title: `PR ${n}`,
    url: `https://github.com/o/r/pull/${n}`,
  })
const ref = (n: number) => {
  const r = prRef(`https://github.com/o/r/pull/${n}`)
  if (r === null) throw new Error('no ref')
  return r
}

beforeEach(() => {
  resetPrStore()
  calls.length = 0
  answer = async (_cmd, args) => raw(Number(String(args.url).split('/').pop()))
})

test('cards of one PR share one read, and a fresh one is not read again', async () => {
  await Promise.all([loadPr(ref(1), '/w'), loadPr(ref(1), '/w')])
  await loadPr(ref(1), '/w')
  expect(calls).toEqual([
    { args: { path: '/w', url: 'https://github.com/o/r/pull/1' }, cmd: 'pr_view_url' },
  ])
  expect(prEntry(ref(1).key).pr?.title).toBe('PR 1')
})

test('at most two reads run at once', async () => {
  let open = 0
  let most = 0
  answer = async (_cmd, args) => {
    open += 1
    most = Math.max(most, open)
    await new Promise((resolve) => setTimeout(resolve, 5))
    open -= 1
    return raw(Number(String(args.url).split('/').pop()))
  }
  await Promise.all([1, 2, 3, 4, 5].map(async (n) => loadPr(ref(n), '/w')))
  expect(most).toBe(2)
  expect(prEntry(ref(5).key).pr?.number).toBe(5)
})

test('a failed read keeps what showed, and says why', async () => {
  await loadPr(ref(1), '/w')
  answer = async () => {
    throw new Error('gh did not answer in time (network?)')
  }
  await loadPr(ref(1), '/w', 0)
  expect(prEntry(ref(1).key).pr?.title).toBe('PR 1')
  expect(prEntry(ref(1).key).error).toMatch(/did not answer/)
})

test('a merge is the real command, with the head to check, then the card reads merged', async () => {
  await loadPr(ref(1), '/w')
  let told = 0
  const off = onPrMerged(() => {
    told += 1
  })
  answer = async (cmd) => (cmd === 'pr_merge_url' ? null : raw(1, 'MERGED'))
  await mergePr(ref(1), '/w', 'feat/x')
  off()
  expect(calls[1]).toEqual({
    args: { head: 'feat/x', path: '/w', url: 'https://github.com/o/r/pull/1' },
    cmd: 'pr_merge_url',
  })
  expect(prEntry(ref(1).key).pr?.state).toBe('Merged')
  expect(told).toBe(1)
})

test('a refused merge throws gh’s words and changes nothing', async () => {
  await loadPr(ref(1), '/w')
  answer = async () => {
    throw new Error('GraphQL: Base branch policy prohibits the merge')
  }
  const refused = await mergePr(ref(1), '/w', 'feat/x').then(
    () => null,
    (error: unknown) => String(error)
  )
  expect(refused).toMatch(/Base branch policy/)
  expect(prEntry(ref(1).key).pr?.state).toBe('Open')
})

test('merged meanwhile by someone else counts as merged', async () => {
  await loadPr(ref(1), '/w')
  answer = async (cmd) => {
    if (cmd === 'pr_merge_url') throw new Error('Pull request o/r#1 was already merged')
    return raw(1, 'MERGED')
  }
  await mergePr(ref(1), '/w', '')
  expect(calls[1]?.args.head).toBeNull()
  expect(prEntry(ref(1).key).pr?.state).toBe('Merged')
})
