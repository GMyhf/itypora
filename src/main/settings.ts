import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'

export interface Settings {
  theme: string
  autoSave: boolean
  fontSize: number
  lineWidth: number
  fontFamily: string
  sidebar: boolean
  sidebarTab: 'outline' | 'files'
  sidebarWidth: number
  lastFolder: string | null
  imageUploader: 'none' | 'picgo' | 'command'
  picgoUrl: string
  uploadCommand: string
  pdfHeader: string
  pdfFooter: string
  pdfPageNumbers: boolean
  imageAlign: 'left' | 'center'
  spellcheck: boolean
  restoreSession: boolean
}

export const DEFAULTS: Settings = {
  theme: 'system',
  autoSave: true,
  fontSize: 16,
  lineWidth: 820,
  fontFamily: '',
  sidebar: false,
  sidebarTab: 'outline',
  sidebarWidth: 240,
  lastFolder: null,
  imageUploader: 'none',
  picgoUrl: 'http://127.0.0.1:36677/upload',
  uploadCommand: '',
  pdfHeader: '',
  pdfFooter: '',
  pdfPageNumbers: true,
  imageAlign: 'center',
  spellcheck: true,
  restoreSession: true,
}

const file = () => path.join(app.getPath('userData'), 'settings.json')
let current: Settings = { ...DEFAULTS }

export async function loadSettings(): Promise<Settings> {
  try {
    current = { ...DEFAULTS, ...JSON.parse(await fs.readFile(file(), 'utf8')) }
  } catch {
    current = { ...DEFAULTS }
  }
  return current
}

export const getSettings = () => current

export async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
  current = { ...current, ...patch }
  await fs.mkdir(path.dirname(file()), { recursive: true })
  await fs.writeFile(file(), JSON.stringify(current, null, 2), 'utf8')
  return current
}
