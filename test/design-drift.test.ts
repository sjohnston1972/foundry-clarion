import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

// The sibling isn't guaranteed to be on disk (e.g. CI), so this suite skips
// cleanly rather than failing — see CLAUDE.md §14.
const SIBLING_ROOT = path.resolve(__dirname, '../../skills-foundry')
const siblingExists = existsSync(SIBLING_ROOT)
const maybeIt = siblingExists ? it : it.skip

const OURS_CSS = path.resolve(__dirname, '../src/index.css')
const THEIRS_CSS = path.join(SIBLING_ROOT, 'src/index.css')
const OURS_UI = path.resolve(__dirname, '../src/components/ui.tsx')
const THEIRS_UI = path.join(SIBLING_ROOT, 'src/components/ui.tsx')
const OURS_UTILS = path.resolve(__dirname, '../src/lib/utils.ts')
const THEIRS_UTILS = path.join(SIBLING_ROOT, 'src/lib/utils.ts')

// Line endings are a checkout artifact (the sibling may be checked out CRLF), not
// design drift — normalize before comparing content.
function norm(s: string): string {
  return s.replace(/\r\n/g, '\n')
}

function extractBlock(css: string, selector: RegExp): string {
  const m = norm(css).match(selector)
  if (!m) throw new Error(`block not found for ${selector}`)
  return m[0].trim()
}

describe('design-system drift (vendored from skills-foundry — CLAUDE.md §14)', () => {
  maybeIt('src/index.css: @theme block matches the sibling verbatim', () => {
    const ours = readFileSync(OURS_CSS, 'utf8')
    const theirs = readFileSync(THEIRS_CSS, 'utf8')
    expect(extractBlock(ours, /@theme\s*\{[\s\S]*?\n\}/)).toBe(extractBlock(theirs, /@theme\s*\{[\s\S]*?\n\}/))
  })

  maybeIt('src/index.css: :root accent vars match the sibling verbatim', () => {
    const ours = readFileSync(OURS_CSS, 'utf8')
    const theirs = readFileSync(THEIRS_CSS, 'utf8')
    expect(extractBlock(ours, /:root\s*\{[\s\S]*?\n\}/)).toBe(extractBlock(theirs, /:root\s*\{[\s\S]*?\n\}/))
  })

  maybeIt('src/index.css: .tabular and the scrollbar rules are present verbatim', () => {
    const ours = norm(readFileSync(OURS_CSS, 'utf8'))
    const theirs = readFileSync(THEIRS_CSS, 'utf8')
    expect(ours).toContain(extractBlock(theirs, /\.tabular\s*\{[\s\S]*?\n\}/))
    const scrollbarBlocks = [...norm(theirs).matchAll(/::-webkit-scrollbar[a-z:-]*\s*\{[\s\S]*?\n\}/g)].map((m) => m[0].trim())
    expect(scrollbarBlocks.length).toBeGreaterThanOrEqual(3)
    for (const block of scrollbarBlocks) expect(ours).toContain(block)
  })

  maybeIt('src/components/ui.tsx matches the sibling verbatim (after the provenance header)', () => {
    const ours = norm(readFileSync(OURS_UI, 'utf8'))
    const theirs = norm(readFileSync(THEIRS_UI, 'utf8'))
    const marker = '// --- vendored verbatim below ---'
    const idx = ours.indexOf(marker)
    expect(idx).toBeGreaterThan(-1)
    expect(ours.slice(idx + marker.length).trim()).toBe(theirs.trim())
  })

  maybeIt('src/lib/utils.ts matches the sibling verbatim (after the provenance comment)', () => {
    const ours = norm(readFileSync(OURS_UTILS, 'utf8'))
    const theirs = norm(readFileSync(THEIRS_UTILS, 'utf8'))
    const oursBody = ours.split('\n').filter((l) => !l.startsWith('// Vendored')).join('\n').trim()
    expect(oursBody).toBe(theirs.trim())
  })
})
