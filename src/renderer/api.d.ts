export interface TreeEntry {
  name: string
  path: string
  isDir: boolean
}

export interface FileInfo {
  path: string | null
  content: string
  reload: boolean
  folder: string | null
  baseUrl: string | null
  dirty?: boolean
}

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
}

export interface Api {
  on(channel: 'file:open', cb: (f: FileInfo) => void): void
  on(channel: 'file:request-save', cb: (saveAs: boolean) => void): void
  on(channel: 'cmd', cb: (name: string, arg?: unknown) => void): void
  on(channel: 'settings:changed', cb: (s: Settings) => void): void
  on(channel: 'folder:set', cb: (folder: string) => void): void
  on(channel: 'doc:path', cb: (p: { path: string | null; baseUrl: string | null; folder: string | null }) => void): void
  ready(): Promise<{ settings: Settings; themes: string[][]; platform: string; init: FileInfo | null }>
  save(content: string, saveAs: boolean, silent: boolean): Promise<boolean>
  setDirty(dirty: boolean): void
  recovery(content: string): void
  openPath(file: string): Promise<void>
  readDir(dir: string): Promise<TreeEntry[]>
  treeMenu(file: string, isDir: boolean): Promise<'create' | 'rename' | 'trash' | 'reveal' | null>
  fsCreate(dir: string, name: string): Promise<string | null>
  fsRename(file: string, name: string): Promise<string | null>
  fsTrash(file: string): Promise<void>
  saveImage(bytes: Uint8Array, ext: string): Promise<string>
  pickImage(): Promise<string | null>
  uploadImages(markdown: string): Promise<string | null>
  exportDoc(kind: 'html' | 'pdf' | 'docx', markdown: string): Promise<boolean>
  patchSettings(patch: Partial<Settings>): Promise<Settings>
  themeCss(id: string): Promise<string>
  pathForFile(f: File): string
}

declare global {
  interface Window {
    api: Api
  }
}
