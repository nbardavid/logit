import { describe, expect, test } from 'bun:test'

import { declaredApps, EXAMPLE } from './servers-pane'
import { readyUrls, type ServerRun, shortCause } from './use-servers'
import { isDockTag } from './workspace-dock'

describe('dev servers', () => {
  test('the example declaration parses into its apps', () => {
    expect(declaredApps(EXAMPLE)).toEqual([
      { name: 'api', optional: false, port: 3000 },
      { name: 'web', optional: true, port: 5173 },
    ])
  })

  test('a declaration that will not parse shows no rows', () => {
    expect(declaredApps('{ nope')).toEqual([])
    expect(declaredApps('')).toEqual([])
    expect(declaredApps(null)).toEqual([])
  })

  test("servers' output stays in the dock, out of the tab bar", () => {
    expect(isDockTag('server:web')).toBe(true)
    expect(isDockTag('run')).toBe(true)
    expect(isDockTag(undefined)).toBe(false)
    expect(isDockTag('serverless')).toBe(false)
  })

  test('preview opens only the apps that answer', () => {
    const app = (name: string, status: 'ready' | 'starting') => ({
      detail: null,
      name,
      optional: false,
      port: 1,
      status,
      term: '',
      url: `http://localhost:${name}`,
    })
    const run = { apps: [app('a', 'ready'), app('b', 'starting')] } as unknown as ServerRun
    expect(readyUrls(run).map((a) => a.name)).toEqual(['a'])
    expect(readyUrls(undefined)).toEqual([])
  })
})

describe('shortCause', () => {
  test('names a port already taken', () => {
    expect(shortCause('exited (code 1):\nError: Port 5302 is already in use\n    at x')).toBe(
      'port 5302 already in use'
    )
    expect(shortCause('Error: listen EADDRINUSE: address already in use :::3401')).toBe(
      'port 3401 already in use'
    )
  })
  test('keeps the last error line, not the stack', () => {
    expect(
      shortCause(
        "exited (code 1):\nError: Cannot find module 'x'\n    at load (a.js:1)\n ELIFECYCLE"
      )
    ).toBe("Error: Cannot find module 'x'")
  })
  test('is null without a detail', () => {
    expect(shortCause(null)).toBeNull()
  })
})
