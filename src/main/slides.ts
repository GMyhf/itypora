// 演示模式：把 Markdown 切成幻灯片。兼容 Marp 的写法：
// 开头的 YAML Front Matter（marp、size、paginate、header、footer），以及独占一行的 --- 分页。
// 没有 --- 分页时，按一级、二级标题自动分页，普通笔记也能直接放映。

export interface SlideDeck {
  /** 每页的 Markdown */
  pages: string[]
  /** 宽高比，如 16:9、4:3 */
  size: '16:9' | '4:3'
  paginate: boolean
  header: string
  footer: string
}

const unquote = (v: string) => v.trim().replace(/^(['"])(.*)\1$/, '$2')

/** 解析开头的 Front Matter，只取简单的 key: value */
export function parseFrontMatter(markdown: string): { meta: Record<string, string>; body: string } {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown)
  if (!m) return { meta: {}, body: markdown }
  const meta: Record<string, string> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (kv) meta[kv[1]] = unquote(kv[2])
  }
  return { meta, body: markdown.slice(m[0].length) }
}

/** 按独占一行的 ---（前面是空行或文首，避免误伤 Setext 二级标题）分页，代码块里的不算 */
function splitByRule(body: string): string[] {
  const pages: string[] = []
  let cur: string[] = []
  let fence: string | null = null
  for (const line of body.split(/\r?\n/)) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line)
    if (f) {
      if (!fence) fence = f[1][0]
      else if (f[1][0] === fence) fence = null
    }
    const prevBlank = !cur.length || !cur[cur.length - 1].trim()
    if (!fence && /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line) && prevBlank) {
      pages.push(cur.join('\n'))
      cur = []
    } else cur.push(line)
  }
  pages.push(cur.join('\n'))
  return pages
}

/** 在每个一级/二级标题前分页 */
function splitByHeading(body: string): string[] {
  const pages: string[] = []
  let cur: string[] = []
  let fence: string | null = null
  for (const line of body.split(/\r?\n/)) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line)
    if (f) {
      if (!fence) fence = f[1][0]
      else if (f[1][0] === fence) fence = null
    }
    if (!fence && /^#{1,2}\s/.test(line) && cur.some((l) => l.trim())) {
      pages.push(cur.join('\n'))
      cur = []
    }
    cur.push(line)
  }
  pages.push(cur.join('\n'))
  return pages
}

export function splitSlides(markdown: string): SlideDeck {
  const { meta, body } = parseFrontMatter(markdown)
  let pages = splitByRule(body)
  if (pages.length === 1) pages = splitByHeading(body)
  pages = pages.filter((p) => p.trim())
  return {
    pages: pages.length ? pages : [''],
    size: meta.size === '4:3' ? '4:3' : '16:9',
    paginate: meta.paginate ? meta.paginate !== 'false' : true,
    header: meta.header ?? '',
    footer: meta.footer ?? '',
  }
}
