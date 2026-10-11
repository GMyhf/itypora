// 冒烟测试：需要图形环境，例如  xvfb-run -a node tests/smoke.mjs <工作目录>
import { _electron as electron } from 'playwright-core'
import { promises as fs } from 'fs'
import path from 'path'

const work = process.argv[2]
const file = path.join(work, 'test.md')
const errors = []
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`)
  if (!ok) process.exitCode = 1
}

const app = await electron.launch({
  args: ['.', '--no-sandbox', `--user-data-dir=${path.join(work, 'profile')}`, file],
  cwd: process.cwd(),
})
const win = await app.firstWindow()
win.on('pageerror', (e) => errors.push(String(e)))
win.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

await win.waitForSelector('.ProseMirror', { timeout: 20000 })
check((await win.locator('.ProseMirror h1').innerText()) === '初始标题', '打开文件并渲染标题')

// 大纲
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('cmd', 'toggle-sidebar'))
await win.waitForSelector('#outline .outline-row')
check((await win.locator('#outline .outline-row').count()) === 2, '大纲列出 2 个标题')

// 编辑 -> 脏标记 -> 自动保存
await win.locator('.ProseMirror').click()
await win.keyboard.press('Meta+End').catch(() => {})
await win.keyboard.press('Control+End')
await win.keyboard.type('追加的内容 ZZZ')
await new Promise((r) => setTimeout(r, 400))
const dirtyTitle = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())
check(dirtyTitle.startsWith('● '), `编辑后标题带未保存标记（${dirtyTitle}）`)
await new Promise((r) => setTimeout(r, 3000))
const onDisk = await fs.readFile(file, 'utf8')
check(onDisk.includes('追加的内容 ZZZ'), '2 秒后自动保存到磁盘')
const cleanTitle = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())
check(cleanTitle === 'test.md', `保存后标记消失（${cleanTitle}）`)

// 源码模式往返
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('cmd', 'toggle-source'))
await win.waitForSelector('#source:not([hidden])')
check((await win.locator('#source').inputValue()).includes('## 小节'), '源码模式显示 Markdown')
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('cmd', 'toggle-source'))
await win.waitForSelector('.ProseMirror h2')
check(true, '切回所见即所得')

// 查找
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('cmd', 'find'))
await win.fill('#find-input', 'text')
await win.waitForSelector('.find-match')
check((await win.locator('#find-count').innerText()) === '1/1', '查找高亮并计数')

// 主题
await win.evaluate(() => window.api.patchSettings({ theme: 'dark' }))
await win.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
check(true, '切换深色主题')

await win.screenshot({ path: path.join(work, 'shot.png') })
check(errors.length === 0, `无渲染进程报错 ${errors.join(' | ')}`)
await app.close()
