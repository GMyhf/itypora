// Mermaid 图表：编辑器内代码块预览、导出时预先渲染成 SVG。
// mermaid 体积较大，按需动态加载，没用到图表的文档不受影响。

type Mermaid = typeof import('mermaid').default

let loading: Promise<Mermaid> | null = null
let currentTheme = ''
let seq = 0
/** 同一段代码在同一主题下只渲染一次 */
const cache = new Map<string, string>()

function load(): Promise<Mermaid> {
  loading ??= import('mermaid').then((m) => m.default)
  return loading
}

/** 渲染成 SVG 字符串；语法错误时抛出 */
export async function renderMermaid(code: string, dark: boolean): Promise<string> {
  const theme = dark ? 'dark' : 'default'
  const key = `${theme}\n${code}`
  const hit = cache.get(key)
  if (hit) return hit
  const mermaid = await load()
  if (theme !== currentTheme) {
    mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict', fontFamily: 'inherit' })
    currentTheme = theme
  }
  const { svg } = await mermaid.render(`itypora-mermaid-${++seq}`, code)
  if (cache.size > 200) cache.clear()
  cache.set(key, svg)
  return svg
}

const FENCE = /^(`{3,}|~{3,})[ \t]*mermaid[ \t]*\n([\s\S]*?)\n\1[ \t]*$/gm

/** 导出、演示用：把文档里所有 mermaid 代码块渲染成 SVG，返回 代码 -> SVG 的映射（出错的跳过） */
export async function renderAllMermaid(markdown: string, dark = false): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const m of markdown.matchAll(FENCE)) {
    const code = m[2]
    if (code in out) continue
    try {
      out[code] = await renderMermaid(code, dark)
    } catch {
      // 语法有误的图保留为代码块
    }
  }
  return out
}
