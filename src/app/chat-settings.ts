// The model and effort new chats open on: a per-window convenience kept in localStorage.
import { type ChatSettings, DEFAULT_CHAT } from '../model/agents'

const CHAT_SETTINGS = 'logit.chat'

/** Storage may be empty or refused: the defaults then hold. */
export function readChatSettings(): ChatSettings {
  try {
    const raw = localStorage.getItem(CHAT_SETTINGS)
    return raw === null
      ? DEFAULT_CHAT
      : { ...DEFAULT_CHAT, ...(JSON.parse(raw) as Partial<ChatSettings>) }
  } catch {
    return DEFAULT_CHAT
  }
}

export function saveChatSettings(next: ChatSettings) {
  try {
    localStorage.setItem(CHAT_SETTINGS, JSON.stringify(next))
  } catch {
    // Remembering the choice is a convenience; chats then open on the defaults.
  }
}
