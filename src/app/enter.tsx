// Entrances play for what arrives, never for what was already there. A surface that mounts
// (a chat switched back to, a task page for another workspace, the sidebar shown again)
// draws its existing content at once; only what is added after it mounted rises in.
import {
  type ComponentPropsWithoutRef,
  createContext,
  type ElementType,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

/** Whether the scope has committed once: what mounts after that is new. */
const Ready = createContext<RefObject<boolean> | null>(null)

/**
 * Where entrances count from. Everything inside that mounts in the scope's first commit (or
 * in the commit where `quiet` changes: a chat's window reaching back to older exchanges, a
 * page for another workspace) shows at once.
 */
export function EnterScope({ children, quiet }: { children: ReactNode; quiet?: unknown }) {
  const ready = useRef(false)
  const last = useRef(quiet)
  if (!Object.is(last.current, quiet)) {
    last.current = quiet
    ready.current = false
  }
  useEffect(() => {
    ready.current = true
  })
  return <Ready value={ready}>{children}</Ready>
}

/**
 * Whether this component, as it mounts, should play its entrance. Fixed for its lifetime, so
 * a later render never starts it. Outside a scope it always does.
 */
export function useEnter(): boolean {
  const ready = useContext(Ready)
  const [enter] = useState(() => ready === null || ready.current)
  return enter
}

type InProps<T extends ElementType> = {
  as?: T
  /** The entrance's classes (`animate-in fade-in …`), applied only when it is new. */
  enter: string
} & ComponentPropsWithoutRef<T>

/** An element that plays `enter` when it mounts as something new, and draws still otherwise. */
export function In<T extends ElementType = 'div'>({ as, className, enter, ...rest }: InProps<T>) {
  const Tag: ElementType = as ?? 'div'
  const play = useEnter()
  return <Tag className={cn(play && enter, className)} {...rest} />
}
