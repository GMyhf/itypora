import { BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import MarkdownIt from 'markdown-it'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'

const md = new MarkdownIt({ html: true, linkify: true, typographer: false })

const CSS = `
body{font:16px/1.7 -apple-system,BlinkMacSystemFont,'PingFang SC','Helvetica Neue',sans-serif;color:#24292f;max-width:820px;margin:40px auto;padding:0 24px}
h1,h2{border-bottom:1px solid #d8dee4;padding-bottom:.3em}
code{background:#f3f4f6;padding:.15em .35em;border-radius:4px;font-family:Menlo,Monaco,monospace;font-size:.9em}
pre{background:#f6f8fa;padding:14px 16px;border-radius:6px;overflow:auto}pre code{background:none;padding:0}
blockquote{margin:0;padding:0 1em;color:#57606a;border-left:4px solid #d0d7de}
table{border-collapse:collapse}th,td{border:1px solid #d0d7de;padding:6px 13px}
img{max-width:100%}hr{border:0;border-top:1px solid #d0d7de}
@media print{body{margin:0;max-width:none}}
`

export function renderHtml(markdown: string, title: string, baseDir?: string): string {
  const base = baseDir ? `<base href="${pathToFileURL(baseDir).toString()}/">` : ''
  const esc = title.replace(/</g, '&lt;')
  return `<!doctype html><html><head><meta charset="utf-8">${base}<title>${esc}</title><style>${CSS}</style></head><body>${md.render(markdown)}</body></html>`
}

export async function renderPdf(markdown: string, title: string, baseDir?: string): Promise<Buffer> {
  const tmp = path.join(os.tmpdir(), `itypora-${Date.now()}.html`)
  await fs.writeFile(tmp, renderHtml(markdown, title, baseDir), 'utf8')
  const win = new BrowserWindow({ show: false })
  try {
    await win.loadFile(tmp)
    return await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
  } finally {
    win.destroy()
    fs.unlink(tmp).catch(() => {})
  }
}
