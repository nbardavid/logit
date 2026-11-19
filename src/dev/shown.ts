// `?show`: blocks Claude draws with logit's `show` tool, and a report made of an agent's own
// blocks. amber gets a chat, "Show me the menu work", run by the host and still working: every
// kind shown, a PR link that becomes its card, a missing screen and a slow one, a refused call
// (a tool error row) and a last call in flight, which goes through 15 s after it opens. teal's
// report is the agent's blocks, as the host stores them (screens inlined).
import type { Report } from '../model/report'

import {
  assistant,
  initAnswer,
  LIVE,
  PATHS,
  result,
  sent,
  systemInit,
  toolResult,
} from './fixtures'
import { PR_STATES } from './pull-requests'
import { MENU_STEP } from './reports'

const SHOW = 'mcp__logit__show'
const ok = (n: number) => `Shown in the conversation (${n} block${n === 1 ? '' : 's'}).`

const call = (id: string, blocks: unknown[]) =>
  assistant(`m-${id}`, [{ id, input: { blocks }, name: SHOW, type: 'tool_use' }])
const say = (id: string, text: string) => assistant(id, [{ text, type: 'text' }])

const MENU = [
  {
    kind: 'screens',
    steps: [
      {
        after: 'shots/menu-after.png',
        before: 'shots/menu-before.png',
        caption: 'The tab menu: "Move to" opens on hover',
      },
    ],
    title: 'The tab menu',
  },
  {
    items: [
      { status: 'done', text: 'Ported the tab and sidebar menus to Base UI' },
      { detail: '212 passed, 0 failed.', status: 'done', text: 'Ran the unit tests' },
      {
        detail: 'The visual snapshot of the sidebar menu moved by one pixel; not related.',
        status: 'failed',
        text: 'Visual snapshots',
      },
      {
        detail: 'No signed-in session in the preview.',
        status: 'skipped',
        text: 'Checked the updater menu',
      },
    ],
    kind: 'steps',
    title: 'What I ran',
  },
]

const COMPARE = [
  {
    columns: ['', 'Before', 'After'],
    kind: 'table',
    rows: [
      ['Submenu opens', 'On click', 'On hover, after 100 ms'],
      ['Keyboard', '↑ ↓ only', '↑ ↓, → opens, ← closes'],
      ['Hovered row under a still mouse', 'Lost on re-render', 'Kept'],
    ],
    title: 'Menus, before and after',
  },
  {
    kind: 'callout',
    text: 'Base UI closes a menu on scroll. A long submenu in a small window now closes when you scroll the page behind it.',
    title: 'Scrolling closes menus',
    tone: 'risk',
  },
  {
    items: [
      { setAside: 'Click to open, as before', text: 'Submenus open on hover, like macOS' },
      { text: 'The hovered row stays lit while the mouse rests' },
    ],
    kind: 'decisions',
  },
]

const SHIP = [
  {
    kind: 'text',
    links: [
      { label: 'Pull request #201', url: PR_STATES.passing },
      { label: 'Base UI menu docs', url: 'https://base-ui.com/react/components/menu' },
    ],
    paragraphs: [
      'The port is on **logit/amber**. The sidebar menu still uses `ContextMenu` for its drag handle; it moves in a later change.',
    ],
  },
  {
    kind: 'callout',
    text: 'Nobody uses a submenu deeper than two levels today, so I did not test three.',
    tone: 'assumption',
  },
  { items: ['Merge #201 once its checks pass', 'Try a submenu on a trackpad'], kind: 'left' },
]

const BROKEN = [
  {
    kind: 'screens',
    steps: [
      { after: 'shots/slow.png', caption: 'The updater menu (read slowly)' },
      {
        after: 'shots/settings-menu.png',
        before: 'shots/menu-before.png',
        caption: 'The settings menu',
      },
    ],
    title: 'Two more menus',
  },
  {
    kind: 'callout',
    text: 'The settings menu screenshot is missing: I removed it with the old snapshots.',
    tone: 'note',
  },
]

