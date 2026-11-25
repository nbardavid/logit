import { FileCodeIcon, FileImageIcon, FileTextIcon } from 'lucide-react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

import type { ChangedFile } from '../chat/model'

/** A changed file under a finished exchange: its icon, its name, its +/−. A readout: it opens
 * nothing; its full path shows on hover. */
export const CHIP = 'inline-flex h-6 max-w-full items-center gap-1.5 rounded-md px-1.5'

function FileIcon({ path }: { path: string }) {
  const cls = 'text-label size-[13px] flex-none'
  if (/\.(png|jpe?g|gif|svg|webp|ico|icns|avif)$/i.test(path))
    return <FileImageIcon className={cls} />
  if (/\.(md|mdx|txt|rst|csv|log)$/i.test(path) || !/\.[a-z0-9]+$/i.test(path))
    return <FileTextIcon className={cls} />
  return <FileCodeIcon className={cls} />
}

export function FileChip({ file }: { file: ChangedFile }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={CHIP} />}>
        <FileIcon path={file.path} />
        <span className="text-muted-foreground truncate text-xs">{file.path.split('/').pop()}</span>
        <span className="flex-none font-mono text-xs tabular-nums">
          {file.added > 0 && <span className="text-good">+{file.added}</span>}
          {file.added > 0 && file.removed > 0 && ' '}
          {file.removed > 0 && <span className="text-critical">−{file.removed}</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="font-mono">
        {file.path}
      </TooltipContent>
    </Tooltip>
  )
}
