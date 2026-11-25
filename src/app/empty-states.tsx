// The quiet screens of an empty place: a project with no workspace, a workspace with no tab.
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'

export const QUIET =
  'text-faint flex flex-1 flex-col items-center justify-center gap-3 px-3 py-8 text-center'
export const EMPTY_TITLE = 'text-foreground text-lg'

/** A project with no workspace on screen: its name, and ⌘N. */
export function NoWorkspace({ name, onNew }: { name: string; onNew: () => void }) {
  return (
    <div className={QUIET}>
      <span className={EMPTY_TITLE}>{name}</span>
      <span className="text-base">Every piece of work gets its own worktree.</span>
      <Button variant="secondary" className="h-8" onClick={onNew}>
        New workspace
        <Kbd>⌘N</Kbd>
      </Button>
    </div>
  )
}

/** Under a workspace's first composer: Enter starts a chat, or a terminal instead. */
export function DraftIntro({ onTerminal }: { onTerminal: () => void }) {
  return (
    <>
      Enter starts a chat in this worktree.{' '}
      <button
        type="button"
        className="hover:text-foreground underline decoration-(--line-strong) underline-offset-2 transition-[color] duration-120"
        onClick={onTerminal}
      >
        Open a terminal
      </button>{' '}
      <Kbd>⇧⌘T</Kbd>
    </>
  )
}