/** The chat's lines, as the host replays them: its last call still waits on its answer. */
export const SHOWN_LINES = [
  initAnswer('chat-shown'),
  systemInit('session-shown', 'claude-opus-5-5'),
  sent('u-shown-1', 'Show me the menu work: screens, what you ran, what changed.'),
  say('m-shown-1', 'Here is the tab menu, and what I ran on it.'),
  call('show-menu', MENU),
  toolResult('show-menu', ok(MENU.length)),
  say('m-shown-2', 'And how the menus behave now, side by side:'),
  call('show-compare', COMPARE),
  toolResult('show-compare', ok(COMPARE.length)),
  say(
    'm-shown-3',
    'The pull request is open. Everything is in place for you to merge it once checks pass.'
  ),
  call('show-ship', SHIP),
  toolResult('show-ship', ok(SHIP.length)),
  result(0.0921, 42_000),
  sent('u-shown-2', 'And the other menus?'),
  call('show-refused', [{ kind: 'question', question: 'Which menu next?' }]),
  toolResult(
    'show-refused',
    'blocks[0]: no `question` block: a question goes through AskUserQuestion, not a block',
    true
  ),
  call('show-broken', BROKEN),
  toolResult('show-broken', ok(BROKEN.length)),
  say('m-shown-4', 'One more, the context menu on a file:'),
  call('show-live', [
    {
      kind: 'screens',
      steps: [{ after: 'shots/menu-after.png', caption: 'The file menu' }],
    },
  ]),
  LIVE,
]

/** What arrives once the last call goes through. */
export const SHOWN_LATER = [
  toolResult('show-live', ok(1)),
  say('m-shown-5', 'That is every menu. Tell me if one feels off.'),
  result(0.0312, 12_000),
]

export const SHOWN_CHAT = (now: number) => ({
  activeAt: now - 30_000,
  createdAt: now - 20 * 60_000,
  effort: 'high',
  id: 'chat-shown',
  model: 'opus',
  sessionId: 'session-shown',
  title: 'Show me the menu work',
  workspaceId: 'ws-amber',
})

export const SHOWN_HOSTED = {
  alive: true,
  historyLen: 0,
  id: 'chat-shown',
  unread: false,
  waiting: false,
  working: true,
}

/** `shown_image`, as the host answers it: only amber's screens, one slowly, one missing. */
export async function shownImage(cwd: string, path: string): Promise<string> {
  if (cwd !== PATHS.amber) throw new Error(`${cwd} is not a workspace`)
  if (path === 'shots/menu-before.png') return MENU_STEP.before
  if (path === 'shots/menu-after.png') return MENU_STEP.after
  if (path === 'shots/slow.png') {
    await new Promise((resolve) => setTimeout(resolve, 8000))
    return MENU_STEP.after
  }
  throw new Error(`image: no file at ${cwd}/${path} (take the screenshot first, or fix the path)`)
}

/** teal's page, made of the agent's own blocks (the host inlined the screens). */
export function blocksReport(now: number): Report {
  return {
    at: now - 4 * 60_000,
    chatId: 'chat-notes',
    sections: {
      left: ['Look at the tab menu on a trackpad', 'Merge #201'],
      plan: [
        {
          items: [{ setAside: 'Click, as before', text: 'Submenus open on hover, like macOS' }],
          kind: 'decisions',
        },
      ],
      progress: [
        { status: 'done', text: 'Menus' },
        { status: 'done', text: 'Checks' },
        { status: 'todo', text: 'PR' },
      ],
      result: [
        {
          kind: 'screens',
          steps: [{ after: MENU_STEP.after, before: MENU_STEP.before, caption: MENU_STEP.step }],
        },
        {
          items: [
            { status: 'done', text: 'Unit tests' },
            {
              detail: 'One pixel off in the sidebar menu; unrelated.',
              status: 'failed',
              text: 'Visual snapshots',
            },
            { status: 'skipped', text: 'The updater menu (no session in the preview)' },
          ],
          kind: 'steps',
          title: 'Checks',
        },
        {
          columns: ['Menu', 'Opens', 'Keyboard'],
          kind: 'table',
          rows: [
            ['Tab', 'Hover', '→ opens, ← closes'],
            ['Sidebar', 'Hover', '→ opens, ← closes'],
            ['File', 'Click', '↑ ↓ only'],
          ],
          title: 'Where each menu stands',
        },
        {
          kind: 'callout',
          text: 'A long submenu now closes when you scroll the page behind it.',
          tone: 'risk',
        },
        {
          kind: 'text',
          links: [{ label: 'Pull request #201', url: PR_STATES.passing }],
          paragraphs: ['The file menu keeps its click: it opens over a drag handle.'],
        },
      ],
      ticket: [
        {
          kind: 'text',
          links: [{ label: 'Ticket #335', url: 'https://github.com/nbardavid/logit/issues/335' }],
          paragraphs: ['Submenus do not open on hover.'],
        },
      ],
      understood: [
        {
          feature: 'Every right-click menu in the app: tabs, the sidebar, files.',
          kind: 'context',
          problem: 'You hover "Move to", nothing opens; you click, and the menu jumps.',
        },
      ],
    },
    state: 'review',
    summary: 'Menus open their submenus on hover and keep the hovered row.',
    ticket: '#335',
    title: 'Menus on Base UI',
    workspaceId: 'ws-teal',
  }
}
