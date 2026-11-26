import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

import { chatAccount, DEFAULT_ACCOUNT, quotaOf } from '../model/accounts'
import { headline, type QuotaCache, type QuotaEntry, type UsageWindow } from '../model/quota'
import { accountName } from './accounts-pane'
import { useAccounts } from './use-accounts'

function barTone(percent: number) {
  if (percent >= 85) return 'bg-critical'
  if (percent >= 60) return 'bg-warn'
  return 'bg-good'
}

function paceTone(stage: string) {
  if (stage.includes('Behind') || stage.includes('behind')) return 'text-warn-ink'
  if (stage === 'onTrack') return 'text-faint'
  return 'text-good'
}

function ago(ms: number) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}

function WindowRow({ window }: { window: UsageWindow }) {
  const percent = window.percent ?? 0
  return (
    <div className="flex flex-col gap-[3px]">
      <div className="flex items-center gap-2.5">
        <span className="w-[60px] flex-none font-medium">{window.label}</span>
        <span className="bg-hover h-[5px] flex-1 overflow-hidden rounded-full">
          <span
            className={cn('block h-full rounded-full', barTone(percent))}
            style={{ width: `${percent}%` }}
          />
        </span>
        <span className="w-9 text-right font-medium tabular-nums">
          {window.percent === null ? '—' : `${Math.round(percent)}%`}
        </span>
      </div>
      <div className="text-muted-foreground flex flex-wrap gap-x-2.5 gap-y-0.5 pl-[70px] text-xs">
        {window.timeRemaining !== null && <span>resets in {window.timeRemaining}</span>}
        {window.pace && (
          <span className={paceTone(window.pace.stage)}>
            {window.pace.label}
            {window.pace.rightText !== null && ` · ${window.pace.rightText}`}
          </span>
        )}
      </div>
    </div>
  )
}

/** Every window of one account's quota, under who it is. */
function QuotaWindows({
  entry,
  here,
  name,
  plan,
}: {
  entry: QuotaEntry | undefined
  name: string
  plan: string
  /** The account the workspace on screen runs on. */
  here: boolean
}) {
  const tier = entry?.snapshot.planTier ?? plan
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3 text-sm font-semibold">
        <span className="min-w-0 truncate">
          {name}
          {here && <span className="text-faint ml-2 text-xs font-normal">This workspace</span>}
        </span>
        <span className="text-faint flex-none text-xs font-normal">
          {entry ? ago(entry.fetchedAt) : 'No quota yet'}
          {tier !== '' && ` · ${tier}`}
        </span>
      </div>
      {entry?.snapshot.windows.map((w) => (
        <WindowRow key={w.kind} window={w} />
      ))}
    </div>
  )
}

/**
 * The session of the account the workspace on screen runs on (or a weekly window about to
 * block), for the sidebar's foot; a click shows every account's windows, that one first.
 */
export function Quotas({
  cache,
  chosen,
  error,
  picked,
}: {
  cache: QuotaCache
  error: string | null
  /** The accounts the project on screen picked. */
  /** The account picked for the chat on screen, if any. */
  chosen?: string
  picked: string[] | undefined
}) {
  const accounts = useAccounts()
  const current = chatAccount(
    chosen,
    picked ?? [],
    accounts.map((a) => a.id),
    cache
  )
  const entry = quotaOf(cache, current)
  const tight = headline({ claude: entry })
  if (entry === undefined && error === null) return null
  const listed =
    accounts.length > 0 ? accounts : [{ email: 'Claude', id: DEFAULT_ACCOUNT, plan: '' }]
  const ordered = [
    ...listed.filter((a) => a.id === current),
    ...listed.filter((a) => a.id !== current),
  ]
  return (
    <div className="flex min-w-0 flex-[0_1_auto]">
      <Popover>
        <PopoverTrigger className="text-faint hover:text-muted-foreground hover:bg-hover data-popup-open:bg-hover inline-flex h-7 max-w-full items-center gap-1.5 overflow-hidden rounded-md px-2 text-xs whitespace-nowrap transition-[background-color,color,scale] duration-120 active:scale-[0.96]">
          {tight ? (
            <>
              <span
                className={cn('size-1.5 flex-none rounded-full', barTone(tight.percent ?? 0))}
              />
              {tight.label}
              <span className="text-muted-foreground font-medium tabular-nums">
                {Math.round(tight.percent ?? 0)}%
              </span>
              {tight.timeRemaining !== null && <span>· {tight.timeRemaining}</span>}
            </>
          ) : (
            <span className="text-faint">Quotas unavailable</span>
          )}
        </PopoverTrigger>
        <PopoverContent
          side="top"
          sideOffset={10}
          aria-label="Quotas"
          className="max-h-[min(560px,80vh)] w-[340px] gap-0 divide-y overflow-y-auto px-4 py-0"
        >
          {ordered.map((a) => (
            <div key={a.id} className="py-3.5">
              <QuotaWindows
                entry={quotaOf(cache, a.id)}
                name={accounts.length > 1 ? accountName(a) : 'Claude'}
                plan={a.plan}
                here={accounts.length > 1 && a.id === current}
              />
            </div>
          ))}
          {error !== null && (
            <div className="text-critical-ink py-3 text-xs [overflow-wrap:anywhere]">{error}</div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
