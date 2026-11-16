// The dock's Servers pane: the workspace's dev servers, one row each (state, port, URL, start
// or stop), the selected one's output below, and the project's declaration, edited in place.
import { PlayIcon, SquareIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { Dot, type Tone } from './status-dot'
import { TerminalView } from './terminal-view'
import { type ServerApp, type ServerRun, type ServersConfig, shortCause } from './use-servers'

const TONES: Record<ServerApp['status'], Tone> = {
  failed: 'failing',
  queued: 'working',
  ready: 'done',
  starting: 'working',
  stopped: 'idle',
}

const SAID: Record<ServerApp['status'], string> = {
  failed: 'Failed',
  queued: 'Waiting',
  ready: 'Ready',
  starting: 'Starting',
  stopped: 'Stopped',
}

export const EXAMPLE = `{
  "prepare": "[ node_modules/.modules.yaml -nt pnpm-lock.yaml ] || pnpm install",
  "apps": [
    { "name": "api", "port": 3000, "command": "pnpm --filter api dev",
      "env": { "PORT": "\${port}", "WEB_URL": "\${url.web}" } },
    { "name": "web", "port": 5173, "optional": true,
      "command": "pnpm --filter web dev --port \${port} --strictPort",
      "env": { "VITE_API_URL": "\${url.api}" } }
  ]
}`

interface Declared {
  name: string
  port: number | null
  optional: boolean
}

/** The apps a declaration names, for the rows shown before anything runs; [] if it won't parse. */
export function declaredApps(text: string | null): Declared[] {
  if (text === null || text.trim() === '') return []
  try {
    const parsed = JSON.parse(text) as { apps?: unknown }
    if (!Array.isArray(parsed.apps)) return []
    return parsed.apps.flatMap((a: unknown) => {
      if (typeof a !== 'object' || a === null) return []
      const { name, optional, port } = a as Record<string, unknown>
      if (typeof name !== 'string') return []
      return [{ name, optional: optional === true, port: typeof port === 'number' ? port : null }]
    })
  } catch {
    return []
  }
}

interface Props {
  run: ServerRun | undefined
  config: ServersConfig | null
  text: string | null
  /** The app whose output shows, and the terminal tab holding it (once reattached). */
  selected: string | null
  logTab: string | undefined
  onSelect: (app: string) => void
  attach: (tabId: string, el: HTMLElement, focus?: boolean) => () => void
  onStart: (apps?: string[]) => void
  onStop: (apps?: string[]) => void
  onOpen: (url: string, name: string) => void
  onSave: (text: string) => Promise<void>
}

export function ServersPane(props: Props) {
  const { config, run, text } = props
  const [editing, setEditing] = useState(false)
  if (config === null) return null
  if (editing || text === null || text.trim() === '') {
    return (
      <ConfigEditor
        config={config}
        onCancel={text !== null && text.trim() !== '' ? () => setEditing(false) : undefined}
        onSave={async (t) => {
          await props.onSave(t)
          setEditing(false)
        }}
      />
    )
  }
  const declared = declaredApps(text)
  const rows: ServerApp[] =
    run?.apps ??
    declared.map((d) => ({
      detail: null,
      name: d.name,
      optional: d.optional,
      port: null,
      status: 'stopped',
      term: '',
      url: null,
    }))
  const shown = rows.find((a) => a.name === props.selected)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none flex-col py-1">
        {run?.preparing === true && (
          <Row
            on={props.selected === 'prepare'}
            onClick={() => props.onSelect('prepare')}
            tone="working"
            name="prepare"
            said="Preparing"
          />
        )}
        {rows.map((a) => (
          <Row
            key={a.name}
            on={props.selected === a.name}
            onClick={() => props.onSelect(a.name)}
            tone={TONES[a.status]}
            name={a.name}
            said={SAID[a.status]}
            url={a.status === 'ready' ? a.url : null}
            port={a.port}
            cause={a.status === 'failed' ? shortCause(a.detail) : null}
            onOpen={a.url === null ? undefined : () => props.onOpen(a.url ?? '', a.name)}
            action={<RowAction app={a} onStart={props.onStart} onStop={props.onStop} />}
          />
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col border-t">
        {props.logTab !== undefined ? (
          <TerminalView
            key={props.logTab}
            tabId={props.logTab}
            attach={props.attach}
            focus={false}
            className="px-3 pt-2 pb-2"
          />
        ) : (
          <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-xs">
            {shown?.detail != null ? (
              <pre className="text-foreground max-h-full w-full overflow-auto text-left font-mono text-[11px] whitespace-pre-wrap">
                {shown.detail}
              </pre>
            ) : (
              <>
                <span>
                  {run === undefined
                    ? 'Each workspace gets its own slot: ports never meet your own dev servers.'
                    : `Slot ${run.slot}. Pick a server to see its output.`}
                </span>
                <span className="flex gap-1.5">
                  {config.repo === null ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setEditing(true)}
                    >
                      Edit servers
                    </Button>
                  ) : (
                    <span className="text-faint" data-tip={config.repoPath} data-tip-side="top">
                      Declared in the repo&apos;s .logit/servers.json
                    </span>
                  )}
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Row(p: {
  on: boolean
  onClick: () => void
  tone: Tone
  name: string
  said: string
  url?: string | null
  port?: number | null
  /** A failed app's cause, in place of its port. */
  cause?: string | null
  onOpen?: () => void
  action?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'group/row flex h-7 items-center gap-2 px-3 text-xs transition-colors duration-120',
        p.on ? 'bg-chrome' : 'hover:bg-chrome/60'
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={p.onClick}
      >
        <span className="grid size-[11px] flex-none place-items-center">
          <Dot tone={p.tone} label={p.said} />
        </span>
        <span className="text-foreground w-20 flex-none truncate font-medium">{p.name}</span>
        {p.cause != null ? (
          <span className="text-critical min-w-0 flex-1 truncate" title={p.cause}>
            {p.cause}
          </span>
        ) : (
          <>
            <span className="text-faint w-16 flex-none">{p.said}</span>
            {p.port != null && p.url == null && (
              <span className="text-faint font-mono tabular-nums">:{p.port}</span>
            )}
          </>
        )}
      </button>
      {p.url != null && p.onOpen && (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground truncate font-mono text-[11px] transition-colors duration-120"
          onClick={p.onOpen}
          data-tip="Open in the panel"
          data-tip-side="top"
        >
          {p.url.replace(/^http:\/\//, '')}
        </button>
      )}
      {p.action}
    </div>
  )
}

/** A row's one action: Restart when it failed, else start or stop. */
function RowAction(p: {
  app: ServerApp
  onStart: (apps: string[]) => void
  onStop: (apps: string[]) => void
}) {
  const { name, status } = p.app
  if (status === 'failed')
    return (
      <Button
        type="button"
        variant="outline"
        size="xs"
        className="h-5 flex-none px-1.5"
        onClick={() => p.onStart([name])}
      >
        Restart
      </Button>
    )
  if (status === 'stopped')
    return (
      <IconAction label={`Start ${name}`} onClick={() => p.onStart([name])}>
        <PlayIcon className="size-3 fill-current" />
      </IconAction>
    )
  return (
    <IconAction label={`Stop ${name}`} onClick={() => p.onStop([name])}>
      <SquareIcon className="size-2.5 fill-current" />
    </IconAction>
  )
}

function IconAction(p: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={p.label}
      data-tip={p.label}
      data-tip-side="top"
      data-tip-align="end"
      className="text-faint hover:text-foreground flex size-5 flex-none items-center justify-center rounded-sm transition-colors duration-120"
      onClick={p.onClick}
    >
      {p.children}
    </button>
  )
}

function ConfigEditor(p: {
  config: ServersConfig
  onSave: (text: string) => Promise<void>
  onCancel: (() => void) | undefined
}) {
  const [draft, setDraft] = useState(p.config.project === '' ? EXAMPLE : p.config.project)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setError(null), [draft])
  const save = () =>
    void p
      .onSave(draft)
      .catch((error_: unknown) =>
        setError(error_ instanceof Error ? error_.message : String(error_))
      )
  return (
    <form
      className="flex min-h-0 flex-1 flex-col gap-2 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <span className="text-muted-foreground text-xs">
        The project&apos;s dev servers, for every workspace. Each app runs on its port + the
        workspace&apos;s slot (1 to 9), with <code>{'${port}'}</code>, <code>{'${url.<app>}'}</code>{' '}
        and LOGIT_SLOT, LOGIT_PORT_&lt;APP&gt; in its env. A .logit/servers.json in the repo wins.
      </span>
      <textarea
        autoFocus
        spellCheck={false}
        value={draft}
        aria-label="Dev servers declaration (JSON)"
        className="bg-chrome text-foreground min-h-0 flex-1 resize-none rounded-md border p-2 font-mono text-[11px] outline-none focus-visible:border-tan"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.metaKey) {
            e.preventDefault()
            save()
          } else if (e.key === 'Escape' && p.onCancel) {
            e.stopPropagation()
            p.onCancel()
          }
        }}
      />
      <span className="flex items-center gap-2">
        <Button type="submit" size="sm">
          Save
        </Button>
        {p.onCancel && (
          <Button type="button" variant="secondary" size="sm" onClick={p.onCancel}>
            Cancel
          </Button>
        )}
        <span className={cn('truncate text-xs', error === null ? 'text-faint' : 'text-critical')}>
          {error ?? '⌘Enter saves. Esc cancels.'}
        </span>
      </span>
    </form>
  )
}
