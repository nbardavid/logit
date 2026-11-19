import { expect, test } from 'bun:test'

import type { Catalog, Workspace } from '../model/catalog'

import { kidsNote, parentsOf, treeRows, withDescendants } from './sidebar-tree'

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

test('a sub-workspace sits right under its parent, its own children under it', () => {
  const list = [ws('a'), ws('kid', 'a'), ws('b'), ws('grand', 'kid'), ws('kid2', 'a')]
  const rows = treeRows(list, parentsOf(catalog(list)))
  expect(rows.map((r) => [r.ws.id, r.depth])).toEqual([
    ['a', 0],
    ['kid', 1],
    ['grand', 2],
    ['kid2', 1],
    ['b', 0],
  ])
  expect(rows.map((r) => r.below)).toEqual([3, 1, 0, 0, 0])
  // kid is not its parent's last child: the guide runs on past grand.
  expect(rows[2]).toMatchObject({ last: true, parent: 'kid', rails: [true] })
  expect(rows[3]).toMatchObject({ last: true, parent: 'a' })
})

test('a child whose parent is in another list (parked apart) is a top row', () => {
  const all = [ws('a'), ws('kid', 'a')]
  const rows = treeRows([all[1] as Workspace], parentsOf(catalog(all)))
  expect(rows).toMatchObject([{ depth: 0, parent: null }])
})

test('a loop in the parents still shows every row', () => {
  const list = [ws('a', 'b'), ws('b', 'a')]
  expect(treeRows(list, { a: 'b', b: 'a' }).map((r) => r.ws.id)).toEqual(['a', 'b'])
})

test('Park takes the whole tree; deleting a parent says its children stay', () => {
  const [root, kid, grand] = [ws('root'), ws('kid', 'root'), ws('grand', 'kid')]
  const c = catalog([root, kid, grand, ws('other')])
  expect(withDescendants(c, root).map((w) => w.id)).toEqual(['root', 'kid', 'grand'])
  expect(kidsNote(c, root)).toContain('The 2 workspaces it started stay')
  expect(kidsNote(c, grand)).toBe('')
})
