import { invoke } from '@tauri-apps/api/core'
import { PlusIcon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { type Account, DEFAULT_ACCOUNT, fullness, quotaOf } from '../model/accounts'
import { BrailleSpinner } from './braille-spinner'
import { useLoaderChoice } from './loader-choice'
import { Switch } from './settings-controls'
import { reloadAccounts, useAccountQuotas, useAccounts } from './use-accounts'

const groupTitle = 'text-label mb-2 px-1 text-xs font-medium'
const cardClass = 'bg-background divide-y overflow-hidden rounded-lg border'
const rowClass = 'flex min-h-11 items-center justify-between gap-6 px-4 py-2.5'
const groupFoot = 'text-faint mt-2 px-1 text-xs'
const fieldError = 'text-critical-ink text-xs wrap-anywhere'

/** Who an account is, in one line: its email, else that nobody is signed in. */
export function accountName(account: Account): string {
  return account.email === '' ? 'Not signed in' : account.email
}

/** Its plan and how full its fullest quota window is: `max_5x · 42% used`. */
function AccountUse({ account }: { account: Account }) {
  const full = fullness(quotaOf(useAccountQuotas(), account.id))
  const used =
    full !== null && full >= 100 ? 'quota full' : full !== null && `${Math.round(full)}% used`
  const parts = [account.plan, used].filter((p): p is string => typeof p === 'string' && p !== '')
  return (
    <span
      className={cn(
        'text-xs',
        full !== null && full >= 100 ? 'text-warn-ink' : 'text-muted-foreground'
      )}
    >
      {parts.join(' · ')}
    </span>
  )
}

function AccountLabel({ account }: { account: Account }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-sm">
        {accountName(account)}
        {account.id === DEFAULT_ACCOUNT && <span className="text-faint ml-2 text-xs">Default</span>}
      </span>
      <AccountUse account={account} />
    </div>
  )
}

/** Remove, asked twice: the second click signs the account out of this Mac. */
function RemoveAccount({ account }: { account: Account }) {
  const [armed, setArmed] = useState(false)
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(armed && 'text-critical-ink hover:text-critical-ink')}
      onBlur={() => setArmed(false)}
      onMouseLeave={() => setArmed(false)}
      onClick={() => {
        if (!armed) return setArmed(true)
        void invoke('account_remove', { id: account.id }).finally(() => void reloadAccounts())
      }}
    >
      <span key={String(armed)} className="animate-in fade-in duration-120 ease-out">
        {armed ? 'Sign out?' : 'Remove'}
      </span>
    </Button>
  )
}

/** Settings › Accounts: the Claude accounts chats can run as, and adding one. */
export function AccountsPane() {
  const accounts = useAccounts()
  const loaders = useLoaderChoice()
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const add = () => {
    setAdding(true)
    setError(null)
    invoke<Account>('account_add')
      .then(() => reloadAccounts())
      .catch((error_: unknown) => setError(String(error_)))
      .finally(() => setAdding(false))
  }
  return (
    <section>
      <h2 className={groupTitle}>Claude accounts</h2>
      <div className={cardClass}>
        {accounts.map((account) => (
          <div key={account.id} className={rowClass}>
            <AccountLabel account={account} />
            {account.id !== DEFAULT_ACCOUNT && <RemoveAccount account={account} />}
          </div>
        ))}
        <div className={rowClass}>
          <span className="text-muted-foreground text-sm">
            {adding ? 'Sign in in your browser…' : 'Another Claude subscription'}
          </span>
          <Button variant="outline" size="sm" disabled={adding} onClick={add}>
            {adding ? <BrailleSpinner loader={loaders.working} /> : <PlusIcon />}
            Add account
          </Button>
        </div>
      </div>
      {error !== null && <div className={cn(fieldError, 'mt-2 px-1')}>{error}</div>}
      <p className={groupFoot}>
        Every account shares your Claude Code settings, skills, plugins and history; only who is
        signed in changes. Pick a project&apos;s accounts in its own settings.
      </p>
    </section>
  )
}

/** Settings › a project: which accounts its new chats run as. */
export function ProjectAccounts({
  onChange,
  picked,
}: {
  picked: string[]
  onChange: (accounts: string[]) => void
}) {
  const accounts = useAccounts()
  const known = picked.filter((id) => accounts.some((a) => a.id === id))
  // Nothing picked runs on the default account: its switch reads on.
  const on = (id: string) => (known.length === 0 ? id === DEFAULT_ACCOUNT : known.includes(id))
  const toggle = (id: string, value: boolean) => {
    const current = known.length === 0 ? [DEFAULT_ACCOUNT] : known
    const next = value ? [...current, id] : current.filter((a) => a !== id)
    // Back to the default account alone is the same as picking nothing.
    onChange(next.length === 1 && next[0] === DEFAULT_ACCOUNT ? [] : next)
  }
  if (accounts.length < 2) return null
  return (
    <section>
      <h2 className={groupTitle}>Claude accounts</h2>
      <div className={cardClass}>
        {accounts.map((account) => (
          <div key={account.id} className={rowClass}>
            <AccountLabel account={account} />
            <Switch
              checked={on(account.id)}
              label={accountName(account)}
              onChange={(value) => {
                // The last one stays on: a project always runs somewhere.
                if (!value && known.length <= 1 && on(account.id)) return
                toggle(account.id, value)
              }}
            />
          </div>
        ))}
      </div>
      <p className={groupFoot}>
        Each new chat runs on the picked account with the most quota left. A running chat keeps its
        account.
      </p>
    </section>
  )
}
