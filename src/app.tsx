import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { PencilIcon, XIcon } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'

import { notify, playChosenSound, waitingAttention } from './app/attention'
import { browserId } from './app/browser-tabs'
import { readChatSettings, saveChatSettings } from './app/chat-settings'
import { ChatView } from './app/chat-view'
import { cleanupOf, useCardCleanup } from './app/cleanup-effect'
import { ContextMenu, type MenuState, useNoBrowserMenu } from './app/context-menu'
import { Dock } from './app/dock'
import { DraftIntro, EMPTY_TITLE, NoWorkspace, QUIET } from './app/empty-states'
import { leaveInPieces, useLeaving, withoutLeaving } from './app/explode'
import { GitMode } from './app/git-mode'
import { HostBar } from './app/host-bar'
import { McpPanel } from './app/mcp-panel'
import { afterClose, paletteTarget, stepThrough } from './app/navigation'
import { NewWorkspace } from './app/new-workspace'
import { overlayShown } from './app/overlay'
import { paletteList, runPaletteAction } from './app/palette'
import { NEW_TAB, Picker } from './app/picker'
import { PR_PROMPT, SETUP_PROMPT } from './app/prompts'
import { Quotas } from './app/quotas'
import { reportTab } from './app/report-view'
import { resumeTarget, type Session } from './app/resume'
import { type CommandPick, ResumePicker } from './app/resume-picker'
import { RightPanel } from './app/right-panel'
import { rowMenuItems } from './app/row-menu'
import { stepPane } from './app/settings-pane'
import { SettingsView } from './app/settings-view'
import { SidePeek } from './app/side-peek'
import { colourWord, diffStat, type RowMenu, Sidebar } from './app/sidebar'
import { parentsOf, signalsOf, treeRows } from './app/sidebar-tree'
import { Slide, Splitter } from './app/splitter'
import { TabBar, type TabItem } from './app/tab-bar'
import { TerminalView } from './app/terminal-view'
import { type Attention, AttentionToast, errorText, type Notice, NoticeToast } from './app/toast'
import { TopBar } from './app/top-bar'
import { UpdateButton, useUpdate } from './app/update-button'
import { accountFor } from './app/use-accounts'
import { type AgentAsk, followUp, useAgentAsks } from './app/use-agent-asks'
import { useArtifacts } from './app/use-artifacts'
import { useCatalog } from './app/use-catalog'
import { chatSignal, type ChatTab, turnsEnded, useChats } from './app/use-chats'
import { type FileChange, useGit } from './app/use-git'
import { HOST_BLOCKED, useHost } from './app/use-host'
import { useLaunches } from './app/use-launches'
import { LIMITS, SIDE_WIDTH, sideWidthNow, useLayout } from './app/use-layout'
import { useModels } from './app/use-models'
import { needsOf, useNeedsSeen } from './app/use-needs'
import { useQuotas } from './app/use-quotas'
import { useReports } from './app/use-reports'
import { useSetupRun } from './app/use-setup-run'
import { useTerminals } from './app/use-terminals'
import { useAttentionKey, useWatching } from './app/use-window-watch'
import { isDockTag } from './app/workspace-dock'
import { onPrMerged } from './cards/pr-store'
import { availableCommands } from './chat/commands'
import { appNote, type ChatState, type Image, initialChat } from './chat/model'
import {
  chatFlags,
  type ChatSettings,
  effortName,
  modelName,
  normalize,
  reportedModel,
} from './model/agents'
import { byProject, type Workspace } from './model/catalog'
import { nameCandidates } from './model/names'

/** The chat an empty workspace offers: nothing runs until its first Enter. */
const DRAFT: ChatState = { ...initialChat, status: 'idle' }

// The shell's repeated pieces: the splash, the quiet empty states, the toasts.
const SPLASH = 'text-muted-foreground grid h-full place-items-center p-6 text-center'
// White sheets on the ground (DESIGN.md › Surfaces): the chat, and git mode's page.
const SHEET =
  'bg-background shadow-sheet my-gap mr-gap ml-[calc(var(--gap)-1px)] flex-col overflow-hidden rounded-xl'
/** A key cap on the ink button. */
const KBD_INK = 'text-white/60'

