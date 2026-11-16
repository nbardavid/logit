import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useRef } from 'react'

import type { Workspace } from '../model/catalog'
import type { ChatTab } from './use-chats'

/**
 * What a chat's agent asks of the window through logit's MCP server (relayed by the host):
 * a new workspace, as the composer makes one, a prompt for a chat it started, or the removal
 * of a workspace it made.
 */
export type AgentAsk = { askId: number } & (
  | {
      op: 'workspace_create'
      projectId: string
      prompt: string
      base: string | null
      model: string | null
      effort: string | null
      parentChat: string
    }
  | { op: 'chat_send'; chatId: string; text: string }
  | { op: 'chat_stop'; chatId: string }
  | { op: 'workspace_remove'; workspaceId: string; force: boolean }
)

/** The chat and workspace asks: a prompt for a chat, its stop, or a workspace's removal. */
export async function followUp(
  ask: Exclude<AgentAsk, { op: 'workspace_create' }>,
  chats: {
    chats: readonly ChatTab[]
    interrupt: (id: string) => void
    send: (id: string, text: string) => void
  },
  workspaces: readonly Workspace[],
  remove: (w: Workspace, force: boolean) => Promise<void>
): Promise<object> {
  if (ask.op === 'workspace_remove') {
    const w = workspaces.find((x) => x.id === ask.workspaceId)
    if (w === undefined) throw new Error('That workspace is already gone.')
    await remove(w, ask.force)
    return {}
  }
  if (!chats.chats.some((c) => c.record.id === ask.chatId)) throw new Error('That chat is closed.')
  if (ask.op === 'chat_stop') chats.interrupt(ask.chatId)
  else chats.send(ask.chatId, ask.text)
  return {}
}

type Handle = (ask: AgentAsk) => Promise<object>

const NOT_READY: Handle = async () => {
  throw new Error('logit is still starting.')
}

/**
 * Runs each ask with the handler last put in the returned ref (set on every render, after
 * the app's early returns) and sends the host its answer, or its error.
 */
export function useAgentAsks() {
  const latest = useRef<Handle>(NOT_READY)
  useEffect(() => {
    const off = listen<AgentAsk>('host-ask', ({ payload }) => {
      void latest
        .current(payload)
        .catch((error: unknown) => ({
          error: error instanceof Error ? error.message : String(error),
        }))
        .then(async (result) => invoke('host_answer', { askId: payload.askId, result }))
        .catch(() => {})
    })
    return () => void off.then((f) => f())
  }, [])
  return latest
}
