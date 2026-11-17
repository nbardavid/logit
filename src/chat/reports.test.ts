import { expect, test } from 'bun:test'

import type { Block, Permission } from './model'

import { answersOf, REPORT_TOOL, reportAsk, reportedSince } from './reports'

const call = (id: string, name: string, result?: { text: string; isError: boolean }): Block => ({
  id,
  input: {},
  json: '',
  kind: 'tool',
  name,
  result,
})

test('a report call counts once its result is in, and only without error', () => {
  const asked = [call('a', REPORT_TOOL)]
  const done = [call('a', REPORT_TOOL, { isError: false, text: 'Report saved.' })]
  const failed = [call('a', REPORT_TOOL, { isError: true, text: 'Invalid state' })]
  expect(reportedSince([], asked)).toBe(false)
  expect(reportedSince(asked, done)).toBe(true)
  expect(reportedSince(asked, failed)).toBe(false)
})

test('a report already seen, or another tool, is not a new report', () => {
  const done = [call('a', REPORT_TOOL, { isError: false, text: 'ok' })]
  expect(reportedSince(done, done)).toBe(false)
  const other = [...done, call('b', 'mcp__logit__chat_read', { isError: false, text: 'ok' })]
  expect(reportedSince(done, other)).toBe(false)
  const second = [...done, call('c', REPORT_TOOL, { isError: false, text: 'ok' })]
  expect(reportedSince(done, second)).toBe(true)
})

const OPTIONS = [{ description: '', label: 'En base' }]
const QUESTIONS = [{ options: OPTIONS, question: 'Comment ?' }]
const askBlock = (id: string, result?: { text: string; isError: boolean }): Block => ({
  id,
  input: { questions: QUESTIONS },
  json: '',
  kind: 'tool',
  name: 'AskUserQuestion',
  result,
})
const permission = (toolUseId: string): Permission => ({
  description: null,
  input: { questions: QUESTIONS },
  requestId: 'perm-1',
  suggestions: [],
  toolName: 'AskUserQuestion',
  toolUseId,
})
const chat = (blocks: Block[], pending: Permission[] = []) => ({
  pending,
  turns: [{ blocks, id: 't', role: 'assistant' as const }],
})
const reported = call('r', REPORT_TOOL, { isError: false, text: 'Report saved.' })

test('answers read as Claude Code words them', () => {
  const text =
    'User has answered your questions: "Comment ?"="En base", "Et \\"ça\\" ?"="Oui". You can now continue.'
  expect(answersOf(text)).toEqual({ 'Comment ?': 'En base', 'Et \\"ça\\" ?': 'Oui' })
  expect(answersOf('nothing')).toEqual({})
})

test("a report's question waits while its permission is pending", () => {
  const ask = reportAsk(chat([reported, askBlock('q')], [permission('q')]))
  expect(ask.kind).toBe('pending')
  if (ask.kind === 'pending') expect(ask.requestId).toBe('perm-1')
})

test("a report's question is answered once its result is in", () => {
  const text = 'User has answered your questions: "Comment ?"="En base".'
  const ask = reportAsk(chat([reported, askBlock('q', { isError: false, text })]))
  expect(ask).toEqual({
    answers: { 'Comment ?': 'En base' },
    kind: 'answered',
    questions: [{ header: '', multiSelect: false, options: OPTIONS, question: 'Comment ?' }],
  })
})

test('nothing pending or answered since the report reads as unknown', () => {
  expect(reportAsk(undefined).kind).toBe('unknown')
  expect(reportAsk(chat([reported])).kind).toBe('unknown')
  // Asked before the report: not this report's question.
  expect(reportAsk(chat([askBlock('q'), reported], [permission('q')])).kind).toBe('unknown')
  // Refused, or with no result yet and nothing pending.
  expect(reportAsk(chat([reported, askBlock('q', { isError: true, text: 'no' })])).kind).toBe(
    'unknown'
  )
  expect(reportAsk(chat([reported, askBlock('q')])).kind).toBe('unknown')
})
