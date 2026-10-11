import { app, BrowserWindow, dialog, ipcMain, Menu, MenuItemConstructorOptions, nativeTheme, session, shell } from 'electron'
import { promises as fs, watch, FSWatcher } from 'fs'
import { randomUUID } from 'crypto'
import path from 'path'
import { fileURLToPath } from 'url'
import { renderDocx, renderHtml, renderPdf } from './export'
import { assetsDirName, docBaseUrl, findTempImages, relativeAssetRef } from './paths'
import { uploadBytes, uploadEnabled, uploadLocalImages } from './uploader'
import { getSettings, loadSettings, patchSettings, Settings } from './settings'

interface DocInit {
  path?: string
  content?: string
  dirty?: boolean
}

interface Doc {
  win: BrowserWindow
  path: string | null
  dirty: boolean
  folder: string | null
  /** 最近一次由本应用读到/写入的磁盘内容，用来识别外部修改 */
  lastContent: string | null
  watcher: FSWatcher | null
  recoveryId: string
  init: DocInit | null
  closing: boolean
  askingExternal: boolean
  pendingSave: ((ok: boolean) => void) | null
}

const docs = new Map<number, Doc>()
const BUILTIN_THEMES = [
  ['system', '跟随系统'],
  ['light', '浅色'],
  ['dark', '深色'],
  ['github', 'GitHub'],
  ['paper', '纸张'],
  ['night', '夜间'],
]
const DARK_THEMES = new Set(['dark', 'night'])

const recoveryDir = () => path.join(app.getPath('userData'), 'recovery')
const tmpImageDir = () => path.join(app.getPath('userData'), 'tmp-images')
const themeDir = () => path.join(app.getPath('userData'), 'themes')
const isMd = (f: string) => /\.(md|markdown|mdown|txt)$/i.test(f)

const docOf = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => docs.get(e.sender.id)
const focusedDoc = () => {
  const w = BrowserWindow.getFocusedWindow()
  return w ? docs.get(w.webContents.id) : undefined
}

// ---------- 标题 / 状态 ----------

function updateTitle(doc: Doc) {
  const name = doc.path ? path.basename(doc.path) : '未命名'
  doc.win.setTitle(`${doc.dirty ? '● ' : ''}${name}`)
  if (process.platform === 'darwin') {
    doc.win.setRepresentedFilename(doc.path ?? '')
    doc.win.setDocumentEdited(doc.dirty)
  }
}

function send(doc: Doc, channel: string, ...args: unknown[]) {
  if (!doc.win.isDestroyed()) doc.win.webContents.send(channel, ...args)
}

function isBlank(doc: Doc) {
  return !doc.path && !doc.dirty && !doc.init?.content
}

// ---------- 恢复文件 ----------

async function writeRecovery(doc: Doc, content: string) {
  await fs.mkdir(recoveryDir(), { recursive: true })
  await fs.writeFile(path.join(recoveryDir(), `${doc.recoveryId}.md`), content, 'utf8')
}

const removeRecovery = (doc: Doc) =>
  fs.unlink(path.join(recoveryDir(), `${doc.recoveryId}.md`)).catch(() => {})

// ---------- 文件监视（外部修改检测） ----------

function unwatch(doc: Doc) {
  doc.watcher?.close()
  doc.watcher = null
}

function startWatch(doc: Doc) {
  unwatch(doc)
  if (!doc.path) return
  let timer: NodeJS.Timeout | undefined
  try {
    doc.watcher = watch(doc.path, () => {
      clearTimeout(timer)
      timer = setTimeout(() => onExternalChange(doc), 300)
    })
    doc.watcher.on('error', () => unwatch(doc))
  } catch {
    // 文件暂时不可监视（如被删除），忽略
  }
}

