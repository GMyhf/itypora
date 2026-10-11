import path from 'path'
import { pathToFileURL } from 'url'

/** 文档对应的图片目录名：foo.md -> foo.assets */
export function assetsDirName(docPath: string): string {
  return path.basename(docPath, path.extname(docPath)) + '.assets'
}

/** 写入 Markdown 的图片相对路径（URL 编码，使用 / 分隔） */
export function relativeAssetRef(docPath: string, fileName: string): string {
  return `${encodeURIComponent(assetsDirName(docPath))}/${encodeURIComponent(fileName)}`
}

/** 文档所在目录的 file URL（带结尾斜杠），渲染进程用它解析相对图片路径 */
export function docBaseUrl(docPath: string): string {
  return pathToFileURL(path.dirname(docPath)).toString() + '/'
}

/** 未命名文档粘贴的图片先落在临时目录，保存时需要迁移。返回其中引用到的临时文件路径。 */
export function findTempImages(markdown: string, tmpDir: string): string[] {
  const prefix = pathToFileURL(tmpDir).toString() + '/'
  const found = new Set<string>()
  let i = markdown.indexOf(prefix)
  while (i !== -1) {
    let j = i + prefix.length
    while (j < markdown.length && !/[\s)"'>]/.test(markdown[j])) j++
    found.add(markdown.slice(i, j))
    i = markdown.indexOf(prefix, j)
  }
  return [...found]
}
