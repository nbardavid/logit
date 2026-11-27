// Boat (boat.dev): a project's switch to run its workspaces there, and the dock's Boat pane,
// which describes a workspace's sandbox and stops or resumes it.
import { invoke } from '@tauri-apps/api/core'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'

import type { BoatTarget, Workspace } from '../model/catalog'

import { BrailleSpinner } from './braille-spinner'
import { useLoaderChoice } from './loader-choice'
import { SelectMenu, Switch } from './settings-controls'

const groupTitle = 'text-label mb-2 px-1 text-xs font-medium'
const groupFoot = 'text-faint mt-2 px-1 text-xs'
const cardClass = 'bg-background divide-y overflow-hidden rounded-lg border'
const rowClass = 'flex min-h-11 items-center justify-between gap-6 px-4 py-2.5'

interface BoatOrg {
  id: string | null
  name: string
}

export const BOAT_UNSAVED = "Couldn't save the project's Boat setting."

const said = (e: unknown) => String(e).replace(/^Error: /, '')

/** Settings › a project: whether its new workspaces may run on Boat, and who pays. */
export function ProjectBoat({
  onChange,
  value,
}: {
  value: BoatTarget | null | undefined
  onChange: (boat: BoatTarget | null) => void
}) {
  const [orgs, setOrgs] = useState<BoatOrg[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    invoke<BoatOrg[]>('boat_orgs').then(
      (list) => live && setOrgs(list),
      (error_: unknown) => live && setError(said(error_))
    )
    return () => {
      live = false
    }
  }, [])
  const on = value !== null && value !== undefined
  const wallet = orgs?.find((o) => o.id === (value?.org ?? null))?.name ?? 'Personal'
  return (
    <section>
      <h2 className={groupTitle}>Boat</h2>
      <div className={cardClass}>
        <div className={rowClass}>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm">Run workspaces on Boat</span>
            <span className="text-faint text-xs">
              {error ?? 'New work can run its agent on a Boat sandbox instead of this Mac.'}
            </span>
          </span>
          <Switch
            checked={on}
            label="Run workspaces on Boat"
            onChange={(v) => onChange(v ? { org: null } : null)}
          />
        </div>
        {on && orgs !== null && orgs.length > 1 && (
          <div className={rowClass}>
            <span className="text-sm">Billed to</span>
            <SelectMenu
              label="Billed to"
              options={orgs.map((o) => o.name)}
              value={wallet}
              onChange={(name) => onChange({ org: orgs.find((o) => o.name === name)?.id ?? null })}
            />
          </div>
        )}
      </div>
      <p className={groupFoot}>
        Pick “On Boat” in the composer. Each workspace gets its own sandbox, deleted with it.
      </p>
    </section>
  )
}

interface BoatInfo {
  id: string
  ready: boolean
  error: string | null
  info: Record<string, unknown> | null
  usage: Record<string, unknown> | null
}

const STOPPED = new Set(['stopped', 'stopping', 'archived', 'archiving'])

/** The first of `keys` Boat filled, as text. */
function pick(o: Record<string, unknown> | null | undefined, ...keys: string[]) {
  for (const key of keys) {
    const v = o?.[key]
    if (typeof v === 'string' || typeof v === 'number') return String(v)
  }
  return null
}

function uptime(since: string | null) {
  if (since === null) return null
  const ms = Date.now() - Date.parse(since)
  if (!Number.isFinite(ms) || ms < 0) return null
  const m = Math.floor(ms / 60_000)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

function cost(usage: Record<string, unknown> | null) {
  const v = pick(usage, 'costUsd', 'cost', 'totalCostUsd', 'usd')
  if (v === null) return null
  const n = Number(v)
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : v
}

/** The dock's Boat pane: the sandbox as Boat sees it, polled while shown. */
export function BoatPane({ workspace }: { workspace: Workspace }) {
  const [data, setData] = useState<BoatInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const loaders = useLoaderChoice()
  const id = workspace.id

  const load = useCallback(
    () =>
      invoke<BoatInfo>('boat_info', { workspaceId: id }).then(
        (d) => {
          setData(d)
          setError(null)
        },
        (error_: unknown) => setError(said(error_))
      ),
    [id]
  )
  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 15_000)
    return () => clearInterval(timer)
  }, [load])

  if (data === null)
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-xs">
        {error ?? (
          <>
            <BrailleSpinner loader={loaders.working} /> Asking Boat…
          </>
        )}
      </div>
    )

  const info = data.info
  const state = pick(info, 'state') ?? 'unknown'
  const stopped = STOPPED.has(state)
  const vcpu = pick(info, 'vcpu')
  const memory = pick(info, 'memoryGB')
  const size = [
    pick(info, 'type'),
    vcpu === null ? null : `${vcpu} vCPU`,
    memory === null ? null : `${memory} GB`,
  ]
    .filter((part) => part !== null)
    .join(' · ')
  const rows: [string, string | null][] = [
    ['Sandbox', data.id],
    ['State', data.ready ? state : (data.error ?? 'being set up')],
    ['Machine', size || null],
    ['Region', pick(info, 'region', 'location')],
    ['Up', stopped ? null : uptime(pick(info, 'startedAt', 'resumedAt', 'createdAt'))],
    ['Cost so far', cost(data.usage)],
  ]
  const act = (cmd: 'boat_stop' | 'boat_resume') => {
    setBusy(true)
    invoke(cmd, { workspaceId: id })
      .then(load, (error_: unknown) => setError(said(error_)))
      .finally(() => setBusy(false))
  }
  const ssh = `boat ssh ${data.id}`

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-auto px-4 py-3 text-xs">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5">
        {rows
          .filter(([, v]) => v !== null && v !== '')
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-faint">{k}</dt>
              <dd className="text-foreground font-mono tabular-nums">{v}</dd>
            </div>
          ))}
      </dl>
      {error !== null && <div className="text-critical-ink">{error}</div>}
      <div className="flex gap-1.5">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy || !data.ready}
          onClick={() => act(stopped ? 'boat_resume' : 'boat_stop')}
        >
          {busy && <BrailleSpinner loader={loaders.working} />}
          {stopped ? 'Resume' : 'Stop'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            void navigator.clipboard.writeText(ssh).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1200)
            })
          }
        >
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
          Copy ssh command
        </Button>
      </div>
    </div>
  )
}
