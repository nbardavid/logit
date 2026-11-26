import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useState } from 'react'

import {
  arrange,
  type Catalog,
  type ChatRecord,
  type Project,
  type Workspace,
} from '../model/catalog'
import { noteProjects } from './project-look'
import { stopServers } from './use-servers'

export type CatalogStatus =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string }

const SELECTION = 'logit.selection'
const EMPTY: Catalog = { chats: [], projects: [], workspaces: [] }

interface Selection {
  projectId: string | null
  workspaceId: string | null
}

function readSelection(): Selection {
  // A convenience: without it the app opens on the last opened project.
  try {
    return {
      projectId: null,
      workspaceId: null,
      ...JSON.parse(localStorage.getItem(SELECTION) ?? '{}'),
    }
  } catch {
    return { projectId: null, workspaceId: null }
  }
}

const NONE: ReadonlySet<string> = new Set()

/**
 * Projects, worktrees and saved chats, as the store keeps them on disk; and what is selected.
 * A `leaving` workspace, being deleted in the background, is never the selection.
 */
export function useCatalog(leaving: ReadonlySet<string> = NONE) {
  const [catalog, setCatalog] = useState<Catalog>(EMPTY)
  const [status, setStatus] = useState<CatalogStatus>({ kind: 'loading' })
  const [selection, setSelectionState] = useState<Selection>(readSelection)

  // Avatars, folders and Settings › Projects follow the projects as they are, order included.
  useEffect(() => noteProjects(catalog.projects), [catalog.projects])

  const reload = useCallback(async () => {
    const next = await invoke<Catalog>('catalog')
    setCatalog(next)
    return next
  }, [])

  useEffect(() => {
    reload().then(
      () => setStatus({ kind: 'ready' }),
      (error: unknown) => setStatus({ kind: 'error', message: String(error) })
    )
  }, [reload])

  // The order is the user's: the catalog keeps it as they last dragged it.
  const projects = catalog.projects

  // A selection that no longer exists falls back to the first project and its first worktree.
  const project = projects.find((p) => p.id === selection.projectId) ?? projects[0]
  const inProject = catalog.workspaces.filter(
    (w) => w.projectId === project?.id && !leaving.has(w.id)
  )
  const workspace = inProject.find((w) => w.id === selection.workspaceId) ?? inProject[0]

  const select = useCallback((projectId: string, workspaceId: string | null) => {
    const next = { projectId, workspaceId }
    setSelectionState(next)
    try {
      localStorage.setItem(SELECTION, JSON.stringify(next))
    } catch {
      // Remembered for the next launch only when storage allows it.
    }
  }, [])

  // Opening a project bumps it to the top of the pickers, as the TUI's recent list does.
  const projectId = project?.id
  useEffect(() => {
    if (projectId !== undefined) void invoke('project_open', { id: projectId }).catch(() => {})
  }, [projectId])

  const addProject = useCallback(
    async (path: string) => {
      const added = await invoke<Project>('project_add', { path })
      await reload()
      select(added.id, null)
      return added
    },
    [reload, select]
  )

  const removeProject = useCallback(
    async (id: string) => {
      // Its workspaces' dev servers stop with it: only what logit started there.
      const owned = catalog.workspaces.filter((w) => w.projectId === id)
      await Promise.all(owned.map(async (w) => stopServers(w.id).catch(() => {})))
      await invoke('project_remove', { id })
      await reload()
    },
    [catalog.workspaces, reload]
  )

  const createWorkspace = useCallback(
    async (
      projectId_: string,
      candidates: string[],
      base: string | null,
      // An agent's: it shows in the sidebar without taking the user there.
      parentChat: string | null = null,
      // Its first prompt: Claude names it (title and branch) in the background, as the TUI does.
      prompt = ''
    ) => {
      const created = await invoke<Workspace>('workspace_create', {
        base,
        candidates,
        parentChat,
        projectId: projectId_,
      })
      await reload()
      if (parentChat === null) select(projectId_, created.id)
      if (prompt.trim() !== '')
        invoke<Workspace | null>('workspace_autoname', { id: created.id, prompt })
          .then(async (named) => {
            if (named !== null) await reload()
          })
          .catch(() => {})
      return created
    },
    [reload, select]
  )

  const removeWorkspace = useCallback(
    async (id: string, force: boolean) => {
      await stopServers(id).catch(() => {})
      await invoke('workspace_remove', { force, id })
      await reload()
    },
    [reload]
  )

  /** Settings › Projects: its name (empty gives the folder's back), tone and icon. */
  const updateProject = useCallback(
    async (id: string, look: { name: string; color: string; icon: string }) => {
      await invoke('project_update', { id, ...look })
      await reload()
    },
    [reload]
  )

  /** The Claude accounts its new chats run as; empty is the default one. */
  const setProjectAccounts = useCallback(
    async (id: string, accounts: string[]) => {
      await invoke('project_set_accounts', { accounts, id })
      await reload()
    },
    [reload]
  )

  /** Its display name; the branch and folder keep their colour. Empty gives the colour back. */
  const renameWorkspace = useCallback(
    async (id: string, name: string) => {
      await invoke('workspace_rename', { id, name })
      await reload()
    },
    [reload]
  )

  /** Put aside (muted in the sidebar) or taken back up. */
  const pauseWorkspace = useCallback(
    async (id: string, paused: boolean) => {
      // Put aside: its dev servers stop; they start again when asked.
      if (paused) await stopServers(id).catch(() => {})
      await invoke('workspace_pause', { id, paused })
      await reload()
    },
    [reload]
  )

  /** A paused workspace taken back up; any other is left as it is. */
  const unpause = useCallback(
    (id: string) => {
      if (catalog.workspaces.find((w) => w.id === id)?.paused !== true) return
      pauseWorkspace(id, false).catch(() => {
        // Stays muted; the menu's Resume still works.
      })
    },
    [catalog.workspaces, pauseWorkspace]
  )

  /** A publish seen in a chat; `live` (not replayed) also reopens a closed tab. */
  const addArtifact = useCallback(
    async (workspaceId: string, url: string, title: string, chatId: string, live: boolean) => {
      await invoke('artifact_add', { chatId, live, title, url, workspaceId })
      await reload()
    },
    [reload]
  )
  const closeArtifact = useCallback(
    async (workspaceId: string, url: string) => {
      await invoke('artifact_close', { url, workspaceId })
      await reload()
    },
    [reload]
  )
  const seeArtifact = useCallback(
    async (workspaceId: string, url: string) => {
      await invoke('artifact_seen', { url, workspaceId })
      await reload()
    },
    [reload]
  )

  /** Projects or one project's workspaces, dropped in a new order: shown at once, then kept. */
  const reorder = useCallback((ids: string[]) => {
    setCatalog((c) => ({
      ...c,
      projects: arrange(c.projects, ids),
      workspaces: arrange(c.workspaces, ids),
    }))
    void invoke('catalog_reorder', { ids }).catch(() => {})
  }, [])

  const saveChat = useCallback(
    (chat: ChatRecord) => void invoke('chat_save', { chat }).catch(() => {}),
    []
  )
  const forgetChat = useCallback(
    (id: string) => void invoke('chat_forget', { id }).catch(() => {}),
    []
  )

  return {
    addArtifact,
    addProject,
    catalog,
    closeArtifact,
    createWorkspace,
    forgetChat,
    pauseWorkspace,
    project,
    projects,
    reload,
    removeProject,
    removeWorkspace,
    renameWorkspace,
    reorder,
    saveChat,
    seeArtifact,
    select,
    setProjectAccounts,
    status,
    unpause,
    updateProject,
    workspace,
  }
}
