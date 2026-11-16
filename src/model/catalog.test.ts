import { expect, test } from 'bun:test'

import {
  arrange,
  type Artifact,
  byProject,
  type Catalog,
  childrenOf,
  descendants,
  isNew,
  strongest,
  withoutChildren,
  type Workspace,
} from './catalog'

const ws = (id: string, projectId: string, createdAt: number): Workspace => ({
  base: 'main',
  branch: `logit/${id}`,
  createdAt,
  id,
  name: id,
  path: `/wt/${id}`,
  projectId,
})

test('arrange puts the named ids first, in order, the rest after as they were', () => {
  const items = ['a', 'b', 'c', 'd'].map((id) => ({ id }))
  expect(arrange(items, ['c', 'a']).map((x) => x.id)).toEqual(['c', 'a', 'b', 'd'])
})

test('workspaces group under their project, in the catalog order', () => {
  const catalog: Catalog = {
    chats: [],
    projects: [
      { id: 'p', lastOpenedAt: 0, name: 'p', path: '/p' },
      { id: 'q', lastOpenedAt: 0, name: 'q', path: '/q' },
    ],
    workspaces: [ws('b', 'p', 2), ws('a', 'p', 1), ws('x', 'gone', 0)],
  }
  expect(byProject(catalog)).toEqual({ p: [ws('b', 'p', 2), ws('a', 'p', 1)], q: [] })
})

test('a question beats work in progress beats a finished turn', () => {
  expect(strongest(['done', 'working', null])).toBe('working')
  expect(strongest(['done', 'waiting'])).toBe('waiting')
  expect(strongest([null])).toBe(null)
})

const a: Artifact = { at: 10, chatId: 'c', title: 'Flow', url: 'https://claude.ai/artifact/x' }

test('an artifact is new until seen after its last publish', () => {
  expect(isNew(a)).toBe(true)
  expect(isNew({ ...a, seenAt: null })).toBe(true)
  expect(isNew({ ...a, seenAt: 5 })).toBe(true)
  expect(isNew({ ...a, seenAt: 10 })).toBe(false)
  expect(isNew({ ...a, seenAt: 12 })).toBe(false)
})

test('a workspace an agent made sits under its parent, not in the sidebar', () => {
  const chat = (id: string, workspaceId: string) => ({
    createdAt: 0,
    effort: '',
    id,
    model: '',
    sessionId: null,
    title: id,
    workspaceId,
  })
  const catalog: Catalog = {
    chats: [chat('c-root', 'root'), chat('c-kid', 'kid')],
    projects: [{ id: 'p', lastOpenedAt: 0, name: 'p', path: '/p' }],
    workspaces: [
      ws('root', 'p', 0),
      { ...ws('kid', 'p', 1), parentChat: 'c-root' },
      { ...ws('grand', 'p', 2), parentChat: 'c-kid' },
      { ...ws('orphan', 'p', 3), parentChat: 'c-gone' },
    ],
  }
  const children = childrenOf(catalog)
  expect(children['root']?.map((w) => w.id)).toEqual(['kid'])
  expect(descendants(children, 'root').map((w) => w.id)).toEqual(['kid', 'grand'])
  expect(withoutChildren(byProject(catalog), catalog)['p']?.map((w) => w.id)).toEqual([
    'root',
    'orphan',
  ])
})
