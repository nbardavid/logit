// Every PR a card shows, read once and shared: two cards of one PR (a chat and a report) make
// one gh call, at most two calls run at once, and nothing is read again while it is fresh.
// The git panel seeds the workspace's own PR here, so its card costs nothing.
import { invoke } from '@tauri-apps/api/core'

import type { PrRef } from '../git/pr-link'
import type { Workspace } from '../model/catalog'

import { type PullRequest, toPullRequest } from '../git/pr'
import { alreadyMerged } from './pr-card-model'

export interface PrEntry {
  pr: PullRequest | null
  /** The last read's failure (gh's words); what showed before stays in `pr`. */
  error: string | null
  loading: boolean
  /** When it was last read, answered or failed (ms); 0 never. */
  at: number
}

const EMPTY: PrEntry = { at: 0, error: null, loading: false, pr: null }

/** Read again past this age when a card comes into view. */
export const FRESH_MS = 60_000
/** While checks run, a card in view reads its PR this often. */
export const RUNNING_MS = 15_000
/** Back to the window: what changed meanwhile, unless it was read this recently. */
export const FOCUS_GAP_MS = 10_000
const PARALLEL = 2

const entries = new Map<string, PrEntry>()
const watchers = new Map<string, Set<() => void>>()
const inflight = new Map<string, Promise<void>>()

export const prEntry = (key: string): PrEntry => entries.get(key) ?? EMPTY

function update(key: string, patch: Partial<PrEntry>) {
  entries.set(key, { ...prEntry(key), ...patch })
  for (const fn of watchers.get(key) ?? []) fn()
}

export function watchPr(key: string, fn: () => void): () => void {
  const set = watchers.get(key) ?? new Set()
  set.add(fn)
  watchers.set(key, set)
  return () => {
    set.delete(fn)
    if (set.size === 0) watchers.delete(key)
  }
}

// gh calls wait their turn: a transcript scrolled past twenty PRs never starts twenty at once.
let running = 0
const queue: (() => void)[] = []
async function turn<T>(job: () => Promise<T>): Promise<T> {
  if (running >= PARALLEL) await new Promise<void>((go) => queue.push(go))
  running += 1
  try {
    return await job()
  } finally {
    running -= 1
    queue.shift()?.()
  }
}

/**
 * Reads the PR unless it was read within `maxAge` (0 forces it). Concurrent asks share one
 * call. A failure keeps what showed: the card says it only when it has nothing else.
 */
export async function loadPr(
  ref: PrRef,
  cwd: string | undefined,
  maxAge = FRESH_MS
): Promise<void> {
  const pending = inflight.get(ref.key)
  if (pending) return pending
  if (maxAge > 0 && Date.now() - prEntry(ref.key).at < maxAge) return Promise.resolve()
  update(ref.key, { loading: true })
  const job = turn(async () => invoke<string>('pr_view_url', { path: cwd ?? '', url: ref.url }))
    .then(
      (raw) =>
        update(ref.key, { at: Date.now(), error: null, loading: false, pr: toPullRequest(raw) }),
      (error: unknown) => update(ref.key, { at: Date.now(), error: String(error), loading: false })
    )
    .finally(() => inflight.delete(ref.key))
  inflight.set(ref.key, job)
  return job
}

/** A PR read elsewhere (the git panel's poll): the cards of it are fresh with it. */
export function seedPr(ref: PrRef, pr: PullRequest) {
  if (inflight.has(ref.key)) return
  update(ref.key, { at: Date.now(), error: null, pr })
}

/** A PR the user merged in the app: where (the workspace the button was in) and which. */
export interface Merged {
  /** The worktree the Merge was pressed from (a card's chat or page, the git panel). */
  cwd: string
  number: number
  url: string
}

const merged = new Set<(m: Merged) => void>()
/** The user merged a PR: the git panel reads its own again, the workspace's chat is told. */
export function onPrMerged(fn: (m: Merged) => void): () => void {
  merged.add(fn)
  return () => {
    merged.delete(fn)
  }
}

/** Says a merge happened (the git panel's merges come in here too). */
export function announceMerged(m: Merged) {
  for (const fn of merged) fn(m)
}

/**
 * Merges the PR (`pr_merge_url`, a real gh merge: never a prompt to the agent). The card turns
 * merged at once, then the PR is read again. Throws gh's failure.
 */
export async function mergePr(ref: PrRef, cwd: string | undefined, head: string) {
  try {
    await invoke('pr_merge_url', { head: head === '' ? null : head, path: cwd ?? '', url: ref.url })
  } catch (error) {
    if (!alreadyMerged(String(error))) throw error
  }
  // A read started before the merge would say "open" over it: let it land first.
  await inflight.get(ref.key)
  const shown = prEntry(ref.key).pr
  if (shown) update(ref.key, { pr: { ...shown, state: 'Merged' } })
  announceMerged({ cwd: cwd ?? '', number: ref.number, url: ref.url })
  void loadPr(ref, cwd, 0)
}

/** What a merged card can close: the app's workspaces, and the git panel's clean up of one. */
export interface CardPlaces {
  workspaces: readonly Workspace[]
  /** Rejects with git's refusal; `force` discards uncommitted changes. */
  remove: (w: Workspace, force: boolean) => Promise<void>
}
let places: CardPlaces | null = null
const placeWatchers = new Set<() => void>()
/** Given by the app; absent (the gallery), a merged card offers nothing. */
export function setCardPlaces(next: CardPlaces | null) {
  places = next
  for (const fn of placeWatchers) fn()
}
export const cardPlaces = () => places
export function watchCardPlaces(fn: () => void): () => void {
  placeWatchers.add(fn)
  return () => {
    placeWatchers.delete(fn)
  }
}

/** Tests only: forget every PR. */
export function resetPrStore() {
  entries.clear()
  inflight.clear()
}
