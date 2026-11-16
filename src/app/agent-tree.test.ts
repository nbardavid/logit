import { expect, test } from 'bun:test'

import type { Catalog, Workspace } from '../model/catalog'

import { kidsNote, rollUp, rootOf } from './agent-tree'
import { shownView } from './browser-tabs'

const ws = (id: string, parentWorkspace?: string): Workspace => ({
  base: 'main',
  branch: `logit/${id}`,
  createdAt: 0,
  id,
  name: id,
  path: `/wt/${id}`,
  projectId: 'p',
  ...(parentWorkspace !== undefined && { parentChat: `c-${parentWorkspace}`, parentWorkspace }),
})

const catalog = (workspaces: Workspace[]): Catalog => ({
  chats: [],
  projects: [{ id: 'p', lastOpenedAt: 0, name: 'p', path: '/p' }],
  workspaces,
})

test('a tree keeps its parent once the chat that made it is closed', () => {
  const grand = ws('grand', 'kid')
  const c = catalog([ws('root'), ws('kid', 'root'), grand])
  expect(rootOf(c, grand).id).toBe('root')
})

test('a loop in the parents still ends', () => {
  const a = ws('a', 'b')
  const c = catalog([a, ws('b', 'a')])
  expect(['a', 'b']).toContain(rootOf(c, a).id)
})

test("a row shows its tree's strongest signal", () => {
  const [root, kid, grand] = [ws('root'), ws('kid', 'root'), ws('grand', 'kid')]
  const c = catalog([root, kid, grand, ws('other')])
  const tree = { kid: [grand], root: [kid] }
  const out = rollUp(c.workspaces, tree, { grand: 'waiting', kid: 'working', root: 'done' })
  expect(out).toEqual({ grand: 'waiting', kid: 'waiting', other: null, root: 'waiting' })
})

test('deleting a parent says its children stay', () => {
  const [root, grand] = [ws('root'), ws('grand', 'kid')]
  const c = catalog([root, ws('kid', 'root'), grand])
  expect(kidsNote(c, root)).toContain('The 2 workspaces')
  expect(kidsNote(c, grand)).toBe('')
})

test('the Agents view stays as asked', () => {
  expect(shownView('agents', false, [], null)).toBe('agents')
})
