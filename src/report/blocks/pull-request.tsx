import type { PullRequestBlock } from './types'

import { PrCard } from '../../cards/pr-card'
import { has, useBlockActions } from './primitives'

/**
 * The pull request: the same live card a chat shows (src/cards/pr-card.tsx). What the agent
 * wrote of it draws until GitHub answers, and stays if it can't.
 */
export function PullRequest({ branch, ci, review, title, url }: Omit<PullRequestBlock, 'kind'>) {
  const { cwd } = useBlockActions()
  if (!has(url)) return null
  return <PrCard url={url} cwd={cwd} sketch={{ branch, ci, review, title }} />
}