async function onExternalChange(doc: Doc) {
  if (!doc.path || doc.win.isDestroyed()) return
  let content: string
  try {
    content = await fs.readFile(doc.path, 'utf8')
  } catch {
    return
  }
  startWatch(doc) // 原子写入会让旧 watcher 失效，重新挂上
  if (content === doc.lastContent) return
  if (doc.dirty) {
    if (doc.askingExternal) return
    doc.askingExternal = true
    const r = await dialog.showMessageBox(doc.win, {
      type: 'warning',
      message: `“${path.basename(doc.path)}”已被其他程序修改`,
      detail: '重新载入会丢弃编辑器中尚未保存的改动。',
      buttons: ['重新载入', '保留我的版本'],
      defaultId: 1,
      cancelId: 1,
    })
    doc.askingExternal = false
    if (r.response !== 0) return
  }
  doc.lastContent = content
  doc.dirty = false
  updateTitle(doc)
  send(doc, 'file:open', fileInfo(doc, content, true))
}

// ---------- 打开 / 保存 ----------

function fileInfo(doc: Doc, content: string, reload = false) {
  return {
    path: doc.path,
    content,
    reload,
    folder: doc.folder,
    baseUrl: doc.path ? docBaseUrl(doc.path) : null,
  }
}

function isUnder(file: string, dir: string) {
  const rel = path.relative(dir, file)
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

async function loadInto(doc: Doc, file: string) {
  const content = await fs.readFile(file, 'utf8')
  doc.path = file
  doc.dirty = false
  doc.lastContent = content
  doc.init = null
  if (!doc.folder || !isUnder(file, doc.folder)) doc.folder = path.dirname(file)
  startWatch(doc)
  updateTitle(doc)
  app.addRecentDocument(file)
  removeRecovery(doc)
  send(doc, 'file:open', fileInfo(doc, content))
}

/** 询问是否丢弃当前未保存内容。返回 true 表示可以继续（已保存或选择不保存）。 */
async function confirmDiscard(doc: Doc): Promise<boolean> {
  if (!doc.dirty) return true
  const name = doc.path ? path.basename(doc.path) : '未命名'
  const r = await dialog.showMessageBox(doc.win, {
    type: 'warning',
    message: `是否保存对“${name}”的更改？`,
    detail: '如果不保存，你的更改将会丢失。',
    buttons: ['保存', '不保存', '取消'],
    defaultId: 0,
    cancelId: 2,
  })
  if (r.response === 2) return false
  if (r.response === 1) return true
  return new Promise<boolean>((resolve) => {
    doc.pendingSave = resolve
    send(doc, 'file:request-save', false)
  })
}

async function openPathInto(doc: Doc, file: string) {
  if (doc.path === file) return
  if (!(await confirmDiscard(doc))) return
  try {
    await loadInto(doc, file)
  } catch (err) {
    dialog.showErrorBox('无法打开文件', String(err))
  }
}

/** 菜单“打开”/双击文件：优先复用空白窗口，已打开的文件直接聚焦 */
async function openFileSmart(file: string) {
  for (const d of docs.values()) {
    if (d.path === file) {
      d.win.focus()
      return
    }
  }
  const blank = [...docs.values()].find(isBlank)
  if (blank) {
    blank.win.focus()
    await openPathInto(blank, file)
  } else {
    await createWindow({ path: file })
  }
}

async function pickAndOpen() {
  const r = await dialog.showOpenDialog({
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'txt'] }],
    properties: ['openFile', 'multiSelections'],
  })
  if (r.canceled) return
  for (const f of r.filePaths) await openFileSmart(f)
}

/** 未命名文档里粘贴的图片在临时目录，首次保存时迁移到 xxx.assets 并改写引用 */
async function migrateImages(content: string, doc: Doc, oldPath: string | null): Promise<string> {
  const target = doc.path!
  const assets = path.join(path.dirname(target), assetsDirName(target))

  // 另存为到新位置：把旧的 assets 目录一并带过去
  if (oldPath && oldPath !== target) {
    const oldAssets = path.join(path.dirname(oldPath), assetsDirName(oldPath))
    try {
      await fs.cp(oldAssets, assets, { recursive: true, force: false, errorOnExist: false })
      const from = encodeURIComponent(assetsDirName(oldPath)) + '/'
      const to = encodeURIComponent(assetsDirName(target)) + '/'
      content = content.split(from).join(to)
    } catch {
      // 旧目录不存在则无需迁移
    }
  }

  for (const url of findTempImages(content, tmpImageDir())) {
    const src = fileURLToPath(url)
    const name = path.basename(src)
    try {
      await fs.mkdir(assets, { recursive: true })
      await fs.copyFile(src, path.join(assets, name))
      content = content.split(url).join(relativeAssetRef(target, name))
    } catch {
      // 临时文件丢失就保留原引用
    }
  }
  return content
}

