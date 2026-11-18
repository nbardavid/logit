import { LucideProvider } from 'lucide-react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './app'
import { migrateLegacyStorage } from './app/legacy-storage'
import { AppWallpaper } from './app/wallpaper'
import '@fontsource/geist-mono/400.css'
import '@fontsource/geist-mono/500.css'
import '@fontsource/geist-mono/600.css'
import '@xterm/xterm/css/xterm.css'

import './styles.css'

// In a plain browser (vite dev only), Tauri's IPC is answered from fixtures, and
// `?gallery` shows the UI primitives and `?blocks` every report block instead of the app.
const preview = import.meta.env.DEV && !('__TAURI_INTERNALS__' in window)
const params = new URLSearchParams(location.search)
const gallery = preview && params.has('gallery')
const blocks = preview && params.has('blocks')

async function start() {
  migrateLegacyStorage()
  if (preview) await import('./dev/mock-ipc')
  let Root = App
  if (gallery) Root = (await import('./dev/gallery')).Gallery
  else if (blocks) Root = (await import('./dev/blocks')).BlocksGallery
  const root = document.querySelector('#root')
  if (root) {
    createRoot(root).render(
      <StrictMode>
        {/* Every icon in the app's one stroke. */}
        <LucideProvider strokeWidth={1.5}>
          {/* The chat background, behind the whole window. */}
          {!gallery && !blocks && <AppWallpaper />}
          <Root />
        </LucideProvider>
      </StrictMode>
    )
  }
}

void start()