export function App() {
  const [removing, markRemoving] = useLeaving()
  const store = useCatalog(removing)
  const { catalog, project, projects, status, workspace: ws } = store
  const projectId = project?.id ?? null
  const [mode, setMode] = useState<'normal' | 'git'>('normal')
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Bumped by ⌘P's Merge: the git panel's head asks its question.
  const [mergeAsk, setMergeAsk] = useState(0)
  const [overlay, setOverlay] = useState<'projects' | 'new-tab' | null>(null)
  // Where the new-tab menu drops from.
  const [menuAt, setMenuAt] = useState<{ left: number; top: number } | null>(null)
  const { commands: appWideCommands, models } = useModels()
  const [stored, setSelectionState] = useState(readChatSettings)
  // What was picked under an older model list falls back to what this one offers.
  const selection = normalize(stored, models)
  const [composeIn, setComposeIn] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<MenuState | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  // A rename `/rename` started: its title also goes to Claude, so `/resume` shows it.
  const renameTells = useRef<string | null>(null)
  /** The content right of the sidebar: it slides with it (⌘S). */
  const content = useRef<HTMLDivElement>(null)
  const [commandPick, setCommandPick] = useState<CommandPick | null>(null)
  // A tab whose agent is working closes on the second ask: ⌘W twice, or × twice.
  const [armed, setArmed] = useState<string | null>(null)
  const [activeByWs, setActiveByWs] = useState<Record<string, string>>({})
  const [attention, setAttention] = useState<Attention | null>(null)
  // ⌘0 with nothing waiting on the user: counted, so the sidebar says so once more.
  const [nothingNeeds, setNothingNeeds] = useState(0)
  const [needsSeen, setNeedsSeen] = useNeedsSeen()
  const keys = useRef({
    /** Opens the attention toast's chat, when one is up. */
    attention: (): boolean => false,
    close: () => {},
    compose: () => {},
    newTab: (_kind: 'chat' | 'terminal') => {},
    /** ⌘0: the next workspace that asks something the user has not seen. */
    nextNeed: () => {},
    stepTab: (_step: 1 | -1) => {},
    stepWorkspace: (_step: 1 | -1) => {},
    toWorkspace: (_index: number) => {},
  })
  const [gitFile, setGitFile] = useState<FileChange>()
  const [notice, setNotice] = useState<Notice | null>(null)
  /** Shows a failure as a toast titled with what was being done. */
  const fail = (title: string) => (error: unknown) => setNotice({ text: errorText(error), title })
  const [renamingWs, setRenamingWs] = useState<string | null>(null)
  const terminals = useTerminals()
  const appUpdate = useUpdate()
  const host = useHost()
  /** The tab on screen, when the window has the focus: what needs no calling out. */
  const watching = useRef<string | null>(null)

  const workspaces = useMemo(
    () => byProject(withoutLeaving(catalog, removing)),
    [catalog, removing]
  )
  useCardCleanup(catalog.workspaces, () => removal)
  const selectWs = (pid: string, wid: string | null) => {
    setMode('normal')
    store.select(pid, wid)
  }
  const placeOf = (workspaceId: string) => {
    const w = catalog.workspaces.find((x) => x.id === workspaceId)
    const p = projects.find((x) => x.id === w?.projectId)
    return { project: p, workspace: w }
  }
  const placeRef = useRef(placeOf)
  placeRef.current = placeOf

  // Set once the panel's hook exists, below: a chat's publish reaches it.
  const publish = useRef<ReturnType<typeof useArtifacts>['published']>(() => {})
  const reports = useReports(ws?.id)
  const chats = useChats({
    accountOf: accountFor,
    canStart: () => host.state.kind === 'ready',
    modelOf: (reported, current) => reportedModel(reported, current, models),
    onArtifact: (chat, artifact, live) =>
      publish.current(chat.record.workspaceId, chat.record.id, artifact, live),
    onAttention: (chat: ChatTab, kind) => {
      if (watching.current === chat.record.id) return
      const { project: p, workspace: w } = placeRef.current(chat.record.workspaceId)
      if (!p || !w) return
      void playChosenSound()
      void (async () => {
        if (!(await getCurrentWindow().isFocused())) {
          await notify(
            `${chat.record.title} ${kind === 'waiting' ? 'is waiting for you' : 'is done'}`
          )
        } else if (kind === 'waiting') setAttention(waitingAttention(chat, p, w))
      })()
    },
    onRecord: store.saveChat,
    onReport: reports.arrived,
    onSent: store.unpause,
  })
  // A merge pressed in the app (a PR card, the git panel): the workspace's chats are told, so
  // the agent knows its PR landed without being asked.
  const chatsNow = useRef(chats.chats)
  chatsNow.current = chats.chats
  const { tell } = chats
  useEffect(
    () =>
      onPrMerged(({ cwd, number, url }) => {
        const note = appNote(`I merged pull request #${number} (${url}) with logit's Merge button.`)
        for (const c of chatsNow.current) {
          if (c.cwd === cwd && c.record.sessionId !== null) tell(c.record.id, note)
        }
      }),
    [tell]
  )

  // The sidebar's ages and task titles: the open chats' live records over the saved ones.
  const sidebarChats = useMemo(() => {
    const live = new Map(chats.chats.map((c) => [c.record.id, c.record]))
    return [...catalog.chats.filter((r) => !live.has(r.id)), ...live.values()]
  }, [catalog.chats, chats.chats])

  const { runSetup, setupRan } = useSetupRun(host.state.kind === 'ready', store.reload, terminals)

  // Chats an earlier launch left open come back, in the worktrees that still exist: live when
  // the background host still runs them, asleep otherwise. Its terminals come back as tabs.
  // A host too old to keep gives nothing back until it is restarted.
  const agentAsk = useAgentAsks()
  const restored = useRef(false)
  useEffect(() => {
    if (status.kind !== 'ready' || host.state.kind === 'loading' || restored.current) return
    restored.current = true
    const list = host.state.kind === 'ready' ? host.state.list : { chats: [], terms: [] }
    chats.restore(
      catalog.chats.flatMap((record) => {
        const w = catalog.workspaces.find((x) => x.id === record.workspaceId)
        return w ? [{ cwd: w.path, record }] : []
      }),
      list.chats
    )
    for (const t of list.terms) {
      terminals.reattach(t, t.tag === 'setup' ? setupRan(t.workspaceId) : undefined)
    }
  }, [catalog, chats, host.state, setupRan, status.kind, terminals])

  const wsChats = chats.chats.filter((c) => c.record.workspaceId === ws?.id)
  // Setup, Run and the dock's own terminals live in the panel's dock, not in the tabs.
  const wsTerms = terminals.tabs.filter((t) => t.workspaceId === ws?.id && !isDockTag(t.tag))
  const tabItems: (TabItem & { at: number })[] = [
    ...wsChats.map((c) => ({
      at: c.record.createdAt,
      chat: true,
      id: c.record.id,
      signal: chatSignal(c),
      title: c.record.title,
    })),
    ...wsTerms.map((t) => ({
      at: t.createdAt,
      chat: false,
      id: t.id,
      signal: null,
      title: t.title,
    })),
  ].toSorted((a, b) => a.at - b.at)
  // Workspaces the composer is getting ready: shown in place of their chat until it starts.
  const launches = useLaunches()
  const launch = launches.view(ws?.id)
  const active = tabItems.find((t) => t.id === activeByWs[ws?.id ?? '']) ?? tabItems[0]
  const chat = active?.chat === true ? wsChats.find((c) => c.record.id === active.id) : undefined
  const term = active?.chat === false ? wsTerms.find((t) => t.id === active.id) : undefined
  // Where you are, for ⌘P's Recent: the chat on screen, else the workspace. Kept per window.
  let here = ws ? `ws:${ws.id}` : null
  if (chat) here = `chat:${chat.record.id}`
  const [visited, setVisited] = useState<string[]>([])
  useEffect(() => {
    if (here !== null) setVisited((v) => [here, ...v.filter((k) => k !== here)].slice(0, 20))
  }, [here])
  // The chat on screen asks something: ⌘↩ answers it, whatever toast is up.
  const questionHere = mode === 'normal' && chat !== undefined && chat.state.pending.length > 0

  const selectTab = (workspaceId: string, tabId: string) =>
    setActiveByWs((state) => ({ ...state, [workspaceId]: tabId }))

  // The chat on screen runs, and what it finished is read.
  const chatOnScreen = chat?.record.id
  useEffect(() => {
    if (chatOnScreen === undefined) return
    void chats.wake(chatOnScreen).catch(() => {})
  }, [chatOnScreen, chats])
  useWatching(watching, mode === 'normal' ? (active?.id ?? null) : null, chats.seen)

  const paths = useMemo(() => catalog.workspaces.map((w) => w.path), [catalog.workspaces])
  const settled = useMemo(() => turnsEnded(chats.chats, ws?.id), [chats.chats, ws?.id])
  const git = useGit(ws?.path, paths, settled)
  const quotas = useQuotas()
  const { layout, update } = useLayout()
  const artifacts = useArtifacts({
    addArtifact: store.addArtifact,
    catalog,
    closeArtifact: store.closeArtifact,
    hasPr: git.pr !== null,
    onClosed: (url) => void invoke('browser_close', { id: browserId(url) }).catch(() => {}),
    openPanel: () => update({ gitOpen: true }),
    reports,
    seeArtifact: store.seeArtifact,
    visible: layout.gitOpen && mode === 'normal',
    workspaceId: ws?.id,
  })
  publish.current = artifacts.published
  reports.watch(artifacts.view === 'report' && layout.gitOpen && mode === 'normal')
  const changes = ws === undefined ? undefined : git.changes[ws.path]
  const diffs = useMemo(
    () => Object.fromEntries(Object.entries(git.changes).map(([path, c]) => [path, diffStat(c)])),
    [git.changes]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // The diff is a page: Esc leaves it, unless something sits over it.
        const over = overlay !== null || composeIn !== null || ctxMenu !== null
        if (mode === 'normal' || e.defaultPrevented || over || overlayShown()) return
        setMode('normal')
      } else if (e.ctrlKey && e.key === 'Tab')
        // In Settings, ⌃Tab steps through its panes.
        (settingsOpen ? stepPane : keys.current.stepTab)(e.shiftKey ? -1 : 1)
      // ⌃1–9: the tabs of this workspace; ⌘1–9: the workspaces, in sidebar order.
      else if (e.ctrlKey && !e.metaKey && /^Digit[1-9]$/.test(e.code)) {
        const tab = tabItems[Number(e.code.slice(5)) - 1]
        if (tab === undefined || ws === undefined || mode !== 'normal') return
        selectTab(ws.id, tab.id)
      } else if (!e.metaKey) return
      else if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        keys.current.stepWorkspace(e.key === 'ArrowDown' ? 1 : -1)
      }
      // e.code: with Option held, e.key is the composed character.
      else if (e.code === 'KeyB' && e.altKey) update({ gitOpen: !layout.gitOpen })
      else if (e.code === 'KeyS' || e.code === 'KeyB') update({ sideOpen: !layout.sideOpen })
      else if (e.code === 'Digit0') keys.current.nextNeed()
      else if (e.key === 'p') setOverlay('projects')
      else if (e.key.toLowerCase() === 't') keys.current.newTab(e.shiftKey ? 'terminal' : 'chat')
      else if (e.key === 'w') keys.current.close()
      else if (e.key === 'n') keys.current.compose()
      else if (e.key === 'g') setMode((m) => (m === 'git' ? 'normal' : 'git'))
      else if (e.key === ',') setSettingsOpen((open) => !open)
      // ⌘O works on the splash too, before the rest of the keys are wired.
      else if (e.code === 'KeyO') void newProject()
      else if (/^Digit[1-9]$/.test(e.code)) keys.current.toWorkspace(Number(e.code.slice(5)) - 1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useAttentionKey(() => keys.current.attention())

  useNoBrowserMenu()

  useEffect(() => {
    if (armed === null) return
    const timer = setTimeout(() => setArmed(null), 2500)
    return () => clearTimeout(timer)
  }, [armed])

  const newProject = async () => {
    const path = await openDialog({ directory: true, title: 'Open a folder as a project' })
    if (typeof path !== 'string') return
    try {
      await store.addProject(path)
      setMode('normal')
    } catch (error) {
      fail("Couldn't open the folder")(error)
    }
  }

  if (status.kind !== 'ready') {
    return <main className={SPLASH}>{status.kind === 'error' ? status.message : 'Opening…'}</main>
  }

  if (projects.length === 0) {
    return (
      <main className={SPLASH}>
        <div className={QUIET}>
          <span className={EMPTY_TITLE}>Open a repository to start</span>
          <span>Each piece of work then gets its own worktree, with its chats and terminals.</span>
          <Button onClick={() => void newProject()}>
            Open a folder
            <Kbd className={KBD_INK}>⌘O</Kbd>
          </Button>
        </div>
      </main>
    )
  }

  const setSelection = (next: ChatSettings) => {
    setSelectionState(next)
    saveChatSettings(next)
  }

  const newChat = (w: Workspace, prompt?: string, images: readonly Image[] = []) => {
    const id = chats.create(w.id, w.path, chatFlags(selection))
    selectTab(w.id, id)
    if ((prompt ?? '') !== '' || images.length > 0) void chats.send(id, prompt ?? '', images)
    return id
  }

  /** "Ask for PR": the chat on screen asks, else the workspace's newest, else a new one. */
  const askForPr = (w: Workspace) => {
    const own = chats.chats.filter((c) => c.record.workspaceId === w.id)
    const id = ((w.id === ws?.id ? chat : undefined) ?? own.at(-1))?.record.id ?? newChat(w)
    if (w.id !== ws?.id) store.select(w.projectId, w.id)
    selectTab(w.id, id)
    void chats.send(id, PR_PROMPT)
  }
  /** A chat (with the last model and effort picked, on `prompt`) or a shell, in `w`. */
  const createTab = (kind: string, prompt?: string, w = ws) => {
    setOverlay(null)
    if (w === undefined) return
    if (host.state.kind !== 'ready') {
      setNotice({ text: HOST_BLOCKED, title: `Couldn't open a ${kind}` })
      return
    }
    if (w.id !== ws?.id) {
      setMode('normal')
      store.select(w.projectId, w.id)
    }
    if (kind === 'chat') newChat(w, prompt)
    else selectTab(w.id, terminals.create({ cwd: w.path, workspaceId: w.id }))
  }

  const namesIn = (pid: string) => (workspaces[pid] ?? []).map((w) => w.name)
  launches.deps.current = {
    createWorkspace: (pid, base, prompt) =>
      store.createWorkspace(pid, nameCandidates(namesIn(pid)), base, null, prompt),
    reopenComposer: setComposeIn,
    runSetup,
    setupFailed: (error) => fail('Setup did not start')(error),
    startChat: newChat,
  }

  /** The composer's Create: it closes at once, the workspace gets ready where its chat will be. */
  const startWork = async (pid: string, base: string | null, prompt: string) => {
    if (host.state.kind !== 'ready') throw new Error(HOST_BLOCKED)
    setMode('normal')
    launches.start(pid, base, prompt)
  }

  /** An agent's ask (logit's MCP): a workspace as the composer makes one, or a follow-up. */
  agentAsk.current = async (ask: AgentAsk) => {
    if (host.state.kind !== 'ready') throw new Error(HOST_BLOCKED)
    if (ask.op !== 'workspace_create')
      return followUp(ask, chats, catalog.workspaces, async (w, force) =>
        leaveInPieces(w.id, async () => deleteWorkspace(w, force), markRemoving)
      )
    const taken = nameCandidates(namesIn(ask.projectId))
    const w = await store.createWorkspace(
      ask.projectId,
      taken,
      ask.base,
      ask.parentChat,
      ask.prompt
    )
    const hasScript = await invoke<{ exists: boolean }>('setup_status', { projectId: w.projectId })
    if (hasScript.exists) await runSetup(w)
    const flags = chatFlags(selection)
    const id = chats.create(w.id, w.path, {
      effort: ask.effort ?? flags.effort,
      model: ask.model ?? flags.model,
    })
    selectTab(w.id, id)
    void chats.send(id, ask.prompt)
    return { branch: w.branch, chatId: id, name: w.name, path: w.path }
  }

  /**
   * Bursts in pieces at once while git removes the worktree in the background. Its tabs close
   * only once the worktree is gone: a refusal brings the row's content back with a toast.
   */
  const removeWorkspace = (w: Workspace, force: boolean) => {
    leaveInPieces(w.id, async () => deleteWorkspace(w, force), markRemoving).catch(
      fail(`Could not delete ${w.name}`)
    )
  }

  /** The removal itself, awaited: the git panel's clean up shows its own effect and refusal. */
  const deleteWorkspace = async (w: Workspace, force: boolean) => {
    await store.removeWorkspace(w.id, force)
    closeRemoved(w)
  }

  const closeRemoved = (w: Workspace) => {
    terminals.closeWorkspace(w.id)
    const pages = (w.artifacts ?? []).map((a) => browserId(a.url))
    void invoke('browser_close_many', { ids: pages }).catch(() => {})
    for (const c of chats.chats) if (c.record.workspaceId === w.id) chats.close(c.record.id)
  }

  const renamed = (w: Workspace, name: string | null) => {
    setRenamingWs(null)
    if (name === null || name === w.name) return
    store.renameWorkspace(w.id, name).catch(fail(`Couldn't rename ${w.name}`))
  }
  const rowMenu = (row: RowMenu) => {
    const items = rowMenuItems(row, {
      askForPr,
      catalog,
      changes: git.changes,
      closeRemoved,
      compose: setComposeIn,
      current: ws?.id,
      fail,
      openTab: (w, kind) => createTab(kind, undefined, w),
      pr: git.pr,
      removeWorkspace,
      rename: setRenamingWs,
      signals,
      store,
      workspaces,
    })
    setCtxMenu({ items, x: row.x, y: row.y })
  }

  const requestClose = (id: string) => {
    const chatTab = wsChats.find((c) => c.record.id === id)
    if (chatTab?.state.status === 'working' && armed !== id) {
      setArmed(id)
      return
    }
    setArmed(null)
    // The neighbour takes over, as in a browser: the tab to the right, else to the left.
    const next = afterClose(
      tabItems.map((t) => t.id),
      id,
      active?.id
    )
    if (ws !== undefined && next !== undefined && next !== active?.id) selectTab(ws.id, next)
    if (chatTab) {
      chats.close(id)
      store.forgetChat(id)
    } else terminals.close(id)
  }

  const signals = signalsOf(catalog.workspaces, chats.chats)
  // Each project's rows in tree order (a sub-workspace under the one that started it), the
  // parked ones closing the list, folded under "Parked".
  const parents = parentsOf(catalog)
  const lists = Object.fromEntries(
    Object.entries(workspaces).map(([pid, list]) => [
      pid,
      [
        ...treeRows(
          list.filter((w) => w.paused !== true),
          parents
        ),
        ...treeRows(
          list.filter((w) => w.paused === true),
          parents
        ),
      ].map((r) => r.ws),
    ])
  )
  /** Every workspace, in sidebar order: ⌘1–9, ⌥⌘↑/↓ and ⌘0 go through it. */
  const order = projects.flatMap((p) => lists[p.id] ?? [])
  const needs = needsOf({
    catalog,
    chats: chats.chats,
    here: mode === 'normal' && !settingsOpen ? (ws?.id ?? null) : null,
    mergedOf: git.mergedOf,
    order,
    reports,
    seen: needsSeen,
    setSeen: setNeedsSeen,
    signals,
  })
  keys.current = {
    attention: () => {
      if (attention === null || questionHere) return false
      goTo(attention.projectId, attention.workspaceId, attention.chatId)
      setAttention(null)
      return true
    },
    close: () => {
      if (active !== undefined && mode === 'normal') requestClose(active.id)
    },
    compose: () => projectId !== null && setComposeIn(projectId),
    newTab: (kind: 'chat' | 'terminal') => createTab(kind),
    nextNeed: () => {
      const id = needs.next()
      const target = order.find((w) => w.id === id)
      if (target === undefined) {
        setNothingNeeds((n) => n + 1)
        return
      }
      const waiting = chats.chats.find(
        (c) => c.record.workspaceId === target.id && c.state.pending.length > 0
      )
      if (waiting) goTo(target.projectId, target.id, waiting.record.id)
      else selectWs(target.projectId, target.id)
    },
    stepTab: (step) => {
      const next = stepThrough(
        tabItems.map((t) => t.id),
        active?.id,
        step
      )
      if (ws !== undefined && next !== undefined && mode === 'normal') selectTab(ws.id, next)
    },
    stepWorkspace: (step) => {
      const next = stepThrough(
        order.map((w) => w.id),
        ws?.id,
        step
      )
      const target = order.find((w) => w.id === next)
      if (target) {
        setMode('normal')
        store.select(target.projectId, target.id)
      }
    },
    toWorkspace: (index) => {
      const target = order[index]
      if (!target) return
      setMode('normal')
      store.select(target.projectId, target.id)
    },
  }

  const removal = { fail, hide: markRemoving, remove: deleteWorkspace }
  const cleanup = cleanupOf(ws, (changes?.length ?? 0) > 0, removal)

  // What this workspace's Claude is doing, for the git panel's questions.
  const wsSignal = ws === undefined ? null : (signals[ws.id] ?? null)
  const claudeHere = wsSignal === 'done' ? null : wsSignal

  /** A chat's model and effort, as its record keeps them ('' is Claude Code's default). */
  const agentOf = (c: ChatTab) =>
    normalize({ effort: c.record.effort, model: c.record.model || 'default' }, models)

  /**
   * Picked in the chat's footer, by `/model`, `/effort` or ⇧⌘/: told to Claude at once. A typed
   * command shows as sent; a pick shows as one faint line ("Model → Sonnet 5.5").
   */
  const setAgent = (c: ChatTab, next: ChatSettings, typed: boolean) => {
    const now = agentOf(c)
    const id = c.record.id
    if (next.model !== now.model) {
      chats.setModel(id, next.model, typed ? undefined : `Model → ${modelName(next.model, models)}`)
    }
    if (next.effort !== now.effort) {
      chats.setEffort(
        id,
        next.effort,
        typed ? undefined : `Intelligence → ${effortName(next.effort)}`
      )
    }
  }

  /** The app's own `/` commands; Claude's others are sent as typed. */
  const runCommand = (c: ChatTab, name: string, args: string) => {
    const id = c.record.id
    if (name === 'clear') chats.clear(id)
    else if (name === 'rename' && args !== '') {
      chats.rename(id, args)
      void chats.send(id, `/rename ${args}`)
    } else if (name === 'rename') {
      renameTells.current = id
      setRenaming(id)
    } else if (name === 'resume' || name === 'mcp') setCommandPick({ args, chatId: id, name })
  }

  /** A session open in a tab is that tab; else it opens in a new one where it ran. */
  const resume = (session: Session) => {
    setCommandPick(null)
    if (ws === undefined || projectId === null) return
    const open = chats.chats.map((c) => ({
      id: c.record.id,
      sessionId: c.record.sessionId,
      workspaceId: c.record.workspaceId,
    }))
    const target = resumeTarget(session, open, workspaces[projectId] ?? [], ws.id)
    const pid = placeOf(target.workspaceId).project?.id ?? projectId
    if (target.kind === 'tab') goTo(pid, target.workspaceId, target.chatId)
    else {
      const title = session.title || session.firstPrompt
      goTo(
        pid,
        target.workspaceId,
        chats.openSession(target.workspaceId, target.cwd, session.id, title)
      )
    }
  }

  const pickFor = commandPick && chats.chats.find((c) => c.record.id === commandPick.chatId)

  const tabMenu = (item: TabItem, x: number, y: number) =>
    setCtxMenu({
      items: [
        { icon: PencilIcon, label: 'Rename', run: () => setRenaming(item.id) },
        { icon: XIcon, label: 'Close', run: () => requestClose(item.id), shortcut: '⌘W' },
      ],
      x,
      y,
    })

  /** Takes you to a chat anywhere: its project, its workspace, its tab. */
  const goTo = (pid: string, wid: string, tabId: string) => {
    setMode('normal')
    store.select(pid, wid)
    selectTab(wid, tabId)
  }

  const searchItems = () =>
    paletteList({
      branch: git.branch,
      catalog,
      chats: chats.chats.map((c) => c.record),
      here,
      layout,
      pr: git.pr,
      projects,
      recent: visited,
      sidebarChats,
      signals,
      workspaceId: ws?.id ?? null,
      workspaces,
    })
  const runAction = (id: string) =>
    runPaletteAction(id, {
      askForPr,
      askMerge: () => {
        setMode('normal')
        update({ gitOpen: true })
        artifacts.setView('changes')
        setMergeAsk((n) => n + 1)
      },
      compose: () => keys.current.compose(),
      createTab,
      fail,
      openFolder: () => void newProject(),
      openSettings: () => setSettingsOpen(true),
      panelOpen: layout.gitOpen,
      pr: git.pr,
      pushed: git.refresh,
      showDiff: () => setMode('git'),
      sideOpen: layout.sideOpen,
      update,
      ws,
    })

  /** ⌘P's pick: a workspace, a chat in its tab, a project, or an action. */
  const goToItem = (key: string) => {
    setOverlay(null)
    const { id, kind } = paletteTarget(key)
    if (kind === 'action') {
      runAction(id)
      return
    }
    if (kind === 'chat') {
      const c = chats.chats.find((x) => x.record.id === id)
      const pid = c && placeOf(c.record.workspaceId).project?.id
      if (c && pid !== undefined) goTo(pid, c.record.workspaceId, id)
      return
    }
    setMode('normal')
    if (kind === 'project') store.select(id, null)
    else {
      const w = catalog.workspaces.find((x) => x.id === id)
      if (w) store.select(w.projectId, w.id)
    }
  }

  const openFile = (file: FileChange) => {
    setGitFile(file)
    setMode('git')
  }
  /** A turn footer's file chip: git mode on that file, or on the whole diff (`null`). */
  const openChangedFile = (path: string | null) => {
    const file = changes?.find((c) => c.path === path)
    if (file) setGitFile(file)
    setMode('git')
  }

  const topBar = (title: string | undefined, gitOpen: boolean | null, tabsRow?: ReactNode) => (
    <TopBar
      title={title}
      place={mode === 'normal' ? ws?.name : undefined}
      sideOpen={layout.sideOpen}
      gitOpen={gitOpen}
      canDiff={ws !== undefined}
      noChanges={mode === 'normal' && changes?.length === 0}
      gitMode={mode === 'git'}
      onShowSide={() => update({ sideOpen: true })}
      onToggleGit={() => update({ gitOpen: !layout.gitOpen })}
      onGitMode={() => setMode((m) => (m === 'git' ? 'normal' : 'git'))}
      tools={<UpdateButton update={appUpdate} />}
    >
      {tabsRow}
    </TopBar>
  )
  const hostBar = host.state.kind === 'blocked' && (
    <HostBar lose={host.state.lose} onRestart={host.restart} />
  )
  // A failure: bottom right of the pane in front, never over the git panel; over a chat, just
  // above its composer (and its question), never on them.
  const toastsAt = (className?: string) =>
    notice !== null && (
      <NoticeToast
        key={`${notice.title}\n${notice.text}`}
        notice={notice}
        className={className}
        onClose={() => setNotice(null)}
      />
    )
  const toasts = toastsAt()
  const toastsOverChat = toastsAt('bottom-full mb-4')
  // A chat asking from elsewhere never covers the one you read: docked at the foot of the
  // sidebar (8px inside it, 8px clear of the foot's hairline), or, the sidebar hidden, at the
  // top right of the pane, 8px under its bars.
  const attentionToast = attention && (
    <AttentionToast
      key={attention.chatId}
      attention={attention}
      keyed={!questionHere}
      className={
        layout.sideOpen
          ? 'right-2 bottom-full left-2 mb-[9px] w-auto max-w-none'
          : 'top-full bottom-auto mt-2'
      }
      onOpen={() => goTo(attention.projectId, attention.workspaceId, attention.chatId)}
      onClose={() => setAttention(null)}
    />
  )
  /** The pane's top bar, the restart bar under it, and the attention toast under both. */
  const bars = (bar: ReactNode) => (
    <div className="relative flex flex-none flex-col">
      {bar}
      {hostBar}
      {!layout.sideOpen && attentionToast}
    </div>
  )
  const pageTitle = mode === 'git' ? `${ws?.name ?? ''} · Diff` : undefined

  const sideWidth = layout.sideWidth === null ? SIDE_WIDTH : `${layout.sideWidth}px`

  const sidebar = (
    <Sidebar
      needs={{
        count: needs.count,
        nothing: nothingNeeds,
        onNext: () => keys.current.nextNeed(),
        stops: needs.stops,
        unread: needs.unread,
      }}
      width={sideWidth}
      page={settingsOpen ? 'settings' : null}
      foot={<Quotas cache={quotas.cache} error={quotas.error} />}
      dock={layout.sideOpen && attentionToast}
      projects={projects}
      workspaces={lists}
      parents={parents}
      signals={signals}
      diffs={diffs}
      chats={sidebarChats}
      projectId={projectId}
      workspaceId={ws?.id ?? null}
      onSelect={selectWs}
      onProjects={() => setOverlay('projects')}
      onNewProject={() => void newProject()}
      onNewWorkspace={setComposeIn}
      onMenu={rowMenu}
      onReorder={store.reorder}
      renamingId={renamingWs}
      onRename={(w) => setRenamingWs(w.id)}
      onRenamed={renamed}
      onSettings={() => setSettingsOpen((open) => !open)}
      onHide={() => update({ sideOpen: false })}
    />
  )

  return (
    <div className="relative h-full">
      {!layout.sideOpen && <SidePeek width={sideWidth}>{sidebar}</SidePeek>}
      <div className="flex h-full">
        <Slide open={layout.sideOpen} width={`calc(${sideWidth} + 1px)`} follow={content}>
          {sidebar}
          <Splitter
            label="Resize the projects sidebar"
            value={layout.sideWidth ?? sideWidthNow()}
            min={LIMITS.side[0]}
            max={LIMITS.side[1]}
            direction={1}
            onChange={(next) => update({ sideWidth: next })}
          />
        </Slide>
        <div ref={content} className="relative flex min-w-0 flex-1 flex-col">
          <div className="absolute inset-x-0 top-0 h-gap" data-tauri-drag-region />
          {mode !== 'normal' && toasts}
          <div className={cn('flex min-h-0 flex-1', mode === 'normal' ? 'py-gap pr-gap' : SHEET)}>
            {mode !== 'normal' && bars(topBar(pageTitle, null, null))}
            {mode === 'normal' && (
              <>
                <main
                  className="bg-background shadow-sheet relative ml-[calc(var(--gap)-1px)] flex min-h-0 min-w-[360px] flex-1 flex-col rounded-xl"
                  data-zoom-host
                >
                  {bars(
                    topBar(
                      undefined,
                      ws === undefined ? null : layout.gitOpen,
                      ws !== undefined && (
                        <TabBar
                          items={tabItems}
                          activeId={active?.id}
                          armedId={armed}
                          renamingId={renaming}
                          onSelect={(item) => selectTab(ws.id, item.id)}
                          onClose={(item) => requestClose(item.id)}
                          onMenu={tabMenu}
                          onRename={(item) => setRenaming(item.id)}
                          onRenamed={(item, title) => {
                            setRenaming(null)
                            const tell = renameTells.current === item.id
                            renameTells.current = null
                            if (title === null || title === item.title) return
                            if (!item.chat) terminals.rename(item.id, title)
                            else {
                              chats.rename(item.id, title)
                              if (tell) void chats.send(item.id, `/rename ${title}`)
                            }
                          }}
                          onNew={(at) => {
                            setMenuAt(at)
                            setOverlay('new-tab')
                          }}
                        />
                      )
                    )
                  )}
                  {launch}
                  {launch === null && chat && (
                    <ChatView
                      above={toastsOverChat}
                      id={chat.record.id}
                      cwd={chat.cwd}
                      state={chat.state}
                      agent={agentOf(chat)}
                      models={models}
                      onAgent={(next, typed) => setAgent(chat, next, typed)}
                      blocked={host.state.kind === 'blocked'}
                      commands={availableCommands(chat.state.commands, appWideCommands)}
                      onSend={(text, images) => void chats.send(chat.record.id, text, images)}
                      onCommand={(name, args) => runCommand(chat, name, args)}
                      onAnswer={(...answer) => void chats.answer(chat.record.id, ...answer)}
                      onInterrupt={() => chats.interrupt(chat.record.id)}
                      onUnqueue={(ids) => chats.unqueue(chat.record.id, ids)}
                      onShell={(command) => chats.shell(chat.record.id, command)}
                      onAskUsage={() => chats.askUsage(chat.record.id)}
                      onStopTask={(task) => chats.stopTask(chat.record.id, task)}
                      onOpenFile={openChangedFile}
                      place={ws?.name}
                    />
                  )}
                  {launch === null && term && (
                    <TerminalView tabId={term.id} attach={terminals.attach} />
                  )}
                  {launch === null && ws === undefined && (
                    <NoWorkspace
                      name={project?.name ?? 'No project'}
                      onNew={() => projectId !== null && setComposeIn(projectId)}
                    />
                  )}
                  {launch === null && ws !== undefined && active === undefined && (
                    // No tab yet: the chat composer itself, focused; the first Enter makes
                    // the chat, on the model picked here (the one new chats start on).
                    <ChatView
                      above={toastsOverChat}
                      id={`draft:${ws.id}`}
                      cwd={ws.path}
                      place={ws.name}
                      state={DRAFT}
                      agent={selection}
                      models={models}
                      onAgent={(next) => setSelection(next)}
                      blocked={host.state.kind === 'blocked'}
                      commands={appWideCommands}
                      onSend={(text, images) => {
                        if (host.state.kind === 'ready') newChat(ws, text, images)
                        else setNotice({ text: HOST_BLOCKED, title: "Couldn't start a chat" })
                      }}
                      onCommand={() => createTab('chat')}
                      onAnswer={() => {}}
                      onInterrupt={() => {}}
                      intro={<DraftIntro onTerminal={() => createTab('terminal')} />}
                    />
                  )}
                  {mode === 'normal' && !chat && active !== undefined && toasts}
                  {ws === undefined && toasts}
                </main>
                <RightPanel
                  open={layout.gitOpen && ws !== undefined}
                  split={reports.has}
                  layout={layout}
                  update={update}
                  artifacts={artifacts}
                  panel={
                    ws && {
                      branch: git.branch,
                      changes,
                      claude: claudeHere,
                      cleanup,
                      mergeAsk,
                      onAskPr: () => askForPr(ws),
                      onChanged: git.refresh,
                      onError: (title, error) => fail(title)(error),
                      onOpenFile: openFile,
                      path: ws.path,
                      pr: git.pr,
                      report: reportTab(reports, wsChats, git.pr, (id) => selectTab(ws.id, id), {
                        colour: colourWord(ws.path),
                        project: project?.name,
                      }),
                      setup: (
                        <Dock
                          ws={ws}
                          projectName={project?.name ?? ''}
                          terminals={terminals}
                          hostReady={host.state.kind === 'ready'}
                          onBlocked={(title) => setNotice({ text: HOST_BLOCKED, title })}
                          fail={fail}
                          runSetup={runSetup}
                          onWriteSetup={(script) => newChat(ws, SETUP_PROMPT(script))}
                          onAskAgent={(prompt) => newChat(ws, prompt)}
                        />
                      ),
                      wsBranch: ws.branch,
                    }
                  }
                />
              </>
            )}
            {mode === 'git' && ws !== undefined && (
              <GitMode
                path={ws.path}
                changes={changes ?? []}
                file={changes?.find((f) => f.path === gitFile?.path)}
                onSelect={setGitFile}
              />
            )}
            {mode === 'git' && ws === undefined && (
              <div className={QUIET}>No workspace selected</div>
            )}
          </div>
        </div>
      </div>

      {settingsOpen && (
        <SettingsView
          chats={chats.chats.filter((c) => c.state.status === 'working').length}
          terminals={terminals.tabs.filter((t) => t.exited === undefined).length}
          onRestartHost={host.restart}
          onSetProjectAccounts={store.setProjectAccounts}
          onUpdateProject={(id, look) =>
            void store.updateProject(id, look).catch(fail("Couldn't save the project"))
          }
          onAsk={(prompt) => {
            setSettingsOpen(false)
            createTab('chat', prompt)
          }}
          update={appUpdate}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {composeIn !== null && (
        <NewWorkspace
          projects={projects}
          projectId={composeIn}
          selection={selection}
          models={models}
          onSelection={setSelection}
          onCreate={startWork}
          onClose={() => setComposeIn(null)}
        />
      )}
      {ctxMenu && <ContextMenu menu={ctxMenu} onClose={() => setCtxMenu(null)} />}
      {overlay === 'projects' && (
        <Picker
          title="Go to a workspace, chat, project or action"
          items={searchItems()}
          filterable
          onClose={() => setOverlay(null)}
          onPick={goToItem}
        />
      )}
      {commandPick?.name === 'mcp' && (
        <McpPanel
          request={async (request) => chats.mcp(commandPick.chatId, request)}
          onClose={() => setCommandPick(null)}
        />
      )}
      {commandPick?.name === 'resume' && project && ws && (
        <ResumePicker
          projectId={project.id}
          mainPath={project.path}
          workspaces={workspaces[project.id] ?? []}
          currentPath={ws.path}
          currentSession={pickFor?.record.sessionId ?? null}
          openSessions={Object.fromEntries(
            chats.chats.flatMap((c) =>
              c.record.sessionId === null ? [] : [[c.record.sessionId, c.record.title]]
            )
          )}
          initialQuery={commandPick.args}
          onPick={resume}
          onClose={() => setCommandPick(null)}
        />
      )}
      {overlay === 'new-tab' && (
        <Picker
          title={`New tab in ${ws?.name ?? 'this workspace'}`}
          items={NEW_TAB}
          filterable={false}
          anchor={menuAt ?? undefined}
          onClose={() => setOverlay(null)}
          onPick={createTab}
        />
      )}
    </div>
  )
}