async function saveDoc(doc: Doc, content: string, saveAs: boolean, silent: boolean): Promise<boolean> {
  const oldPath = doc.path
  if (!doc.path || saveAs) {
    if (silent && !doc.path) return false
    const r = await dialog.showSaveDialog(doc.win, {
      defaultPath: doc.path ?? path.join(doc.folder ?? app.getPath('documents'), '未命名.md'),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (r.canceled || !r.filePath) return false
    doc.path = r.filePath
    if (!doc.folder || !isUnder(doc.path, doc.folder)) doc.folder = path.dirname(doc.path)
  }
  try {
    content = await migrateImages(content, doc, oldPath)
    await fs.writeFile(doc.path, content, 'utf8')
  } catch (err) {
    doc.path = oldPath
    dialog.showErrorBox('保存失败', String(err))
    return false
  }
  doc.lastContent = content
  doc.dirty = false
  startWatch(doc)
  updateTitle(doc)
  removeRecovery(doc)
  app.addRecentDocument(doc.path)
  send(doc, 'doc:path', { path: doc.path, baseUrl: docBaseUrl(doc.path), folder: doc.folder })
  return true
}

// ---------- IPC ----------

ipcMain.handle('app:ready', async (e) => {
  const doc = docOf(e)
  const init = doc?.init ?? null
  if (doc) doc.init = null
  return {
    settings: getSettings(),
    themes: await listThemes(),
    platform: process.platform,
    init: doc && init ? { ...fileInfo(doc, init.content ?? ''), dirty: !!init.dirty } : null,
  }
})

ipcMain.handle('file:save', async (e, content: string, saveAs: boolean, silent: boolean) => {
  const doc = docOf(e)
  if (!doc) return false
  const ok = await saveDoc(doc, content, saveAs, silent)
  doc.pendingSave?.(ok)
  doc.pendingSave = null
  return ok
})

ipcMain.on('doc:dirty', (e, dirty: boolean) => {
  const doc = docOf(e)
  if (!doc || doc.dirty === dirty) return
  doc.dirty = dirty
  updateTitle(doc)
})

ipcMain.on('doc:recovery', (e, content: string) => {
  const doc = docOf(e)
  if (doc && !doc.path && doc.dirty) writeRecovery(doc, content).catch(() => {})
})

ipcMain.handle('file:open-path', (e, file: string) => {
  const doc = docOf(e)
  return doc ? openPathInto(doc, file) : undefined
})

ipcMain.handle('dir:read', async (_e, dir: string) => {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries
      .filter((d) => !d.name.startsWith('.') && d.name !== 'node_modules')
      .filter((d) => d.isDirectory() ? !d.name.endsWith('.assets') : isMd(d.name))
      .map((d) => ({ name: d.name, path: path.join(dir, d.name), isDir: d.isDirectory() }))
      .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, 'zh'))
  } catch {
    return []
  }
})

ipcMain.handle('tree:menu', (e, file: string, isDir: boolean) => {
  const doc = docOf(e)
  return new Promise<string | null>((resolve) => {
    const item = (label: string, action: string): MenuItemConstructorOptions => ({
      label,
      click: () => resolve(action),
    })
    const template: MenuItemConstructorOptions[] = [
      item(isDir ? '在此新建文件' : '在同级新建文件', 'create'),
      item('重命名', 'rename'),
      item('移到废纸篓', 'trash'),
      { type: 'separator' },
      { label: '在 Finder 中显示', click: () => { shell.showItemInFolder(file); resolve(null) } },
    ]
    Menu.buildFromTemplate(template).popup({
      window: doc?.win,
      // 菜单关闭的回调可能先于 click 触发，稍后再兜底
      callback: () => setTimeout(() => resolve(null), 150),
    })
  })
})

