import { describe, expect, it } from 'vitest'
import { parseFrontMatter, splitSlides } from '../src/main/slides'

describe('splitSlides', () => {
  it('按 --- 分页，并读取 Marp 的 Front Matter', () => {
    const d = splitSlides('---\nmarp: true\nsize: 4:3\npaginate: false\nfooter: "第一讲"\n---\n\n# 封面\n\n---\n\n## 第二页\n\n内容')
    expect(d.pages).toHaveLength(2)
    expect(d.pages[0].trim()).toBe('# 封面')
    expect(d.size).toBe('4:3')
    expect(d.paginate).toBe(false)
    expect(d.footer).toBe('第一讲')
  })

  it('代码块里的 --- 和 Setext 标题下划线不分页', () => {
    const d = splitSlides('标题\n---\n\n```yaml\n---\na: 1\n```\n\n---\n\n下一页')
    expect(d.pages).toHaveLength(2)
    expect(d.pages[0]).toContain('a: 1')
  })

  it('没有 --- 时按一、二级标题分页', () => {
    const d = splitSlides('# 课程\n\n简介\n\n## 第一节\n\n### 小点\n\n```\n# 不是标题\n```\n\n## 第二节')
    expect(d.pages.map((p) => p.split('\n')[0])).toEqual(['# 课程', '## 第一节', '## 第二节'])
    expect(d.paginate).toBe(true)
  })

  it('没有 Front Matter 时原样返回正文', () => {
    expect(parseFrontMatter('# hi\n---\n').meta).toEqual({})
  })
})
