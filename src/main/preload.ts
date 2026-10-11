import { contextBridge, ipcRenderer, webUtils } from 'electron'

const EVENTS = ['file:open', 'file:request-save', 'cmd', 'settings:changed', 'folder:set', 'doc:path']

const invoke = (ch: string, ...a: unknown[]) => ipcRenderer.invoke(ch, ...a)

contextBridge.exposeInMainWorld('api', {
  on: (channel: string, cb: (...args: any[]) => void) => {
    if (EVENTS.includes(channel)) ipcRenderer.on(channel, (_e, ...args) => cb(...args))
  },
  ready: () => invoke('app:ready'),
  save: (content: string, saveAs: boolean, silent: boolean) => invoke('file:save', content, saveAs, silent),
  setDirty: (dirty: boolean) => ipcRenderer.send('doc:dirty', dirty),
  recovery: (content: string) => ipcRenderer.send('doc:recovery', content),
  openPath: (file: string) => invoke('file:open-path', file),
  readDir: (dir: string) => invoke('dir:read', dir),
  treeMenu: (file: string, isDir: boolean) => invoke('tree:menu', file, isDir),
  fsCreate: (dir: string, name: string) => invoke('fs:create', dir, name),
  fsRename: (file: string, name: string) => invoke('fs:rename', file, name),
  fsTrash: (file: string) => invoke('fs:trash', file),
  saveImage: (bytes: Uint8Array, ext: string) => invoke('image:save', bytes, ext),
  uploadImages: (markdown: string) => invoke('image:upload-all', markdown),
  pickImage: () => invoke('image:pick'),
  exportDoc: (kind: 'html' | 'pdf' | 'docx', markdown: string) => invoke('export:doc', kind, markdown),
  patchSettings: (patch: Record<string, unknown>) => invoke('settings:patch', patch),
  themeCss: (id: string) => invoke('theme:css', id),
  pathForFile: (f: File) => webUtils.getPathForFile(f),
})