ipcMain.handle('fs:create', async (_e, dir: string, name: string) => {
  const clean = path.basename(name.trim())
  if (!clean) return null
  const file = path.join(dir, path.extname(clean) ? clean : `${clean}.md`)
  try {
    await fs.writeFile(file, '', { flag: 'wx' })
    return file
  } catch (err) {
    dialog.showErrorBox('无法创建文件', String(err))
    return null
  }
})

ipcMain.handle('fs:rename', async (e, file: string, name: string) => {
  const clean = path.basename(name.trim())
  if (!clean) return null
  const stat = await fs.stat(file).catch(() => null)
  const finalName = stat?.isDirectory() || path.extname(clean) ? clean : `${clean}.md`
  const target = path.join(path.dirname(file), finalName)
  try {
    await fs.access(target)
    dialog.showErrorBox('无法重命名', '同名文件已存在。')
    return null
  } catch {
    // 目标不存在，可以继续
  }
  await fs.rename(file, target)
  for (const d of docs.values()) {
    if (d.path === file) {
      d.path = target
      startWatch(d)
      updateTitle(d)
      send(d, 'doc:path', { path: target, baseUrl: docBaseUrl(target), folder: d.folder })
    }
  }
  return target
})

ipcMain.handle('fs:trash', async (_e, file: string) => {
  await shell.trashItem(file)
  for (const d of docs.values()) {
    if (d.path === file) {
      // 文件没了，但编辑器里的内容保留为未命名文档，避免丢字
      unwatch(d)
      d.path = null
      d.dirty = true
      updateTitle(d)
      send(d, 'doc:path', { path: null, baseUrl: null, folder: d.folder })
    }
  }
})

