import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import './style.css'
import './themes/themes.css'
import type { FileInfo, Settings } from './api'
import { Editor, extOf } from './editor'
import { extractOutline } from './outline'
import { finder, viewModes } from './plugins'
import { Sidebar } from './sidebar'
import { countStats } from './stats'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const api = window.api

const scroller = $('scroller')
const source = $<HTMLTextAreaElement>('source')
const root = document.documentElement
viewModes.scroller = scroller

let settings: Settings
let themeList: string[][] = []
let currentPath: string | null = null
let dirty = false
let revision = 0
let sourceMode = false
let baseline = ''
let loadedAt = 0

const debounce = <A extends unknown[]>(fn: (...a: A) => void, ms: number) => {
  let t: ReturnType<typeof setTimeout>
  return (...a: A) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...a), ms)
  }
}

// ---------- 编辑器 ----------

const editor = new Editor('#app', {
  onChange: () => {
    // 载入后编辑器可能自行规整一次文档（如补尾部空段落），这不算用户改动
    if (performance.now() - loadedAt < 500 && editor.markdown() === baseline) return
    markChanged()
  },
  onSelection: () => requestAnimationFrame(updateStats),
  upload: async (file) => api.saveImage(new Uint8Array(await file.arrayBuffer()), extOf(file)),
})

const markdown = () => (sourceMode ? source.value : editor.markdown())

function markChanged() {
  revision++
  if (!dirty) {
    dirty = true
    api.setDirty(true)
  }
  autosave()
  stash()
  refreshDerived()
}

const autosave = debounce(() => {
  if (settings.autoSave && currentPath && dirty) save(false, true)
}, 2000)

// 未命名文档定期写恢复文件，崩溃后可找回
const stash = debounce(() => {
  if (!currentPath && dirty) api.recovery(markdown())
}, 3000)

async function save(saveAs: boolean, silent = false) {
  const rev = revision
  const ok = await api.save(markdown(), saveAs, silent)
  if (!ok) return
  if (rev === revision) dirty = false
  else api.setDirty(true) // 保存期间又有新输入
  if (!dirty) api.setDirty(false)
}

async function load(info: FileInfo) {
  const keep = info.reload ? scroller.scrollTop : 0
  if (sourceMode) setSourceMode(false, false)
  closeFind()
  currentPath = info.path
  editor.baseUrl = info.baseUrl
  await editor.load(info.content)
  baseline = editor.markdown()
  loadedAt = performance.now()
  revision++
  dirty = !!info.dirty
  api.setDirty(dirty)
  scroller.scrollTop = keep
  if (info.folder && info.folder !== sidebarFolder) await setFolder(info.folder)
  sidebar.markCurrent()
  refreshDerived()
  if (!info.reload) editor.focus()
}

// ---------- 大纲 / 状态栏 ----------

const refreshDerived = debounce(() => {
  updateStats()
  if (!settings.sidebar || sourceMode) return
  if (sidebarEl.dataset.tab === 'outline' && editor.doc) sidebar.setOutline(extractOutline(editor.doc))
}, 200)

function updateStats() {
  let text: string
  let selected = false
  if (sourceMode) {
    const sel = source.value.slice(source.selectionStart, source.selectionEnd)
    selected = !!sel
    text = sel || source.value
  } else {
    const sel = editor.selectedText()
    selected = !!sel
    text = sel || editor.fullText()
  }
  const s = countStats(text)
  $('stats').textContent = `${selected ? '选中 ' : ''}${s.words} 词 · ${s.chars} 字符${s.minutes ? ` · 约 ${s.minutes} 分钟` : ''}`
}

// ---------- 侧边栏 ----------

const sidebarEl = $('sidebar')
let sidebarFolder: string | null = null

const sidebar = new Sidebar(
  {
    jump: (pos) => {
      const dom = editor.view?.nodeDOM(pos) as HTMLElement | null
      dom?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    },
    askName,
    currentPath: () => currentPath,
  },
  (tab) => api.patchSettings({ sidebarTab: tab }),
)

async function setFolder(folder: string | null) {
  sidebarFolder = folder
  await sidebar.setFolder(folder)
}

function setSidebar(show: boolean, tab?: 'outline' | 'files') {
  sidebarEl.hidden = !show
  if (tab) sidebar.showTab(tab)
  if (show) refreshDerived()
}

// 拖拽调整宽度
$('resizer').addEventListener('mousedown', (e) => {
  e.preventDefault()
  const move = (ev: MouseEvent) => {
    const w = Math.min(520, Math.max(160, ev.clientX))
    root.style.setProperty('--sidebar-width', `${w}px`)
  }
  const up = (ev: MouseEvent) => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
    api.patchSettings({ sidebarWidth: Math.min(520, Math.max(160, ev.clientX)) })
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
})

// ---------- 源码模式 ----------

