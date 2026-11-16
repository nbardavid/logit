// The foot of the right panel: the workspace's Setup, its dev Servers, and quick terminals, each
// inside the dock (never in the main tabs). The bar starts or stops the servers in one click,
// even while the dock is shut.
import { ChevronRightIcon, PlayIcon, PlusIcon, SquareIcon, XIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { Workspace } from '../model/catalog'
import type { SetupStatus } from './use-setup'
import type { TerminalTab } from './use-terminals'

import { Dot } from './status-dot'
import { TerminalView } from './terminal-view'

/** The terminals the dock owns, by tag: the main tab bar leaves them out ('run': older builds). */
export const DOCK_TAGS: ReadonlySet<string> = new Set(['setup', 'run', 'dock'])

/** A dev server's output (`server:<app>`), shown in the dock's Servers pane. */
export const isServerTag = (tag: string | undefined) => tag?.startsWith('server:') === true

/** Whether the dock, not the main tab bar, shows a terminal with this tag. */
export const isDockTag = (tag: string | undefined) =>
  tag !== undefined && (DOCK_TAGS.has(tag) || isServerTag(tag))

type Pane = 'setup' | 'servers' | (string & {})

interface Props {
  workspace: Workspace
  projectName: string
  setup: SetupStatus | null
  /** The workspace's dock terminals, oldest first. */
  terms: TerminalTab[]
  attach: (tabId: string, el: HTMLElement, focus?: boolean) => () => void
  onSetupRun: () => void
  onSetupEdit: () => void
  onSetupAgent: () => void
  onNewTerminal: () => void
  onCloseTerminal: (id: string) => void
  /** The Servers pane, once the project's declaration has loaded. */
  servers: React.ReactNode
  /** Whether the project declares dev servers: the bar's button starts them. */
  serversDeclared: boolean
  serversRunning: boolean
  serversBusy: boolean
  onServersStart: () => void
  onServersStop: () => void
  /** Opens the servers that answer in the panel; nothing while none does. */
  preview: React.ReactNode
}

function setupState(run: Workspace['setup'], running: boolean) {
  if (running) return { dot: 'working', said: 'running', text: 'Running…' } as const
  if (!run) return { dot: 'idle', said: 'never', text: 'Not run' } as const
  if (run.exitCode === 0) return { dot: 'done', said: 'ran fine', text: 'Ran fine' } as const
  const exit = `Exit ${run.exitCode ?? '?'}`
  return { dot: 'failing', said: exit.toLowerCase(), text: exit } as const
}

const TAB =
  "relative flex h-full flex-none items-center gap-1.5 px-2 text-sm whitespace-nowrap transition-colors duration-120 ease-out after:absolute after:right-2 after:bottom-0 after:left-2 after:h-0.5 after:rounded-t-[1px] after:bg-tan after:transition-[scale] after:duration-220 after:ease-[cubic-bezier(0.2,0,0,1)] after:content-['']"

export function WorkspaceDock(props: Props) {
  const { setup, terms, workspace } = props
  const [open, setOpen] = useState(false)
  // null: the default pane, Servers, until the user picks one.
  const [pane, setPane] = useState<Pane | null>(null)
  // The terminal takes the keyboard only when the user picked it, never when a setup shows itself.
  const [picked, setPicked] = useState(false)
  const setupTerm = terms.findLast((t) => t.tag === 'setup')
  const quick = terms.filter((t) => t.tag === 'dock')

  // A setup that starts shows itself; a terminal opened here too.
  const seen = useRef(new Set(terms.map((t) => t.id)))
  useEffect(() => {
    for (const t of terms) {
      if (seen.current.has(t.id)) continue
      seen.current.add(t.id)
      if (t.tag !== 'setup' && t.tag !== 'dock') continue
      setPane(t.tag === 'dock' ? t.id : (t.tag as Pane))
      setOpen(true)
      setPicked(t.tag === 'dock')
    }
  }, [terms])
  const shown: Pane =
    pane !== null && (pane === 'setup' || quick.some((t) => t.id === pane)) ? pane : 'servers'

  const show = (next: Pane) => {
    setPicked(true)
    if (open && shown === next) return
    setPane(next)
    setOpen(true)
  }

  const s = setupState(workspace.setup, setupTerm !== undefined && setupTerm.exited === undefined)
  const term: TerminalTab | undefined =
    shown === 'setup' ? setupTerm : quick.find((t) => t.id === shown)

  /** The bar's one action: start or stop the dev servers, once declared. */
  const barButton = () => {
    if (!props.serversDeclared) return null
    if (props.serversRunning)
      return (
        <Button type="button" variant="outline" size="xs" onClick={props.onServersStop}>
          <SquareIcon className="size-2.5 fill-current" />
          Stop
        </Button>
      )
    return (
      <Button
        type="button"
        variant="outline"
        size="xs"
        onClick={() => {
          props.onServersStart()
          show('servers')
        }}
        data-tip="Start this workspace's dev servers"
        data-tip-side="top"
        data-tip-align="end"
      >
        <PlayIcon className="size-3 fill-current" />
        Start
      </Button>
    )
  }

  let body: React.ReactNode = null
  if (open && shown === 'servers') body = props.servers
  else if (open && term)
    body = (
      <TerminalView
        key={term.id}
        tabId={term.id}
        attach={props.attach}
        focus={picked}
        className="px-3 pt-2 pb-2"
      />
    )

  return (
    <div className="flex flex-none flex-col border-t">
      <div className="h-bar flex items-stretch pr-2">
        <button
          type="button"
          className="text-faint hover:text-foreground flex w-8 flex-none items-center justify-center transition-colors duration-120"
          aria-label={open ? 'Hide the dock' : 'Show the dock'}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronRightIcon
            className={cn(
              'size-3.5 transition-transform duration-180 ease-in-out motion-reduce:transition-none',
              open && 'rotate-90'
            )}
          />
        </button>
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          <DockTab label="Setup" on={open && shown === 'setup'} onClick={() => show('setup')}>
            {setup?.exists === true && <Dot tone={s.dot} />}
          </DockTab>
          <DockTab label="Servers" on={open && shown === 'servers'} onClick={() => show('servers')}>
            {props.serversBusy && <Dot tone="working" />}
            {!props.serversBusy && props.serversRunning && <Dot tone="done" />}
          </DockTab>
          {quick.map((t, i) => (
            <DockTab
              key={t.id}
              label={`Terminal ${i + 1}`}
              on={open && shown === t.id}
              onClick={() => show(t.id)}
              onClose={() => props.onCloseTerminal(t.id)}
            />
          ))}
          <button
            type="button"
            className="text-faint hover:text-foreground flex w-7 flex-none items-center justify-center transition-colors duration-120"
            aria-label="New terminal"
            data-tip="New terminal"
            data-tip-side="top"
            onClick={props.onNewTerminal}
          >
            <PlusIcon className="size-3.5" />
          </button>
        </div>
        <span className="flex flex-none items-center gap-1">
          {props.preview}
          {barButton()}
        </span>
      </div>
      {/* Opens by its height (grid rows 0fr → 1fr), so nothing jumps; inert while shut. */}
      <div
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-180 ease-in-out motion-reduce:transition-[opacity]',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        )}
        inert={!open}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex h-[280px] flex-col border-t">
            {body ?? (
              <Empty>
                {shown === 'setup' && (
                  <SetupEmpty {...props} exists={setup?.exists === true} said={s.said} />
                )}
              </Empty>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function DockTab({
  children,
  label,
  on,
  onClick,
  onClose,
}: {
  label: string
  on: boolean
  onClick: () => void
  onClose?: () => void
  children?: React.ReactNode
}) {
  return (
    <span className="group/tab relative flex flex-none items-stretch">
      <button
        type="button"
        className={cn(
          TAB,
          on
            ? 'text-foreground after:scale-x-100'
            : 'text-faint hover:text-muted-foreground after:scale-x-0',
          onClose && 'pr-5'
        )}
        onClick={onClick}
      >
        {label}
        {children}
      </button>
      {onClose && (
        <button
          type="button"
          aria-label={`Close ${label}`}
          className="text-faint hover:text-foreground absolute top-1/2 right-0.5 flex size-4 -translate-y-1/2 items-center justify-center rounded-sm opacity-0 transition-opacity duration-120 group-hover/tab:opacity-100 focus-visible:opacity-100"
          onClick={onClose}
        >
          <XIcon className="size-3" />
        </button>
      )}
    </span>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <div className="text-muted-foreground flex max-w-[280px] flex-col items-center gap-3 text-center text-xs">
        {children}
      </div>
    </div>
  )
}

function SetupEmpty(props: Props & { exists: boolean; said: string }) {
  return (
    <>
      <span>
        {props.exists
          ? `Runs by itself in every new workspace of ${props.projectName}. Last run here: ${props.said}.`
          : 'A setup script installs what a fresh worktree lacks: dependencies, .env, caches.'}
      </span>
      <span className="flex flex-wrap justify-center gap-1.5">
        {props.exists && (
          <Button type="button" variant="secondary" size="sm" onClick={props.onSetupRun}>
            Run setup
          </Button>
        )}
        <Button type="button" variant="secondary" size="sm" onClick={props.onSetupEdit}>
          {props.exists ? 'Edit' : 'Create script'}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={props.onSetupAgent}>
          Write it with a chat
        </Button>
      </span>
    </>
  )
}
