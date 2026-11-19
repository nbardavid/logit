import type { Question } from '../chat/model'

// What the preview's Claude asks with AskUserQuestion (see fixtures.ts, `?question`).

/** `?question`: two questions, the second a multi-select. */
export const QUESTIONS: Question[] = [
  {
    header: 'Scope',
    multiSelect: false,
    options: [
      { description: 'Only the files this branch touched.', label: 'Changed files' },
      { description: 'Slower, catches what the menus broke elsewhere.', label: 'Whole suite' },
    ],
    question: 'Which tests should I run?',
  },
  {
    header: 'Fixes',
    multiSelect: true,
    options: [
      { description: 'Commit nothing, list what fails.', label: 'Report only' },
      { description: 'Patch what fails in the menus.', label: 'Fix menus' },
      { description: 'Patch the snapshot files too.', label: 'Update snapshots' },
    ],
    question: 'What may I change?',
  },
]
/** `?question=long`: one question at every limit (a long question, long labels, a 4th). */
export const LONG_QUESTIONS: Question[] = [
  {
    header: 'Migration',
    multiSelect: false,
    options: [
      {
        description:
          'Each workspace keeps its own folder and branch; the old sidebar state is read once at launch and written to the new store, then the old file is left where it is, untouched, in case someone goes back to an older build.',
        label: 'Read the old state once at launch, write it to the new store (Recommended)',
      },
      {
        description: 'Simpler, but everyone loses their pinned rows and their order.',
        label: 'Start from a clean store',
      },
      {
        description: 'Both stores live side by side for one release, then the old one goes.',
        label: 'Keep both for a release',
      },
      { description: '', label: 'Ask the owner first' },
    ],
    question:
      'The sidebar state moves to the new store in this release: how should the workspaces people already have get there, given that some of them still run an older build on another machine and share the same profile folder through a synced drive?',
  },
]
