// The dock bar's Preview: the workspace's dev servers that answer, opened in the panel's browser.
// Always there once servers are declared; greyed while none answers.
import { EyeIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'

import { readyUrls, type ServerRun } from './use-servers'

export function PreviewButton({
  onOpen,
  run,
}: {
  run: ServerRun | undefined
  onOpen: (wsId: string, url: string, title: string) => void
}) {
  const apps = readyUrls(run)
  const said = apps.map((a) => `${a.name} ${a.url?.replace(/^http:\/\//, '') ?? ''}`).join(', ')
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      disabled={run === undefined || apps.length === 0}
      data-tip={apps.length === 0 ? 'No server answers yet' : `Open ${said} in the panel`}
      data-tip-side="top"
      data-tip-align="end"
      onClick={() => {
        if (run === undefined) return
        // The first one declared ends up on screen; the others wait in their tabs.
        for (const a of apps.toReversed())
          if (a.url !== null) onOpen(run.workspaceId, a.url, a.name)
      }}
    >
      <EyeIcon className="size-3.5" />
      Preview
    </Button>
  )
}
