import { BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import katex from 'katex'
import MarkdownIt from 'markdown-it'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'

const md = new MarkdownIt({ html: true, linkify: true, typographer: false })

const mathHtml = (tex: string, displayMode: boolean) =>
  katex.renderToString(tex, { displayMode, throwOnError: false, output: 'htmlAndMathml' })

// 块级公式：独占行的 $$ ... $$（可多行，也可单行 $$ x $$）
md.block.ruler.before('fence', 'math_block', (state, start, end, silent) => {
  const first = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start])
  if (!first.startsWith('$$')) return false
  let body = first.slice(2)
  let line = start
  if (body.trimEnd().endsWith('$$')) {
    body = body.trimEnd().slice(0, -2)
  } else {
    const parts = [body]
    for (line = start + 1; line < end; line++) {
      const text = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line])
      if (text.trimEnd().endsWith('$$')) {
        parts.push(text.trimEnd().slice(0, -2))
        break
      }
      parts.push(text)
    }
    if (line >= end) return false
    body = parts.join('\n')
  }
  if (silent) return true
  const token = state.push('math_block', 'div', 0)
  token.content = body.trim()
  token.map = [start, line + 1]
  state.line = line + 1
  return true
})
md.renderer.rules.math_block = (tokens, i) => `<div class="math-block">${mathHtml(tokens[i].content, true)}</div>\n`

// 行内公式：$...$（首尾不能是空白，避免把“价格 $5 和 $6”误当公式）以及 \(...\)
md.inline.ruler.before('escape', 'math_inline', (state, silent) => {
  const src = state.src
  const pos = state.pos
  let open = ''
  let close = ''
  if (src.startsWith('\\(', pos)) [open, close] = ['\\(', '\\)']
  else if (src[pos] === '$' && src[pos + 1] !== '$') [open, close] = ['$', '$']
  else return false
  let end = pos + open.length
  while (end < src.length) {
    if (src[end] === '\\' && close === '$') end += 2
    else if (src.startsWith(close, end)) break
    else end++
  }
  if (end >= src.length) return false
  const tex = src.slice(pos + open.length, end)
  if (!tex || (open === '$' && (/^\s|\s$/.test(tex) || /\d/.test(src[end + 1] ?? '')))) return false
  if (!silent) state.push('math_inline', 'span', 0).content = tex
  state.pos = end + close.length
  return true
})
md.renderer.rules.math_inline = (tokens, i) => mathHtml(tokens[i].content, false)

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

let katexCss: string | null = null

/** KaTeX 样式，字体内联成 data URI，使导出的 HTML 单文件可独立打开 */
async function loadKatexCss(): Promise<string> {
  if (katexCss !== null) return katexCss
  const cssPath = require.resolve('katex/dist/katex.min.css')
  const raw = await fs.readFile(cssPath, 'utf8')
  const dir = path.dirname(cssPath)
  const fonts = new Map<string, string>()
  for (const m of raw.matchAll(/url\((fonts\/[^)]+\.woff2)\)/g)) {
    if (!fonts.has(m[1])) fonts.set(m[1], (await fs.readFile(path.join(dir, m[1]))).toString('base64'))
  }
  katexCss = raw
    .replace(/url\((fonts\/[^)]+\.woff2)\)/g, (_m, f) => `url(data:font/woff2;base64,${fonts.get(f)})`)
    .replace(/,\s*url\(fonts\/[^)]+\.(woff|ttf)\)\s*format\([^)]*\)/g, '')
  return katexCss
}

const slug = (text: string) =>
  text.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'section'

interface Heading {
  level: number
  text: string
  id: string
}

/** 渲染正文，同时给标题加上 id 并收集目录 */
function renderBody(markdown: string): { html: string; headings: Heading[] } {
  const tokens = md.parse(markdown, {})
  const headings: Heading[] = []
  const used = new Map<string, number>()
  tokens.forEach((t, i) => {
    if (t.type !== 'heading_open') return
    const text = tokens[i + 1].children?.map((c) => c.content).join('') ?? ''
    const base = slug(text)
    const n = used.get(base) ?? 0
    used.set(base, n + 1)
    const id = n ? `${base}-${n}` : base
    t.attrSet('id', id)
    headings.push({ level: Number(t.tag.slice(1)), text, id })
  })
  return { html: md.renderer.render(tokens, md.options, {}), headings }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const NAV_CSS = `
#toc{position:fixed;top:0;left:0;bottom:0;width:260px;overflow:auto;padding:16px 12px;box-sizing:border-box;border-right:1px solid #d8dee4;background:#f6f8fa;font-size:14px;line-height:1.5}
#toc a{display:block;color:#24292f;text-decoration:none;padding:2px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#toc a:hover{color:#0969da}
body.has-toc{margin:0;max-width:none;padding:0 24px 40px 284px}
body.has-toc main{max-width:820px;margin:40px auto}
@media print{#toc{display:none}body.has-toc{padding:0}body.has-toc main{margin:0;max-width:none}}
`

export async function renderHtml(
  markdown: string,
  title: string,
  baseDir?: string,
  opts: { toc?: boolean } = {},
): Promise<string> {
  const base = baseDir ? `<base href="${pathToFileURL(baseDir).toString()}/">` : ''
  const { html, headings } = renderBody(markdown)
  const toc = opts.toc !== false && headings.length > 0
  const minLevel = Math.min(...headings.map((h) => h.level))
  const nav = toc
    ? `<nav id="toc">${headings
        .map((h) => `<a href="#${h.id}" style="padding-left:${(h.level - minLevel) * 14}px">${esc(h.text)}</a>`)
        .join('')}</nav>`
    : ''
  return `<!doctype html><html><head><meta charset="utf-8">${base}<title>${esc(title)}</title><style>${await loadKatexCss()}${CSS}${NAV_CSS}</style></head><body${toc ? ' class="has-toc"' : ''}>${nav}<main>${html}</main></body></html>`
}

export async function renderPdf(markdown: string, title: string, baseDir?: string): Promise<Buffer> {
  const tmp = path.join(os.tmpdir(), `itypora-${Date.now()}.html`)
  await fs.writeFile(tmp, await renderHtml(markdown, title, baseDir, { toc: false }), 'utf8')
  const win = new BrowserWindow({ show: false })
  try {
    await win.loadFile(tmp)
    return await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', generateDocumentOutline: true })
  } finally {
    win.destroy()
    fs.unlink(tmp).catch(() => {})
  }
}
