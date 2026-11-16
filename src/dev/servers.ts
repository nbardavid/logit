// Dev servers for the browser preview: p-logit declares three, started in about three seconds
// (`bo` fails on its port, to show a failure); other projects declare none until saved.
import type { ServerApp, ServerRun } from '../app/use-servers'

const LOGIT_CONFIG = `{
  "prepare": "[ node_modules/.modules.yaml -nt pnpm-lock.yaml ] || pnpm install",
  "apps": [
    { "name": "server", "port": 3400, "command": "pnpm --filter server dev",
      "env": { "PORT": "\${port}", "MAILING_ACTIVE": "false", "WORDPRESS_APP_PASSWORD": "" } },
    { "name": "web", "port": 5200, "command": "pnpm --filter web dev --port \${port} --strictPort",
      "env": { "VITE_API_URL": "\${url.server}" } },
    { "name": "bo", "port": 5300, "optional": true, "command": "pnpm --filter bo dev --port \${port}" }
  ]
}`

const configs = new Map<string, string>([['p-logit', LOGIT_CONFIG]])
const runs = new Map<string, ServerRun>()

export const SERVER_OUTPUT =
  '> server@1.0.0 dev\r\n\r\n\x1b[32m[Nest]\x1b[0m Application is running on: \x1b[36mhttp://localhost:3401\x1b[0m\r\n'

function declared(projectId: string) {
  try {
    const c = JSON.parse(configs.get(projectId) ?? '') as {
      apps: { name: string; port?: number; optional?: boolean }[]
    }
    return c.apps
  } catch {
    return []
  }
}

function step(wsId: string, name: string, status: ServerApp['status'], detail: string | null) {
  const app = runs.get(wsId)?.apps.find((a) => a.name === name)
  if (app && app.status !== 'stopped') Object.assign(app, { detail, status })
}

export function serversAnswer(cmd: string, args: Record<string, unknown>): unknown {
  const s = (k: string) => (typeof args[k] === 'string' ? args[k] : '')
  switch (cmd) {
    case 'servers_config':
      return {
        project: configs.get(s('projectId')) ?? '',
        repo: null,
        repoPath: `${s('cwd')}/.logit/servers.json`,
      }
    case 'set_servers_config':
      JSON.parse(s('text') || '{"apps":[1]}')
      configs.set(s('projectId'), s('text'))
      return null
    case 'servers_list':
      return structuredClone([...runs.values()])
    case 'servers_start': {
      const wsId = s('workspaceId')
      const asked = (args.apps as string[] | null) ?? null
      const slot = runs.get(wsId)?.slot ?? runs.size + 1
      const old = runs.get(wsId)?.apps ?? []
      const apps: ServerApp[] = declared(s('projectId')).map((a) => {
        const wanted = asked === null ? a.optional !== true : asked.includes(a.name)
        const prev = old.find((o) => o.name === a.name)
        const port = a.port === undefined ? null : a.port + slot
        const keep = prev !== undefined && prev.status !== 'stopped' && prev.status !== 'failed'
        let status: ServerApp['status'] = 'stopped'
        if (keep) status = prev.status
        else if (wanted) status = 'queued'
        return {
          detail: null,
          name: a.name,
          optional: a.optional === true,
          port,
          status,
          term: `srv-${wsId}-${a.name}`,
          url: port === null ? null : `http://localhost:${port}`,
        }
      })
      const run: ServerRun = {
        apps,
        cwd: s('cwd'),
        prepareTerm: `srv-${wsId}-prepare`,
        preparing: true,
        projectId: s('projectId'),
        slot,
        workspaceId: wsId,
      }
      runs.set(wsId, run)
      setTimeout(() => {
        run.preparing = false
        for (const a of apps) if (a.status === 'queued') step(wsId, a.name, 'starting', null)
      }, 1200)
      setTimeout(() => {
        for (const a of apps) {
          if (a.status !== 'starting') continue
          if (a.name === 'bo')
            step(
              wsId,
              a.name,
              'failed',
              `exited (code 1):\nError: listen EADDRINUSE: address already in use :::${a.port}`
            )
          else step(wsId, a.name, 'ready', null)
        }
      }, 3200)
      return structuredClone(run)
    }
    case 'servers_stop': {
      const wsId = s('workspaceId')
      const asked = (args.apps as string[] | null) ?? null
      const run = runs.get(wsId)
      if (run === undefined) return null
      if (asked === null) runs.delete(wsId)
      else for (const a of run.apps) if (asked.includes(a.name)) a.status = 'stopped'
      return null
    }
    default:
      return undefined
  }
}
