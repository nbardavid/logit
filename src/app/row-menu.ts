// A sidebar row's right-click menu: a project's or a workspace's actions.
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowUpRightIcon,
  CopyIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  MessageSquarePlusIcon,
  PencilIcon,
  PlusIcon,
  SquareTerminalIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'

import type { Catalog, Signal, Workspace } from '../model/catalog'
import type { MenuItem } from './context-menu'
import type { RowMenu } from './sidebar'
import type { useCatalog } from './use-catalog'

import { kidsNote, withDescendants } from './sidebar-tree'

const copy = (text: string) => void navigator.clipboard.writeText(text)

export function rowMenuItems(
  row: RowMenu,
  o: {
    catalog: Catalog
    /** Each workspace path's uncommitted changes. */
    changes: Record<string, readonly unknown[] | null | undefined>
    closeRemoved: (w: Workspace) => void
    compose: (projectId: string) => void
    /** The workspace on screen: its rows' shortcuts apply, and its PR is known. */
    current: string | undefined
    pr: { number: number; url: string } | null
    /** A new chat or terminal in that workspace, which comes on screen. */
    openTab: (w: Workspace, kind: 'chat' | 'terminal') => void
    askForPr: (w: Workspace) => void
    fail: (title: string) => (error: unknown) => void
    removeWorkspace: (w: Workspace, force: boolean) => void
    rename: (id: string) => void
    signals: Record<string, Signal | null>
    store: Pick<ReturnType<typeof useCatalog>, 'pauseWorkspace' | 'removeProject'>
    workspaces: Record<string, readonly Workspace[] | undefined>
  }
): MenuItem[] {
  const path = row.kind === 'project' ? row.project.path : row.workspace.path
  const items: MenuItem[] = []
  if (row.kind === 'project')
    items.push({
      icon: PlusIcon,
      label: 'New workspace…',
      run: () => o.compose(row.project.id),
      shortcut: '⌘N',
    })
  items.push({
    icon: FolderOpenIcon,
    label: 'Show in Finder',
    run: async () => revealItemInDir(path),
  })
  items.push({ icon: CopyIcon, label: 'Copy path', run: () => copy(path) })
  if (row.kind === 'project') {
    const owned = o.workspaces[row.project.id] ?? []
    items.push('separator', {
      confirm: {
        button: 'Close project',
        text: `Close ${row.project.name}? It leaves the app; its folder and worktrees stay on disk.`,
      },
      danger: true,
      icon: XIcon,
      label: 'Close project…',
      run: async () => {
        await o.store.removeProject(row.project.id)
        for (const w of owned) o.closeRemoved(w)
      },
    })
    return items
  }
  const w = row.workspace
  const paused = w.paused === true
  // Park: put aside (a session kept for later) under its project's Parked group, with the
  // workspaces it started; unparked, they come back with it.
  const park = async () => {
    for (const x of withDescendants(o.catalog, w)) {
      if ((x.paused === true) === !paused) continue
      await o.store.pauseWorkspace(x.id, !paused).catch(o.fail(`Couldn't update ${x.name}`))
    }
  }
  items.push({ icon: GitBranchIcon, label: 'Copy branch name', run: () => copy(w.branch) })
  const here = w.id === o.current
  const toggle = {
    icon: paused ? ArchiveRestoreIcon : ArchiveIcon,
    label: paused ? 'Unpark' : 'Park',
    run: park,
  }
  const pr = here ? o.pr : null
  items.unshift(
    {
      icon: MessageSquarePlusIcon,
      label: 'New chat here',
      run: () => o.openTab(w, 'chat'),
      ...(here && { shortcut: '⌘T' }),
    },
    {
      icon: SquareTerminalIcon,
      label: 'New terminal here',
      run: () => o.openTab(w, 'terminal'),
      ...(here && { shortcut: '⇧⌘T' }),
    },
    // Its PR is known only on screen; elsewhere, Claude checks before opening one.
    pr === null
      ? { icon: GitPullRequestIcon, label: 'Ask for PR', run: () => o.askForPr(w) }
      : {
          icon: ArrowUpRightIcon,
          label: `Open #${pr.number} on GitHub`,
          run: async () => openUrl(pr.url),
        },
    'separator',
    { icon: PencilIcon, label: 'Rename', run: () => o.rename(w.id) },
    toggle,
    'separator'
  )
  const dirty = (o.changes[w.path]?.length ?? 0) > 0
  items.push('separator', {
    confirm: {
      button: dirty ? 'Delete anyway' : 'Delete',
      cautious: true,
      text: dirty
        ? `${w.name} has uncommitted changes. Deleting it discards them and removes its worktree folder. The branch ${w.branch} stays.`
        : `Delete ${w.name}? Its tabs close and its worktree folder is removed. The branch ${w.branch} stays.${kidsNote(o.catalog, w)}`,
      ...((o.signals[w.id] === 'working' || o.signals[w.id] === 'waiting') && {
        warning: ' · Claude is working',
      }),
    },
    danger: true,
    icon: Trash2Icon,
    label: 'Delete workspace…',
    run: () => {
      o.removeWorkspace(w, dirty)
    },
  })
  return items
}
