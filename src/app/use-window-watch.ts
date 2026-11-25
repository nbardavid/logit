import { getCurrentWindow } from '@tauri-apps/api/window'
import { type RefObject, useEffect } from 'react'

/**
 * The chat on screen, while the window has the focus, is being watched: what it finished is
 * read. `id` is the tab on screen in normal mode, else null.
 */
export function useWatching(
  watching: RefObject<string | null>,
  id: string | null,
  seen: (id: string) => void
) {
  useEffect(() => {
    const look = async () => {
      const focused = await getCurrentWindow().isFocused()
      watching.current = focused ? id : null
      if (watching.current !== null) seen(watching.current)
    }
    void look()
    const unlisten = getCurrentWindow().onFocusChanged(() => void look())
    return () => void unlisten.then((f) => f())
  }, [id, seen, watching])
}

/**
 * While the attention toast is up, ⌘↩ opens its chat: it goes first, so the chat on screen
 * does not take it as Allow. `attention` answers whether it took the key.
 */
export function useAttentionKey(attention: () => boolean) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && !e.shiftKey && e.key === 'Enter' && attention()) {
        e.preventDefault()
        e.stopImmediatePropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // The ref behind `attention` is read at key time; one listener for the app's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
