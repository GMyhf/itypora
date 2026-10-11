import { describe, expect, it } from 'vitest'
import { extractOutline } from '../src/renderer/outline'

const node = (name: string, text: string, level?: number) => ({
  type: { name },
  attrs: { level },
  textContent: text,
})
const doc = (nodes: ReturnType<typeof node>[]) => ({
  forEach(cb: (n: ReturnType<typeof node>, offset: number) => void) {
    let off = 0
    for (const n of nodes) {
      cb(n, off)
      off += n.textContent.length + 2
    }
  },
})

describe('extractOutline', () => {
  it('只取非空标题并带上位置', () => {
    const items = extractOutline(doc([node('heading', '标题', 1), node('paragraph', '正文'), node('heading', '  ', 2), node('heading', '小节', 2)]))
    expect(items.map((i) => [i.level, i.text])).toEqual([
      [1, '标题'],
      [2, '小节'],
    ])
    expect(items[0].pos).toBe(0)
    expect(items[1].pos).toBeGreaterThan(0)
  })
})
