import { app, Rectangle } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'

/** 会话状态：窗口位置大小、退出时打开的文件、各文件的阅读位置。与设置分开存，频繁写入不触发设置广播。 */
interface SessionState {
  bounds: Rectangle | null
  files: string[]
  scroll: Record<string, number>
}

const MAX_SCROLL_ENTRIES = 200
const file = () => path.join(app.getPath('userData'), 'session.json')
let state: SessionState = { bounds: null, files: [], scroll: {} }
let timer: NodeJS.Timeout | undefined

export async function loadSession(): Promise<void> {
  try {
    state = { ...state, ...JSON.parse(await fs.readFile(file(), 'utf8')) }
  } catch {
    // 首次启动或文件损坏，用默认值
  }
}

async function write() {
  await fs.mkdir(path.dirname(file()), { recursive: true })
  await fs.writeFile(file(), JSON.stringify(state, null, 2), 'utf8')
}

function persist() {
  clearTimeout(timer)
  timer = setTimeout(() => write().catch(() => {}), 1000)
}

/** 退出前立即写盘 */
export function flushSession(): Promise<void> {
  clearTimeout(timer)
  return write().catch(() => {})
}

export const getBounds = () => state.bounds

export function setBounds(b: Rectangle) {
  state.bounds = b
  persist()
}

export const getSessionFiles = () => state.files

export function setSessionFiles(files: string[]) {
  state.files = files
  persist()
}

export const getScroll = (file: string) => state.scroll[file] ?? 0

export function setScroll(file: string, top: number) {
  // 删除再插入，让最近用到的排在后面，超出上限时淘汰最早的
  delete state.scroll[file]
  if (top > 0) state.scroll[file] = Math.round(top)
  const keys = Object.keys(state.scroll)
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_SCROLL_ENTRIES))) delete state.scroll[k]
  persist()
}
