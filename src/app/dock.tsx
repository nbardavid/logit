// The workspace's dock, wired: the project's setup script, run command and dev servers, and
// the actions that run them in the dock's terminals.
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'

import type { Workspace } from '../model/catalog'
import type { useTerminals } from './use-terminals'

import { PreviewButton } from './preview-button'
import { declaredApps, ServersPane } from './servers-pane'
import { useRunCommand } from './use-run-command'
import {
  isRunning,
  lastApps,
  rememberApps,
  startServers,
  stopServers,
  useServerRuns,
  useServersConfig,
} from './use-servers'
import { useSetup } from './use-setup'
import { isDockTag, WorkspaceDock } from './workspace-dock'

interface Props {
  ws: Workspace
  projectName: string
  terminals: ReturnType<typeof useTerminals>
  /** Whether the host can start processes; else `onBlocked` says why not. */
  hostReady: boolean
  onBlocked: (title: string) => void
  fail: (title: string) => (error: unknown) => void
  runSetup: (w: Workspace) => Promise<unknown>
  /** Opens a chat asking Claude to write the setup script at `script`. */
  onWriteSetup: (script: string) => void
  /** Opens a server's page in the panel's browser. */
  onOpenUrl: (url: string, title: string) => void
}

export function Dock({ fail, hostReady, onBlocked, terminals, ws, ...props }: Props) {
  // The workspace's dock terminals (setup, run, quick ones, servers' output).
  const terms = terminals.tabs.filter((t) => t.workspaceId === ws.id && isDockTag(t.tag))
  const setup = useSetup(ws.projectId)
  const run = useRunCommand(ws.projectId)
  const servers = useServersConfig(ws.projectId, ws.path)
  const declared = servers.text !== null && servers.text.trim() !== ''
  const serverRuns = useServerRuns(hostReady)
  const serverRun = serverRuns.runs[ws.id]
  const [selected, setSelected] = useState<string | null>(null)

  // The selected server's output: its host terminal, attached (again once it restarted).
  const app = serverRun?.apps.find((a) => a.name === selected)
  const logId = selected === 'prepare' ? serverRun?.prepareTerm : app?.term
  const live = app === undefined || app.status !== 'stopped'
  const logTab = terms.find((t) => t.id === logId)
  const restartKey = `${logId}:${app?.status === 'starting' || app?.status === 'queued' ? 'up' : ''}`
  useEffect(() => {
    if (logId == null || logId === '' || !live) return
    const tab = terms.find((t) => t.id === logId)
    if (tab !== undefined && tab.exited === undefined) return
    if (tab !== undefined) terminals.forget(tab.id)
    terminals.reattach({
      code: null,
      command: 'server',
      cwd: ws.path,
      ended: false,
      id: logId,
      tag: `server:${selected}`,
      title: selected ?? '',
      workspaceId: ws.id,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reattach on a new run, not on every tab change
  }, [restartKey, live])

  // What runs here is the selection Start brings back next time (every app the first time).
  const busyApps = (serverRun?.apps ?? []).filter((a) => a.status !== 'stopped').map((a) => a.name)
  const busyKey = busyApps.join(',')
  useEffect(() => {
    if (busyApps.length > 0) rememberApps(ws.id, busyApps)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the names
  }, [busyKey, ws.id])

  const startApps = (only?: string[]) => {
    if (!hostReady) return onBlocked("Couldn't start the servers")
    const names = declaredApps(servers.text).map((d) => d.name)
    const last = lastApps(ws.id)?.filter((n) => names.includes(n))
    const apps = only ?? (last !== undefined && last.length > 0 ? last : names)
    void startServers(ws, apps)
      .then((r) => {
        setSelected(
          (s) => s ?? apps?.[0] ?? r.apps.find((a) => a.status !== 'stopped')?.name ?? null
        )
        return serverRuns.refresh()
      })
      .catch(fail("Couldn't start the servers"))
  }
  const stopApps = (apps?: string[]) => {
    void stopServers(ws.id, apps)
      .then(() => serverRuns.refresh())
      .catch(fail("Couldn't stop the servers"))
  }

  const setupAction = async (what: 'edit' | 'run' | 'chat') => {
    try {
      if (what === 'edit') await invoke('edit_setup_script', { projectId: ws.projectId })
      else if (what === 'run') await props.runSetup(ws)
      else {
        const script = await invoke<string>('ensure_setup_script', { projectId: ws.projectId })
        props.onWriteSetup(script)
      }
      void setup.refresh()
    } catch (error) {
      const failed = {
        chat: "Couldn't create the setup script",
        edit: "Couldn't open the setup script",
        run: "Couldn't run the setup script",
      }[what]
      fail(failed)(error)
    }
  }

  const stop = () => {
    for (const t of terms) if (t.tag === 'run') terminals.close(t.id)
  }

  /** The project's run command here; a run already going is stopped first. */
  const runApp = () => {
    if (!hostReady) return onBlocked("Couldn't run the app")
    if (run.command === null || run.command === '') return
    stop()
    terminals.create({
      command: run.command,
      cwd: ws.path,
      tag: 'run',
      title: 'Run',
      workspaceId: ws.id,
    })
  }

  return (
    <WorkspaceDock
      workspace={ws}
      projectName={props.projectName}
      setup={setup.status}
      runCommand={run.command}
      terms={terms}
      attach={terminals.attach}
      onSetupRun={() => void setupAction('run')}
      onSetupEdit={() => void setupAction('edit')}
      onSetupAgent={() => void setupAction('chat')}
      onSaveRunCommand={(c) => void run.save(c).catch(fail("Couldn't save the run command"))}
      onRun={runApp}
      onStop={stop}
      onNewTerminal={() => {
        if (!hostReady) onBlocked("Couldn't open a terminal")
        else terminals.create({ cwd: ws.path, tag: 'dock', workspaceId: ws.id })
      }}
      onCloseTerminal={terminals.close}
      serversDeclared={declared}
      serversRunning={isRunning(serverRun)}
      serversBusy={
        serverRun?.preparing === true ||
        (serverRun?.apps.some((a) => a.status === 'queued' || a.status === 'starting') ?? false)
      }
      onServersStart={() => startApps()}
      onServersStop={() => stopApps()}
      preview={
        declared && (
          <PreviewButton
            run={serverRun}
            onOpen={(_ws, url, title) => props.onOpenUrl(url, title)}
          />
        )
      }
      servers={
        <ServersPane
          run={serverRun}
          config={servers.config}
          text={servers.text}
          selected={selected}
          logTab={live ? logTab?.id : undefined}
          onSelect={setSelected}
          attach={terminals.attach}
          onStart={startApps}
          onStop={stopApps}
          onOpen={props.onOpenUrl}
          onSave={servers.save}
        />
      }
    />
  )
}
