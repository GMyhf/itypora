// 冒烟测试：需要图形环境，例如  xvfb-run -a node tests/smoke.mjs <工作目录>
import { _electron as electron } from 'playwright-core'
import { promises as fs } from 'fs'
import path from 'path'

const work = process.argv[2]
const file = path.join(work, 'test.md')
await fs.mkdir(work, { recursive: true })
await fs.writeFile(file, '# 初始标题\n\nsome text\n\n```mermaid\ngraph TD\n  A[开始] --> B[结束]\n```\n\n## 小节\n\n内容\n')
const errors = []
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`)
  if (!ok) process.exitCode = 1
}

const launch = (...files) =>
  electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${path.join(work, 'profile')}`, ...files], cwd: process.cwd() })
let app = await launch(file)
let win = await app.firstWindow()
win.on('pageerror', (e) => errors.push(String(e)))
win.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

await win.waitForSelector('.ProseMirror', { timeout: 20000 })
check((await win.locator('.ProseMirror h1').innerText()) === '初始标题', '打开文件并渲染标题')

// 大纲
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('cmd', 'toggle-sidebar'))
await win.waitForSelector('#outline .outline-row')
check((await win.locator('#outline .outline-row').count()) === 2, '大纲列出 2 个标题')

// Mermaid 预览
await win.waitForSelector('.mermaid-preview svg', { timeout: 20000 })
check((await win.locator('.mermaid-preview svg').innerHTML()).includes('开始'), 'Mermaid 代码块渲染成图表')

// 演示模式：按标题分成 2 页
const send = (name) => app.evaluate(({ BrowserWindow }, n) => BrowserWindow.getAllWindows()[0].webContents.send('cmd', n), name)
await send('present')
await win.waitForSelector('#presenter .slide-body h1')
check((await win.locator('#presenter .slide-page').innerText()) === '1 / 2', '演示模式第 1 页')
check((await win.locator('#presenter .mermaid svg').count()) === 1, '幻灯片里的 Mermaid 图')
await win.keyboard.press('ArrowRight')
check((await win.locator('#presenter .slide-body h2').innerText()) === '小节', '方向键翻到第 2 页')
await win.screenshot({ path: path.join(work, 'slides.png') })
await win.keyboard.press('Escape')
await win.waitForSelector('#presenter', { state: 'detached' })
check(true, 'Esc 退出演示')

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

// 记住阅读位置
await win.evaluate(() => {
  const sc = document.getElementById('scroller')
  document.getElementById('app').style.minHeight = '5000px'
  sc.scrollTop = 800
})
await new Promise((r) => setTimeout(r, 800))

await win.screenshot({ path: path.join(work, 'shot.png') })
check(errors.length === 0, `无渲染进程报错 ${errors.join(' | ')}`)
await app.close()

// 重新启动、不带文件参数：恢复上次打开的文件
app = await launch()
win = await app.firstWindow()
await win.waitForSelector('.ProseMirror h1', { timeout: 20000 })
const reopened = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getTitle()).join(','))
check(reopened === 'test.md', `启动时重新打开上次的文件（${reopened}）`)
const session = JSON.parse(await fs.readFile(path.join(work, 'profile', 'session.json'), 'utf8'))
check(session.scroll[file] === 800, `记录了阅读位置（${session.scroll[file]}）`)
await app.close()
