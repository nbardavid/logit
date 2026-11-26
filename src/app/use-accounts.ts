import { invoke } from '@tauri-apps/api/core'
import { useSyncExternalStore } from 'react'

import type { Catalog } from '../model/catalog'
import type { QuotaCache } from '../model/quota'

import { type Account, pickAccount } from '../model/accounts'

// Shared between the window and Settings: the Claude accounts and what their quotas read.

let accounts: readonly Account[] = []
let quotas: QuotaCache = {}
const listeners = new Set<() => void>()
const notify = () => {
  for (const listener of listeners) listener()
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The accounts, the default one first, read again from disk. */
export async function reloadAccounts() {
  const list = await invoke<Account[]>('accounts_list').catch(() => null)
  if (list) {
    accounts = list
    notify()
  }
}

export const currentAccounts = () => accounts
export const currentQuotas = () => quotas

export function noteQuotas(next: QuotaCache) {
  quotas = next
  notify()
}

export function useAccounts(): readonly Account[] {
  return useSyncExternalStore(subscribe, () => accounts)
}

export function useAccountQuotas(): QuotaCache {
  return useSyncExternalStore(subscribe, () => quotas)
}

/**
 * The account a new Claude of workspace `workspaceId` runs as. The catalog is read from disk:
 * a workspace just made is not in the window's copy yet when its first prompt goes.
 */
export async function accountFor(workspaceId: string): Promise<string> {
  if (accounts.length === 0) await reloadAccounts()
  const catalog = await invoke<Catalog>('catalog').catch(() => null)
  const projectId = catalog?.workspaces.find((w) => w.id === workspaceId)?.projectId
  const picked = catalog?.projects.find((p) => p.id === projectId)?.accounts
  return pickAccount(
    picked ?? [],
    accounts.map((a) => a.id),
    quotas
  )
}
