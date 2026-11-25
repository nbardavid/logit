// ⌘P's actions, wired: what the git state allows, and what each pick runs. Every action is
// the same host command its key or button already runs, never a simulated keystroke.
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'

import type { Catalog, Project, Signal, Workspace } from '../model/catalog'
import type { PickerItem } from './picker'
import type { BranchState } from './use-git'

import { mergeGate, prHeadline, type PullRequest } from '../git/pr'
import { openGroundPicker } from './ground-store'
import { type ActionContext, paletteActions, paletteItems, pushKind } from './navigation'
import { PANES, setPane } from './settings-pane'
import { type ChatFacts, colourWord, workspaceFacts } from './sidebar'

/** Each workspace's task (as its sidebar row leads with it) and colour word. */
export function placeNames(workspaces: readonly Workspace[], chats: readonly ChatFacts[]) {
  return Object.fromEntries(
    workspaces.map((w) => {
      const colour = colourWord(w.path)
      const task = w.name === colour ? workspaceFacts(w, chats).task : null
      return [w.id, { colour, task: task ?? w.name }]
    })
  )
}

/** What the git panel's head would offer now: the same rules as its buttons. */
export function gitActions(
  branch: BranchState | null,
  pr: PullRequest | null
): Pick<ActionContext, 'canAskPr' | 'canMerge' | 'pr' | 'push'> {
  const live = branch?.remote === true && branch.branch !== null
  return {
    canAskPr: pr === null && live && (branch.upstream || branch.ahead > 0),
    canMerge:
      pr !== null &&
      prHeadline(pr).action === 'merge' &&
      mergeGate(pr, branch?.ahead ?? 0).blocked === null,
    pr: pr?.number ?? null,
    push: live && pr?.state !== 'Merged' ? pushKind(branch) : null,
  }
}

export interface ActionDeps {
  ws: Workspace | undefined
  pr: PullRequest | null
  sideOpen: boolean
  panelOpen: boolean
  compose: () => void
  update: (layout: { sideOpen?: boolean; gitOpen?: boolean }) => void
  openSettings: () => void
  openFolder: () => void
  createTab: (kind: 'chat' | 'terminal') => void
  askForPr: (w: Workspace) => void
  /** The git panel's head asks its merge question (never a merge unasked). */
  askMerge: () => void
  /** After a push: read git again, or say what failed. */
  pushed: () => void
  fail: (title: string) => (error: unknown) => void
}

/** Runs ⌘P's action `id` (the key after `action:`). */
export function runPaletteAction(id: string, d: ActionDeps) {
  if (id.startsWith('pane:')) {
    setPane(id.slice('pane:'.length))
    d.openSettings()
  } else if (id === 'workspace') d.compose()
  else if (id === 'sidebar') d.update({ sideOpen: !d.sideOpen })
  else if (id === 'settings') d.openSettings()
  else if (id === 'ground') {
    // Above the sidebar footer's palette button: the sidebar shows first if it was hidden.
    d.update({ sideOpen: true })
    openGroundPicker(true)
  } else if (id === 'open-folder') d.openFolder()
  if (d.ws === undefined) return
  const { path } = d.ws
  if (id === 'chat' || id === 'terminal') d.createTab(id)
  else if (id === 'ask-pr') d.askForPr(d.ws)
  else if (id === 'panel') d.update({ gitOpen: !d.panelOpen })
  else if (id === 'open-pr' && d.pr) void openUrl(d.pr.url)
  else if (id === 'merge') d.askMerge()
  else if (id === 'push') void invoke('git_push', { path }).then(d.pushed, d.fail("Couldn't push"))
}

/** Everything ⌘P lists: places (Recent, workspaces, chats, projects), then actions. */
export function paletteList(o: {
  projects: Project[]
  workspaces: Record<string, Workspace[]>
  catalog: Catalog
  chats: readonly {
    id: string
    title: string
    workspaceId: string
    createdAt: number
    activeAt?: number
  }[]
  sidebarChats: readonly ChatFacts[]
  signals: Record<string, Signal | null>
  workspaceId: string | null
  here: string | null
  recent: readonly string[]
  layout: { gitOpen: boolean; sideOpen: boolean }
  branch: BranchState | null
  pr: PullRequest | null
}): PickerItem[] {
  const facts = (w: Workspace) => workspaceFacts(w, o.sidebarChats)
  return [
    ...paletteItems(
      o.projects,
      o.workspaces,
      o.chats.map((c) => ({ ...c, activeAt: c.activeAt ?? c.createdAt })),
      o.signals,
      o.workspaceId,
      {
        activeAt: Object.fromEntries(o.catalog.workspaces.map((w) => [w.id, facts(w).activeAt])),
        here: o.here,
        names: placeNames(o.catalog.workspaces, o.sidebarChats),
        recent: o.recent,
      }
    ),
    ...paletteActions({
      ...gitActions(o.branch, o.pr),
      panelOpen: o.layout.gitOpen,
      panes: PANES,
      sideOpen: o.layout.sideOpen,
      workspace: o.workspaceId !== null,
    }),
  ]
}
