// A workspace's dev servers: what its project declares, and what the host runs, followed
// while the window is open.
import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

export type AppStatus = 'queued' | 'starting' | 'ready' | 'failed' | 'stopped'

export interface ServerApp {
  name: string
  port: number | null
  url: string | null
  status: AppStatus
  detail: string | null
  /** The host terminal its output goes to. */
  term: string
  optional: boolean
}

export interface ServerRun {
  workspaceId: string
  projectId: string
  cwd: string
  slot: number
  preparing: boolean
  prepareTerm: string | null
  apps: ServerApp[]
}

export interface ServersConfig {
  /** The project's setting, '' when unset. */
  project: string
  /** The repo's `.logit/servers.json` in this worktree: it wins. */
  repo: string | null
  repoPath: string
  /** Where the project's setting lives, outside the repo. */
  projectPath: string
}

const POLL_MS = 1000

// One poll for the whole window, shared by the dock and the sidebar.
let runs: Record<string, ServerRun> = {}
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined

async function refreshRuns() {
  const list = await invoke<ServerRun[]>('servers_list').catch(() => null)
  if (list === null) return
  runs = Object.fromEntries(list.map((r) => [r.workspaceId, r]))
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (timer === undefined) {
    void refreshRuns()
    timer = setInterval(() => void refreshRuns(), POLL_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      clearInterval(timer)
      timer = undefined
    }
  }
}

const noop = () => () => {}

/** Every workspace's run, by workspace id, polled from the host while `enabled`. */
export function useServerRuns(enabled: boolean) {
  const current = useSyncExternalStore(enabled ? subscribe : noop, () => runs)
  return { refresh: refreshRuns, runs: current }
}

/** The config a workspace's servers run with, both places; null while it loads. */
export function useServersConfig(projectId: string, cwd: string) {
  const [config, setConfig] = useState<ServersConfig | null>(null)
  const load = useCallback(async () => {
    const c = await invoke<ServersConfig>('servers_config', { cwd, projectId }).catch(() => ({
      project: '',
      projectPath: '',
      repo: null,
      repoPath: `${cwd}/.logit/servers.json`,
    }))
    setConfig(c)
  }, [cwd, projectId])
  useEffect(() => {
    setConfig(null)
    void load()
  }, [load])
  const save = useCallback(
    async (text: string) => {
      await invoke('set_servers_config', { projectId, text })
      await load()
    },
    [load, projectId]
  )
  const text = config === null ? null : (config.repo ?? config.project)
  return { config, save, text }
}

/** Starts a workspace's servers (`apps`, or every app not optional). */
export const startServers = async (
  ws: { id: string; projectId: string; path: string },
  apps?: string[]
) =>
  invoke<ServerRun>('servers_start', {
    apps: apps ?? null,
    cwd: ws.path,
    projectId: ws.projectId,
    workspaceId: ws.id,
  })

/** Stops a workspace's servers (`apps`, or all), only what logit started there. */
export const stopServers = async (workspaceId: string, apps?: string[]) =>
  invoke('servers_stop', { apps: apps ?? null, workspaceId })

/** Whether any app of the run is up or on its way. */
export const isRunning = (run: ServerRun | undefined) =>
  run?.apps.some((a) => a.status === 'queued' || a.status === 'starting' || a.status === 'ready') ??
  false

/** The run's apps that answer, with a URL. */
export const readyUrls = (run: ServerRun | undefined) =>
  (run?.apps ?? []).filter((a) => a.status === 'ready' && a.url !== null)

/** A failed app's cause in a few words: the last useful line of its output. */
export function shortCause(detail: string | null): string | null {
  if (detail === null) return null
  const port = /(?:port\s+(\d+)\s+is\s+already\s+in\s+use|EADDRINUSE[^\d]*(\d+))/i.exec(detail)
  if (port) return `port ${port[1] ?? port[2]} already in use`
  const lines = detail
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !/^at\s|^\^+$|ELIFECYCLE|^\s*$/.test(l))
  const error = lines.findLast((l) => /error|cannot|failed|not found|refused/i.test(l))
  return (error ?? lines.at(-1) ?? detail.split('\n')[0] ?? '').slice(0, 120)
}

const LAST_KEY = (ws: string) => `logit.servers.last.${ws}`

/** The apps the workspace ran last time, null before its first start. */
export function lastApps(workspaceId: string): string[] | null {
  try {
    const raw = localStorage.getItem(LAST_KEY(workspaceId))
    const parsed: unknown = raw === null ? null : JSON.parse(raw)
    return Array.isArray(parsed) && parsed.every((a) => typeof a === 'string') ? parsed : null
  } catch {
    return null
  }
}

export function rememberApps(workspaceId: string, apps: string[]) {
  try {
    localStorage.setItem(LAST_KEY(workspaceId), JSON.stringify(apps))
  } catch {
    // A per-window convenience: Start then falls back to every app.
  }
}