async function storeImage(doc: Doc, bytes: Uint8Array, ext: string): Promise<string> {
  const clean = ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png'
  if (uploadEnabled(getSettings())) {
    try {
      return await uploadBytes(bytes, clean, getSettings())
    } catch (err) {
      // 上传失败时回退为本地保存，图片不丢；之后可用“上传所有本地图片”重试
      dialog.showErrorBox('图片上传失败，已保存到本地', String((err as Error).message))
    }
  }
  const name = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 6)}.${clean}`
  if (doc.path) {
    const dir = path.join(path.dirname(doc.path), assetsDirName(doc.path))
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, name), bytes)
    return relativeAssetRef(doc.path, name)
  }
  await fs.mkdir(tmpImageDir(), { recursive: true })
  const file = path.join(tmpImageDir(), name)
  await fs.writeFile(file, bytes)
  return 'file://' + file.split('/').map(encodeURIComponent).join('/')
}

ipcMain.handle('image:save', async (e, bytes: Uint8Array, ext: string) => {
  const doc = docOf(e)
  return doc ? storeImage(doc, bytes, ext) : null
})

ipcMain.handle('image:pick', async (e) => {
  const doc = docOf(e)
  if (!doc) return null
  const r = await dialog.showOpenDialog(doc.win, {
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
    properties: ['openFile'],
  })
  if (r.canceled) return null
  const file = r.filePaths[0]
  return storeImage(doc, await fs.readFile(file), path.extname(file).slice(1))
})

ipcMain.handle('image:upload-all', async (e, markdown: string) => {
  const doc = docOf(e)
  if (!doc) return null
  if (!uploadEnabled(getSettings())) {
    dialog.showErrorBox('未启用图床', '请先在 偏好设置 → 图像 中选择上传服务（PicGo 或自定义命令）。')
    return null
  }
  const r = await uploadLocalImages(markdown, doc.path ? path.dirname(doc.path) : null, getSettings())
  if (r.failed.length) dialog.showErrorBox(`有 ${r.failed.length} 张图片上传失败`, r.failed.join('\n'))
  else if (!r.uploaded) dialog.showMessageBox(doc.win, { message: '没有需要上传的本地图片。' })
  return r.uploaded ? r.markdown : null
})

ipcMain.handle('export:doc', async (e, kind: 'html' | 'pdf' | 'docx', markdown: string) => {
  const doc = docOf(e)
  if (!doc) return false
  const base = doc.path ? path.basename(doc.path, path.extname(doc.path)) : '未命名'
  const r = await dialog.showSaveDialog(doc.win, {
    defaultPath: path.join(doc.path ? path.dirname(doc.path) : app.getPath('documents'), `${base}.${kind}`),
    filters: [{ name: kind.toUpperCase(), extensions: [kind] }],
  })
  if (r.canceled || !r.filePath) return false
  const baseDir = doc.path ? path.dirname(doc.path) : undefined
  try {
    const s = getSettings()
    if (kind === 'html') await fs.writeFile(r.filePath, await renderHtml(markdown, base, baseDir, { imageAlign: s.imageAlign }), 'utf8')
    else if (kind === 'docx') await renderDocx(markdown, baseDir, r.filePath)
    else {
      const pdf = await renderPdf(markdown, base, baseDir, {
        header: s.pdfHeader,
        footer: s.pdfFooter,
        pageNumbers: s.pdfPageNumbers,
        imageAlign: s.imageAlign,
      })
      await fs.writeFile(r.filePath, pdf)
    }
  } catch (err) {
    dialog.showErrorBox('导出失败', String(err))
    return false
  }
  shell.showItemInFolder(r.filePath)
  return true
})

// ---------- 设置 / 主题 ----------

async function listThemes() {
  const custom: string[][] = []
  try {
    for (const f of await fs.readdir(themeDir())) {
      if (f.endsWith('.css')) custom.push([`custom:${f}`, f.replace(/\.css$/, '')])
    }
  } catch {
    // 没有自定义主题目录
  }
  return [...BUILTIN_THEMES, ...custom]
}

function applySpellcheck(on: boolean) {
  const ses = session.defaultSession
  ses.setSpellCheckerEnabled(on)
  // 中英文混写：同时检查英文与美式英文词典即可，中文不参与拼写检查
  if (process.platform !== 'darwin') ses.setSpellCheckerLanguages(['en-US'])
}

function applyNativeTheme(theme: string) {
  nativeTheme.themeSource = theme === 'system' ? 'system' : DARK_THEMES.has(theme) ? 'dark' : 'light'
}

async function applySettings(patch: Partial<Settings>) {
  const s = await patchSettings(patch)
  if ('theme' in patch) applyNativeTheme(s.theme)
  if ('spellcheck' in patch) applySpellcheck(s.spellcheck)
  for (const d of docs.values()) send(d, 'settings:changed', s)
  buildMenu()
  return s
}

ipcMain.handle('settings:patch', (_e, patch: Partial<Settings>) => applySettings(patch))

ipcMain.handle('theme:css', async (_e, id: string) => {
  if (!id.startsWith('custom:')) return ''
  try {
    return await fs.readFile(path.join(themeDir(), path.basename(id.slice(7))), 'utf8')
  } catch {
    return ''
  }
})

// ---------- 菜单 ----------

async function buildMenu() {
  const cmd = (name: string, arg?: unknown) => () => focusedDoc() && send(focusedDoc()!, 'cmd', name, arg)
  const s = getSettings()
  const themes = await listThemes()

  const item = (label: string, accelerator: string | undefined, name: string, arg?: unknown): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: cmd(name, arg),
  })

  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about', label: '关于 iTypora' },
              { type: 'separator' },
              item('偏好设置…', 'CmdOrCtrl+,', 'preferences'),
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: '文件',
      submenu: [
        { label: '新建', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
        { label: '打开…', accelerator: 'CmdOrCtrl+O', click: () => pickAndOpen() },
        {
          label: '打开文件夹…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: async () => {
            const doc = focusedDoc()
            if (!doc) return
            const r = await dialog.showOpenDialog(doc.win, { properties: ['openDirectory'] })
            if (r.canceled) return
            doc.folder = r.filePaths[0]
            patchSettings({ lastFolder: doc.folder })
            send(doc, 'folder:set', doc.folder)
          },
        },
        { role: 'recentDocuments', label: '打开最近', submenu: [{ role: 'clearRecentDocuments', label: '清除菜单' }] },
        { type: 'separator' },
        item('保存', 'CmdOrCtrl+S', 'save'),
        item('另存为…', 'CmdOrCtrl+Shift+S', 'save-as'),
        { type: 'separator' },
        {
          label: '导出',
          submenu: [item('HTML…', undefined, 'export-html'), item('PDF…', undefined, 'export-pdf'), item('Word (.docx)…', undefined, 'export-docx')],
        },
        { type: 'separator' },
        { role: 'close', label: '关闭窗口' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '拷贝' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
        { type: 'separator' },
        {
          label: '拼写检查',
          type: 'checkbox',
          checked: s.spellcheck,
          click: (mi) => applySettings({ spellcheck: mi.checked }),
        },
        item('查找…', 'CmdOrCtrl+F', 'find'),
        item('查找并替换…', 'Alt+CmdOrCtrl+F', 'replace'),
        { type: 'separator' },
        item('插入图片…', 'Ctrl+CmdOrCtrl+I', 'insert-image'),
        item('上传所有本地图片', undefined, 'upload-images'),
      ],
    },
    {
      label: '段落',
      submenu: [
        ...[1, 2, 3, 4, 5, 6].map((n) => item(`标题 ${n}`, `CmdOrCtrl+${n}`, 'heading', n)),
        item('正文', 'CmdOrCtrl+0', 'paragraph'),
        { type: 'separator' },
        item('引用', 'Alt+CmdOrCtrl+Q', 'blockquote'),
        item('有序列表', 'Alt+CmdOrCtrl+O', 'ordered-list'),
        item('无序列表', 'Alt+CmdOrCtrl+U', 'bullet-list'),
        { type: 'separator' },
        item('代码块', 'Alt+CmdOrCtrl+C', 'code-block'),
        item('表格', 'Alt+CmdOrCtrl+T', 'table'),
        item('分隔线', undefined, 'hr'),
      ],
    },
    {
      label: '格式',
      submenu: [
        item('加粗', 'CmdOrCtrl+B', 'bold'),
        item('斜体', 'CmdOrCtrl+I', 'italic'),
        item('行内代码', 'CmdOrCtrl+Shift+`', 'inline-code'),
        item('删除线', 'Alt+Shift+5', 'strike'),
        item('超链接', 'CmdOrCtrl+K', 'link'),
      ],
    },
    {
      label: '视图',
      submenu: [
        { ...item('显示/隐藏侧边栏', 'CmdOrCtrl+Shift+L', 'toggle-sidebar') },
        item('大纲', 'Ctrl+CmdOrCtrl+1', 'sidebar-outline'),
        item('文件', 'Ctrl+CmdOrCtrl+2', 'sidebar-files'),
        { type: 'separator' },
        item('源码模式', 'CmdOrCtrl+/', 'toggle-source'),
        item('专注模式', 'F8', 'toggle-focus'),
        item('打字机模式', 'F9', 'toggle-typewriter'),
        { type: 'separator' },
        {
          label: '主题',
          submenu: [
            ...themes.map(([id, label]): MenuItemConstructorOptions => ({
              label,
              type: 'radio',
              checked: s.theme === id,
              click: () => applySettings({ theme: id }),
            })),
            { type: 'separator' },
            {
              label: '打开主题文件夹',
              click: async () => {
                await fs.mkdir(themeDir(), { recursive: true })
                shell.openPath(themeDir())
              },
            },
          ],
        },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { role: 'togglefullscreen', label: '进入全屏' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    },
    { role: 'windowMenu', label: '窗口' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---------- 窗口 ----------

async function createWindow(init?: DocInit): Promise<Doc> {
  if (init?.path) {
    init = { ...init, content: await fs.readFile(init.path, 'utf8') }
  }
  const win = new BrowserWindow({
    width: 1040,
    height: 780,
    minWidth: 480,
    minHeight: 320,
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  const doc: Doc = {
    win,
    path: init?.path ?? null,
    dirty: !!init?.dirty,
    folder: init?.path ? path.dirname(init.path) : getSettings().lastFolder,
    lastContent: init?.path ? init.content ?? null : null,
    watcher: null,
    recoveryId: randomUUID(),
    init: init ?? null,
    closing: false,
    askingExternal: false,
    pendingSave: null,
  }
  const id = win.webContents.id
  docs.set(id, doc)

  win.once('ready-to-show', () => win.show())
  win.webContents.on('context-menu', (_e, p) => {
    const items: MenuItemConstructorOptions[] = []
    if (p.misspelledWord) {
      for (const w of p.dictionarySuggestions.slice(0, 5)) {
        items.push({ label: w, click: () => win.webContents.replaceMisspelling(w) })
      }
      if (!p.dictionarySuggestions.length) items.push({ label: '无拼写建议', enabled: false })
      items.push(
        { label: '添加到词典', click: () => win.webContents.session.addWordToSpellCheckerDictionary(p.misspelledWord) },
        { type: 'separator' },
      )
    }
    if (p.isEditable) items.push({ role: 'cut', label: '剪切' })
    if (p.isEditable || p.selectionText) items.push({ role: 'copy', label: '拷贝' })
    if (p.isEditable) items.push({ role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' })
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win })
  })
  win.webContents.on('will-navigate', (e, url) => {
    e.preventDefault()
    if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  win.on('close', (e) => {
    if (doc.closing || !doc.dirty) return
    e.preventDefault()
    confirmDiscard(doc).then((ok) => {
      if (ok) {
        doc.closing = true
        win.close()
      }
    })
  })
  win.on('closed', () => {
    unwatch(doc)
    removeRecovery(doc)
    docs.delete(id)
  })

  if (doc.path) startWatch(doc)
  updateTitle(doc)
  await win.loadFile(path.join(__dirname, '../renderer/index.html'))
  return doc
}

// ---------- 启动 ----------

async function restoreRecovered() {
  let files: string[] = []
  try {
    files = (await fs.readdir(recoveryDir())).filter((f) => f.endsWith('.md'))
  } catch {
    return false
  }
  if (!files.length) return false
  const r = await dialog.showMessageBox({
    type: 'question',
    message: `检测到 ${files.length} 个上次未保存的文档，是否恢复？`,
    buttons: ['恢复', '丢弃'],
    defaultId: 0,
    cancelId: 1,
  })
  let restored = false
  for (const f of files) {
    const full = path.join(recoveryDir(), f)
    if (r.response === 0) {
      const content = await fs.readFile(full, 'utf8')
      const doc = await createWindow({ content, dirty: true })
      doc.recoveryId = path.basename(f, '.md')
      restored = true
    }
    if (r.response === 1) await fs.unlink(full).catch(() => {})
  }
  // 恢复出来的窗口已用原 id 接管；丢弃时文件已删除
  return restored
}

async function cleanOldTmpImages() {
  try {
    const limit = Date.now() - 7 * 24 * 3600 * 1000
    for (const f of await fs.readdir(tmpImageDir())) {
      const p = path.join(tmpImageDir(), f)
      if ((await fs.stat(p)).mtimeMs < limit) await fs.unlink(p)
    }
  } catch {
    // 目录不存在
  }
}

const pendingOpen: string[] = []
let appReady = false

app.on('open-file', (e, file) => {
  e.preventDefault()
  if (appReady) openFileSmart(file)
  else pendingOpen.push(file)
})

const appVersion: string = require('../../package.json').version
app.setName('iTypora')
// 开发模式下 app.getVersion() 返回的是 Electron 自己的版本号，这里显式用 package.json 的
app.setAboutPanelOptions({ applicationName: 'iTypora', applicationVersion: appVersion, version: '' })

app.whenReady().then(async () => {
  const s = await loadSettings()
  // 开发模式下没有 .app 包，手动设置 Dock 图标
  if (!app.isPackaged) app.dock?.setIcon(path.join(__dirname, '../../build/icon.png'))
  applyNativeTheme(s.theme)
  applySpellcheck(s.spellcheck)
  buildMenu()
  cleanOldTmpImages()
  appReady = true

  const restored = await restoreRecovered()
  const argFiles = process.argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('-') && isMd(a))
  for (const f of [...pendingOpen, ...argFiles]) await openFileSmart(path.resolve(f))
  if (!restored && !docs.size) await createWindow()

  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow()
  })
})

app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
