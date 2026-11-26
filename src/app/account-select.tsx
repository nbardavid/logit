import type { RefObject } from 'react'

import { type Account, chatAccount, fullness, quotaOf } from '../model/accounts'
import { accountName } from './accounts-pane'
import { Combo } from './combo'
import { useAccountQuotas, useAccounts } from './use-accounts'

const AUTO = ''

/** `nathan` for `nathan@example.com`: the footer has little room. */
const shortName = (account: Account | undefined) =>
  account === undefined ? 'Claude' : accountName(account).split('@')[0]

interface Props {
  /** The account picked for this chat; undefined is its project's pick. */
  chosen: string | undefined
  /** The accounts its project picked. */
  project: string[] | undefined
  /** A pick, and the faint line the chat shows for it. */
  onChange: (account: string | undefined, note: string) => void
  finalFocus?: RefObject<HTMLElement | null>
}

/**
 * Which Claude account a chat runs as, beside its model: "Auto" (the project's account with the
 * most quota left) or one picked. It applies from the next prompt; a picked account that fills
 * up hands over to Auto until it has room again. Shown only with more than one account.
 */
export function AccountSelect({ chosen, finalFocus, onChange, project }: Props) {
  const accounts = useAccounts()
  const quotas = useAccountQuotas()
  if (accounts.length < 2) return null
  const known = accounts.map((a) => a.id)
  const runs = (pick: string | undefined) =>
    accounts.find((a) => a.id === chatAccount(pick, project ?? [], known, quotas))
  const used = (id: string) => {
    const full = fullness(quotaOf(quotas, id))
    if (full === null) return
    return full >= 100 ? 'Quota full' : `${Math.round(full)}% used`
  }
  const current = runs(chosen)
  const pick = (value: string) => {
    const account = value === AUTO ? undefined : value
    const name = shortName(runs(account))
    onChange(account, `Account → ${account === undefined ? `Auto (${name})` : name}`)
  }
  return (
    <Combo
      button={
        <span className="max-w-32 truncate" title={current && accountName(current)}>
          {shortName(current)}
        </span>
      }
      className="text-muted-foreground hover:bg-hover data-popup-open:bg-hover h-7 gap-1 rounded-md pr-1.5 pl-2 font-normal [&>svg:last-child]:size-3"
      finalFocus={finalFocus}
      options={[
        { hint: 'The one with the most quota left', label: 'Auto', value: AUTO },
        ...accounts.map((a) => ({ hint: used(a.id), label: accountName(a), value: a.id })),
      ]}
      selected={chosen ?? AUTO}
      placeholder="Search accounts"
      onPick={pick}
    />
  )
}
