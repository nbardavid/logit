import { expect, test } from 'bun:test'

import { previewDocument } from './html-preview'

test('the preview runs no script and fetches nothing but styles, pictures and fonts', () => {
  const doc = previewDocument('<p>Hi</p>')
  expect(doc).toContain("default-src 'none'")
  expect(doc).not.toContain('script-src')
  expect(doc.endsWith('<p>Hi</p>')).toBe(true)
})
