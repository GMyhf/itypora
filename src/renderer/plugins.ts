import { $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, EditorView } from '@milkdown/kit/prose/view'
import type { Node as PMNode } from '@milkdown/kit/prose/model'

// ---------- 查找替换 ----------

interface Match {
  from: number
  to: number
}
interface FindState {
  query: string
  current: number
  matches: Match[]
}

const findKey = new PluginKey<FindState>('itypora-find')

function computeMatches(doc: PMNode, query: string): Match[] {
  const out: Match[] = []
  if (!query) return out
  const q = query.toLowerCase()
  doc.descendants((node, pos) => {
    if (!node.isText) return
    const t = node.text!.toLowerCase()
    for (let i = t.indexOf(q); i !== -1; i = t.indexOf(q, i + q.length)) {
      out.push({ from: pos + i, to: pos + i + q.length })
    }
  })
  return out
}

export const findPlugin = $prose(
  () =>
    new Plugin<FindState>({
      key: findKey,
      state: {
        init: () => ({ query: '', current: 0, matches: [] }),
        apply(tr, prev) {
          const meta = tr.getMeta(findKey) as Partial<FindState> | undefined
          if (!meta && !tr.docChanged) return prev
          const query = meta?.query ?? prev.query
          const matches = computeMatches(tr.doc, query)
          const wanted = meta?.current ?? prev.current
          const current = matches.length ? ((wanted % matches.length) + matches.length) % matches.length : 0
          return { query, matches, current }
        },
      },
      props: {
        decorations(state) {
          const s = findKey.getState(state)
          if (!s?.matches.length) return null
          return DecorationSet.create(
            state.doc,
            s.matches.map((m, i) =>
              Decoration.inline(m.from, m.to, { class: i === s.current ? 'find-match find-current' : 'find-match' }),
            ),
          )
        },
      },
    }),
)

export const finder = {
  state: (view: EditorView) => findKey.getState(view.state)!,
  search(view: EditorView, query: string, current = 0) {
    view.dispatch(view.state.tr.setMeta(findKey, { query, current }))
    this.reveal(view)
  },
  step(view: EditorView, delta: number) {
    const s = this.state(view)
    if (!s.matches.length) return
    view.dispatch(view.state.tr.setMeta(findKey, { current: s.current + delta }))
    this.reveal(view)
  },
  reveal(view: EditorView) {
    const s = this.state(view)
    const m = s.matches[s.current]
    if (!m) return
    const { node } = view.domAtPos(m.from)
    const el = node.nodeType === 3 ? node.parentElement : (node as HTMLElement)
    el?.scrollIntoView({ block: 'center' })
  },
  replaceCurrent(view: EditorView, text: string) {
    const s = this.state(view)
    const m = s.matches[s.current]
    if (!m) return
    view.dispatch(view.state.tr.insertText(text, m.from, m.to))
    this.reveal(view)
  },
  replaceAll(view: EditorView, text: string) {
    const s = this.state(view)
    if (!s.matches.length) return
    const tr = view.state.tr
    // 从后往前替换，前面的位置不会被打乱
    for (const m of [...s.matches].reverse()) tr.insertText(text, m.from, m.to)
    view.dispatch(tr)
  },
}

// ---------- 专注 / 打字机模式 ----------

export const viewModes = { typewriter: false, scroller: null as HTMLElement | null }

export const focusPlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey('itypora-focus'),
      props: {
        decorations(state) {
          const { $from } = state.selection
          if ($from.depth < 1) return null
          const start = $from.before(1)
          return DecorationSet.create(state.doc, [
            Decoration.node(start, start + $from.node(1).nodeSize, { class: 'is-focused' }),
          ])
        },
      },
      view: () => ({
        update(view, prev) {
          const sc = viewModes.scroller
          if (!viewModes.typewriter || !sc || !view.hasFocus()) return
          if (view.state.selection.eq(prev.selection) && view.state.doc.eq(prev.doc)) return
          const caret = view.coordsAtPos(view.state.selection.head)
          const box = sc.getBoundingClientRect()
          const delta = caret.top - (box.top + box.height / 2)
          if (Math.abs(delta) > 24) sc.scrollTo({ top: sc.scrollTop + delta })
        },
      }),
    }),
)

// ---------- 粘贴 / 拖入图片 ----------

export function imagePastePlugin(upload: (file: File) => Promise<string>, insert: (src: string) => void) {
  const handle = (files: FileList | null | undefined, event: Event) => {
    const images = [...(files ?? [])].filter((f) => f.type.startsWith('image/'))
    if (!images.length) return false
    event.preventDefault()
    ;(async () => {
      for (const f of images) insert(await upload(f))
    })()
    return true
  }
  return $prose(
    () =>
      new Plugin({
        key: new PluginKey('itypora-image-paste'),
        props: {
          handlePaste: (_v, e) => handle(e.clipboardData?.files, e),
          handleDrop: (_v, e) => handle((e as DragEvent).dataTransfer?.files, e),
        },
      }),
  )
}
