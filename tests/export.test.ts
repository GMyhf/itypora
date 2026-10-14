import { describe, expect, it } from 'vitest'
import { headerFooterHtml, renderBody } from '../src/main/export'

describe('headerFooterHtml', () => {
  it('不含 | 时居中，并替换页码占位符', () => {
    const h = headerFooterHtml('{title} 第 {page}/{total} 页', '讲义<1>', 's')
    expect(h).toContain('text-align:center')
    expect(h).toContain('讲义&lt;1&gt;')
    expect(h).toContain('<span class="pageNumber"></span>/<span class="totalPages"></span>')
  })

  it('用 | 分成左中右三栏', () => {
    const h = headerFooterHtml('左 | 中 | 右', 't', 's')
    expect(h).toMatch(/text-align:left">左<.*text-align:center">中<.*text-align:right">右</)
  })
})

describe('renderBody', () => {
  it('mermaid 代码块替换成预先渲染的 SVG，没有 SVG 时保留代码块', () => {
    const md = '```mermaid\ngraph TD; A-->B\n```\n'
    expect(renderBody(md, { 'graph TD; A-->B': '<svg id="x"></svg>' }).html).toContain('<div class="mermaid"><svg id="x"></svg></div>')
    expect(renderBody(md).html).toContain('<pre><code class="language-mermaid">')
  })
})
