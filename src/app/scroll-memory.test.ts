import { expect, test } from 'bun:test'

import type { Turn } from '../chat/model'

import { newLabel, spokenCount } from './scroll-memory'

test('what Claude wrote counts its text blocks, not prompts or tools', () => {
  const turns = [
    { blocks: [{ kind: 'text', text: 'hi' }], id: 'u1', role: 'user' },
    {
      blocks: [
        { kind: 'text', text: 'One' },
        { id: 't', input: {}, kind: 'tool', name: 'Bash' },
        { kind: 'text', text: 'Two' },
      ],
      id: 'a1',
      role: 'assistant',
    },
  ] as unknown as Turn[]
  expect(spokenCount(turns)).toBe(2)
  expect(spokenCount([])).toBe(0)
})

test('the pill says how many came in', () => {
  expect(newLabel(1)).toBe('1 new')
  expect(newLabel(12)).toBe('12 new')
})
