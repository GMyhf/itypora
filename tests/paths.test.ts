import { describe, expect, it } from 'vitest'
import { assetsDirName, docBaseUrl, findTempImages, relativeAssetRef } from '../src/main/paths'

describe('paths', () => {
  it('assets 目录名', () => {
    expect(assetsDirName('/a/b/笔记.md')).toBe('笔记.assets')
  })
  it('相对引用做 URL 编码', () => {
    expect(relativeAssetRef('/a/my note.md', 'x y.png')).toBe('my%20note.assets/x%20y.png')
  })
  it('文档目录 URL 以斜杠结尾', () => {
    expect(docBaseUrl('/a/b c/doc.md')).toBe('file:///a/b%20c/')
  })
  it('找出临时图片引用', () => {
    const md = '![a](file:///tmp/img/1.png) 与 ![b](file:///tmp/img/2.png "t") 以及 ![c](https://x/y.png)'
    expect(findTempImages(md, '/tmp/img')).toEqual(['file:///tmp/img/1.png', 'file:///tmp/img/2.png'])
  })
})