function setSourceMode(on: boolean, reload = true) {
  if (on === sourceMode) return
  if (on) {
    source.value = markdown()
    sourceOriginal = source.value
    source.hidden = false
    scroller.hidden = true
    $('mode-badge').textContent = '源码模式'
    sourceMode = true
    source.focus()
  } else {
    sourceMode = false
    source.hidden = true
    scroller.hidden = false
    $('mode-badge').textContent = ''
    if (reload && source.value !== sourceOriginal) {
      editor.load(source.value).then(() => {
        baseline = editor.markdown()
        loadedAt = performance.now()
        refreshDerived()
        editor.focus()
      })
    } else if (reload) editor.focus()
  }
  updateStats()
}
let sourceOriginal = ''

source.addEventListener('input', () => markChanged())
source.addEventListener('select', updateStats)
source.addEventListener('keyup', updateStats)
source.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault()
    document.execCommand('insertText', false, '  ')
  }
})

// ---------- 查找替换 ----------

const findBar = $('findbar')
const findInput = $<HTMLInputElement>('find-input')
const replaceInput = $<HTMLInputElement>('replace-input')

function openFind(withReplace: boolean) {
  if (sourceMode) setSourceMode(false)
  findBar.hidden = false
  findBar.classList.toggle('with-replace', withReplace)
  const sel = editor.selectedText()
  if (sel && !sel.includes('\n')) findInput.value = sel
  findInput.focus()
  findInput.select()
  runFind()
}

function closeFind() {
  if (findBar.hidden) return
  findBar.hidden = true
  const v = editor.view
  if (v) finder.search(v, '')
}

function runFind(current = 0) {
  const v = editor.view
  if (!v) return
  finder.search(v, findInput.value, current)
  updateFindCount()
}

function updateFindCount() {
  const v = editor.view
  if (!v || !findInput.value) return ($('find-count').textContent = '')
  const s = finder.state(v)
  $('find-count').textContent = s.matches.length ? `${s.current + 1}/${s.matches.length}` : '无结果'
}

const stepFind = (d: number) => {
  const v = editor.view
  if (!v) return
  finder.step(v, d)
  updateFindCount()
}

findInput.addEventListener('input', () => runFind())
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') stepFind(e.shiftKey ? -1 : 1)
  if (e.key === 'Escape') {
    closeFind()
    editor.focus()
  }
})
replaceInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('replace-one').click()
  if (e.key === 'Escape') closeFind()
})
$('find-next').addEventListener('click', () => stepFind(1))
$('find-prev').addEventListener('click', () => stepFind(-1))
$('find-close').addEventListener('click', () => {
  closeFind()
  editor.focus()
})
$('replace-one').addEventListener('click', () => {
  const v = editor.view
  if (!v) return
  finder.replaceCurrent(v, replaceInput.value)
  updateFindCount()
})
$('replace-all').addEventListener('click', () => {
  const v = editor.view
  if (!v) return
  finder.replaceAll(v, replaceInput.value)
  updateFindCount()
})

// ---------- 弹窗 ----------

const modal = $('modal')
const nameForm = $<HTMLFormElement>('name-form')
const prefsForm = $<HTMLFormElement>('prefs-form')

function closeModal() {
  modal.hidden = true
  nameForm.hidden = true
  prefsForm.hidden = true
}

function askName(title: string, value: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = $<HTMLInputElement>('name-input')
    $('name-title').textContent = title
    input.value = value
    modal.hidden = false
    nameForm.hidden = false
    input.focus()
    input.select()
    const done = (v: string | null) => {
      nameForm.onsubmit = null
      $('name-cancel').onclick = null
      closeModal()
      resolve(v)
    }
    nameForm.onsubmit = (e) => {
      e.preventDefault()
      done(input.value.trim() || null)
    }
    $('name-cancel').onclick = () => done(null)
  })
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modal.hidden) {
    if (!nameForm.hidden) $('name-cancel').click()
    else closeModal()
  }
})

function openPrefs() {
  const sel = $<HTMLSelectElement>('pref-theme')
  sel.replaceChildren(...themeList.map(([id, label]) => new Option(label, id, false, id === settings.theme)))
  $<HTMLInputElement>('pref-font-size').value = String(settings.fontSize)
  $<HTMLInputElement>('pref-line-width').value = String(settings.lineWidth)
  $<HTMLInputElement>('pref-font-family').value = settings.fontFamily
  $<HTMLInputElement>('pref-auto-save').checked = settings.autoSave
  modal.hidden = false
  prefsForm.hidden = false
}

