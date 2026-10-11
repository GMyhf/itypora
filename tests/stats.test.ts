import { describe, expect, it } from 'vitest'
import { countStats } from '../src/renderer/stats'

describe('countStats', () => {
  it('空文本', () => {
    expect(countStats('')).toEqual({ words: 0, chars: 0, minutes: 0 })
  })
  it('中文每字算一词', () => {
    expect(countStats('你好，世界').words).toBe(4)
  })
  it('英文按空白分词，标点不算词', () => {
    expect(countStats('Hello  world — ok').words).toBe(3)
  })
  it('中英混排', () => {
    expect(countStats('用 Markdown 写作').words).toBe(4)
  })
  it('字符数忽略空白', () => {
    expect(countStats('a b\nc').chars).toBe(3)
  })
})
