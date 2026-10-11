import type { OutlineItem } from './outline'

export interface SidebarHooks {
  jump(pos: number): void
  askName(title: string, value: string): Promise<string | null>
  currentPath(): string | null
}

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const dirname = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/'

export class Sidebar {
  private el = document.getElementById('sidebar')!
  private outlineEl = document.getElementById('outline')!
  private filesEl = document.getElementById('files')!
  private expanded = new Set<string>()
  private folder: string | null = null

  constructor(private hooks: SidebarHooks, private onTab: (tab: 'outline' | 'files') => void) {
    this.el.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) =>
      b.addEventListener('click', () => this.showTab(b.dataset.tab as 'outline' | 'files', true)),
    )
  }

  showTab(tab: 'outline' | 'files', notify = false) {
    this.el.dataset.tab = tab
    this.el.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.tab === tab))
    if (notify) this.onTab(tab)
  }

  setOutline(items: OutlineItem[]) {
    this.outlineEl.replaceChildren()
    if (!items.length) {
      this.outlineEl.append(this.hint('还没有标题'))
      return
    }
    const min = Math.min(...items.map((i) => i.level))
    for (const it of items) {
      const row = document.createElement('div')
      row.className = 'row outline-row'
      row.style.paddingLeft = `${10 + (it.level - min) * 14}px`
      row.textContent = it.text
      row.title = it.text
      row.addEventListener('click', () => this.hooks.jump(it.pos))
      this.outlineEl.append(row)
    }
  }

  async setFolder(folder: string | null) {
    this.folder = folder
    await this.refreshFiles()
  }

  /** 当前打开的文件变了：只更新高亮 */
  markCurrent() {
    const cur = this.hooks.currentPath()
    this.filesEl.querySelectorAll<HTMLElement>('.file-row').forEach((r) => r.classList.toggle('current', r.dataset.path === cur))
  }

  async refreshFiles() {
    this.filesEl.replaceChildren()
    if (!this.folder) {
      this.filesEl.append(this.hint('通过“文件 ▸ 打开文件夹…”选择一个目录'))
      return
    }
    const title = document.createElement('div')
    title.className = 'folder-title'
    title.textContent = basename(this.folder)
    title.title = this.folder
    this.filesEl.append(title)
    await this.renderDir(this.filesEl, this.folder, 0)
    this.markCurrent()
  }

  private hint(text: string) {
    const d = document.createElement('div')
    d.className = 'hint'
    d.textContent = text
    return d
  }

  private async renderDir(into: HTMLElement, dir: string, depth: number) {
    const entries = await window.api.readDir(dir)
    for (const e of entries) {
      const row = document.createElement('div')
      row.className = 'row file-row'
      row.dataset.path = e.path
      row.style.paddingLeft = `${10 + depth * 14}px`
      const open = this.expanded.has(e.path)
      row.textContent = (e.isDir ? (open ? '▾ ' : '▸ ') : '· ') + e.name
      row.title = e.path
      into.append(row)

      row.addEventListener('click', async () => {
        if (!e.isDir) return window.api.openPath(e.path)
        if (this.expanded.has(e.path)) this.expanded.delete(e.path)
        else this.expanded.add(e.path)
        await this.refreshFiles()
      })
      row.addEventListener('contextmenu', (ev) => {
        ev.preventDefault()
        this.contextMenu(e.path, e.isDir)
      })
      if (e.isDir && open) await this.renderDir(into, e.path, depth + 1)
    }
  }

  private async contextMenu(file: string, isDir: boolean) {
    const action = await window.api.treeMenu(file, isDir)
    if (action === 'create') {
      const dir = isDir ? file : dirname(file)
      const name = await this.hooks.askName('新建文件', 'untitled')
      if (!name) return
      const created = await window.api.fsCreate(dir, name)
      if (isDir) this.expanded.add(file)
      await this.refreshFiles()
      if (created) await window.api.openPath(created)
    } else if (action === 'rename') {
      const name = await this.hooks.askName('重命名', basename(file))
      if (name && name !== basename(file)) {
        await window.api.fsRename(file, name)
        await this.refreshFiles()
      }
    } else if (action === 'trash') {
      if (confirm(`将“${basename(file)}”移到废纸篓？`)) {
        await window.api.fsTrash(file)
        await this.refreshFiles()
      }
    }
  }
}