prefsForm.addEventListener('submit', (e) => e.preventDefault())
$('prefs-close').addEventListener('click', closeModal)
$('pref-theme').addEventListener('change', (e) => api.patchSettings({ theme: (e.target as HTMLSelectElement).value }))
$('pref-font-size').addEventListener('change', (e) => {
  const n = Number((e.target as HTMLInputElement).value)
  if (n >= 12 && n <= 28) api.patchSettings({ fontSize: n })
})
$('pref-line-width').addEventListener('change', (e) => {
  const n = Number((e.target as HTMLInputElement).value)
  if (n >= 480 && n <= 1600) api.patchSettings({ lineWidth: n })
})
$('pref-font-family').addEventListener('change', (e) => api.patchSettings({ fontFamily: (e.target as HTMLInputElement).value.trim() }))
$('pref-auto-save').addEventListener('change', (e) => api.patchSettings({ autoSave: (e.target as HTMLInputElement).checked }))

// ---------- 设置 / 主题 ----------

const dark = matchMedia('(prefers-color-scheme: dark)')

async function applySettings(s: Settings) {
  const prevTheme = settings?.theme
  settings = s
  root.style.setProperty('--font-size', `${s.fontSize}px`)
  root.style.setProperty('--line-width', `${s.lineWidth}px`)
  root.style.setProperty('--sidebar-width', `${s.sidebarWidth}px`)
  if (s.fontFamily) root.style.setProperty('--font-family', s.fontFamily)
  else root.style.removeProperty('--font-family')

  if (s.theme !== prevTheme) {
    const custom = s.theme.startsWith('custom:')
    $('custom-theme').textContent = custom ? await api.themeCss(s.theme) : ''
  }
  root.dataset.theme = s.theme === 'system' ? (dark.matches ? 'dark' : 'light') : s.theme.startsWith('custom:') ? 'light' : s.theme
}
dark.addEventListener('change', () => settings && applySettings(settings))

// ---------- 命令分发 ----------

async function exportDoc(kind: 'html' | 'pdf') {
  await api.exportDoc(kind, markdown())
}

api.on('cmd', async (name, arg) => {
  switch (name) {
    case 'save': return save(false)
    case 'save-as': return save(true)
    case 'export-html': return exportDoc('html')
    case 'export-pdf': return exportDoc('pdf')
    case 'find': return openFind(false)
    case 'replace': return openFind(true)
    case 'preferences': return openPrefs()
    case 'toggle-sidebar': {
      const show = !!sidebarEl.hidden
      setSidebar(show)
      return void api.patchSettings({ sidebar: show })
    }
    case 'sidebar-outline':
    case 'sidebar-files': {
      const tab = name === 'sidebar-outline' ? 'outline' : 'files'
      setSidebar(true, tab)
      return void api.patchSettings({ sidebar: true, sidebarTab: tab })
    }
    case 'toggle-source': return setSourceMode(!sourceMode)
    case 'toggle-focus': return void document.body.classList.toggle('focus-mode')
    case 'toggle-typewriter': {
      viewModes.typewriter = !viewModes.typewriter
      document.body.classList.toggle('typewriter', viewModes.typewriter)
      return
    }
    case 'insert-image': {
      if (sourceMode) return
      const ref = await api.pickImage()
      if (ref) editor.insertImage(ref)
      return
    }
    default:
      if (!sourceMode) editor.run(name, arg)
  }
})

api.on('file:open', (info) => load(info))
api.on('file:request-save', (saveAs) => save(saveAs))
api.on('settings:changed', (s) => applySettings(s))
api.on('folder:set', (folder) => {
  setSidebar(true, 'files')
  api.patchSettings({ sidebar: true, sidebarTab: 'files', lastFolder: folder })
  setFolder(folder)
})
api.on('doc:path', (p) => {
  currentPath = p.path
  editor.baseUrl = p.baseUrl
  if (!p.path) {
    // 文件被删除：内容保留为未命名文档
    dirty = true
    revision++
  }
  if (p.folder && p.folder !== sidebarFolder) setFolder(p.folder)
  else sidebar.refreshFiles()
})

// 把 .md 文件拖进窗口：打开它（图片的拖入由编辑器插件处理）
window.addEventListener(
  'dragover',
  (e) => e.preventDefault(),
  true,
)
window.addEventListener(
  'drop',
  (e) => {
    const files = [...(e.dataTransfer?.files ?? [])]
    const md = files.find((f) => /\.(md|markdown|mdown|txt)$/i.test(f.name))
    if (!md) return
    e.preventDefault()
    e.stopPropagation()
    api.openPath(api.pathForFile(md))
  },
  true,
)

// ---------- 启动 ----------

;(async () => {
  const boot = await api.ready()
  themeList = boot.themes
  root.dataset.platform = boot.platform
  await applySettings(boot.settings)
  setSidebar(boot.settings.sidebar, boot.settings.sidebarTab)
  await load(boot.init ?? { path: null, content: '', reload: false, folder: boot.settings.lastFolder, baseUrl: null })
  if (boot.settings.sidebarTab === 'files' || boot.settings.sidebar) refreshDerived()
})()
