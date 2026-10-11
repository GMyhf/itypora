import { Crepe } from '@milkdown/crepe'
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import {
  createCodeBlockCommand,
  insertHrCommand,
  insertImageCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark'
import { insertTableCommand, toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Node as PMNode } from '@milkdown/kit/prose/model'
import { findPlugin, focusPlugin, imagePastePlugin } from './plugins'

export interface EditorHooks {
  /** 内容有变化（用户编辑，不含程序性载入） */
  onChange(): void
  onSelection(): void
  /** 把图片文件落盘，返回写进 Markdown 的引用 */
  upload(file: File): Promise<string>
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' }
export const extOf = (f: File) => EXT[f.type] ?? (f.type.split('/')[1] || 'png')

/** 命令名（菜单发来的）-> 具体的 Milkdown 命令 */
const COMMANDS: Record<string, [any, ((arg: any) => unknown)?]> = {
  bold: [toggleStrongCommand],
  italic: [toggleEmphasisCommand],
  'inline-code': [toggleInlineCodeCommand],
  strike: [toggleStrikethroughCommand],
  heading: [wrapInHeadingCommand, (n) => n],
  paragraph: [turnIntoTextCommand],
  blockquote: [wrapInBlockquoteCommand],
  'ordered-list': [wrapInOrderedListCommand],
  'bullet-list': [wrapInBulletListCommand],
  'code-block': [createCodeBlockCommand],
  table: [insertTableCommand, () => ({ row: 3, col: 3 })],
  hr: [insertHrCommand],
}

export class Editor {
  private crepe: Crepe | null = null
  private ready = false
  /** 相对图片路径的解析基准（当前文档所在目录的 file URL） */
  baseUrl: string | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private root: string,
    private hooks: EditorHooks,
  ) {}

  /** 载入一份 Markdown（替换整个编辑器）。串行执行，避免连续打开文件时互相踩踏。 */
  load(markdown: string): Promise<void> {
    const run = async () => {
      this.ready = false
      await this.crepe?.destroy()
      document.querySelector(this.root)!.innerHTML = ''
      const resolve = (url: string) =>
        this.baseUrl && !/^[a-z][a-z0-9+.-]*:/i.test(url) ? new URL(url, this.baseUrl).href : url
      const crepe = new Crepe({
        root: this.root,
        defaultValue: markdown,
        featureConfigs: {
          [Crepe.Feature.ImageBlock]: {
            onUpload: (f) => this.hooks.upload(f),
            inlineOnUpload: (f) => this.hooks.upload(f),
            blockOnUpload: (f) => this.hooks.upload(f),
            proxyDomURL: resolve,
          },
        },
      })
      crepe.editor
        .use(findPlugin)
        .use(focusPlugin)
        .use(imagePastePlugin((f) => this.hooks.upload(f), (src) => this.insertImage(src)))
      crepe.on((l) => {
        l.markdownUpdated(() => this.ready && this.hooks.onChange())
        l.selectionUpdated(() => this.ready && this.hooks.onSelection())
      })
      await crepe.create()
      this.crepe = crepe
      this.ready = true
    }
    this.queue = this.queue.then(run, run)
    return this.queue as Promise<void>
  }

  markdown(): string {
    return this.crepe?.getMarkdown() ?? ''
  }

  get view(): EditorView | null {
    return this.crepe ? this.crepe.editor.action((ctx) => ctx.get(editorViewCtx)) : null
  }

  get doc(): PMNode | null {
    return this.view?.state.doc ?? null
  }

  selectedText(): string {
    const v = this.view
    if (!v) return ''
    const { from, to } = v.state.selection
    return from === to ? '' : v.state.doc.textBetween(from, to, '\n')
  }

  fullText(): string {
    return this.doc?.textBetween(0, this.doc.content.size, '\n') ?? ''
  }

  focus() {
    this.view?.focus()
  }

  insertImage(src: string) {
    this.crepe?.editor.action((ctx) => ctx.get(commandsCtx).call(insertImageCommand.key, { src, alt: '' }))
  }

  /** 执行菜单命令。返回 false 表示不是编辑器命令。 */
  run(name: string, arg?: unknown): boolean {
    if (name === 'link') {
      this.crepe?.editor.action((ctx) => ctx.get(commandsCtx).call(toggleLinkCommand.key, { href: '' }))
      return true
    }
    const entry = COMMANDS[name]
    if (!entry || !this.crepe) return false
    const [cmd, payload] = entry
    this.view?.focus()
    this.crepe.editor.action((ctx) => ctx.get(commandsCtx).call(cmd.key, payload?.(arg)))
    return true
  }
}
