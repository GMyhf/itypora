import { exec, execFile } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import type { Settings } from './settings'

type UploadConf = Pick<Settings, 'imageUploader' | 'picgoUrl' | 'uploadCommand'>

export const uploadEnabled = (s: UploadConf) => s.imageUploader !== 'none'

async function launchPicgoAndRetry(post: () => Promise<Response>): Promise<Response> {
  if (process.platform !== 'darwin') throw new Error('无法连接 PicGo，请确认 PicGo 已运行且已开启 Server')
  await new Promise<void>((resolve, reject) =>
    execFile('open', ['-g', '-a', 'PicGo'], (err) =>
      err ? reject(new Error('无法连接 PicGo，且未能自动启动 PicGo.app，请手动打开 PicGo 并开启 Server')) : resolve(),
    ),
  )
  let last: unknown
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500))
    try {
      return await post()
    } catch (err) {
      last = err
    }
  }
  throw new Error(`已启动 PicGo 但连接不上它的 Server，请在 PicGo 设置里开启 Server 并核对端口：${(last as Error).message}`)
}

/** 把本地图片文件上传到图床，返回图片 URL */
export async function uploadFile(file: string, s: UploadConf): Promise<string> {
  if (s.imageUploader === 'picgo') {
    const post = () =>
      fetch(s.picgoUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ list: [file] }),
        signal: AbortSignal.timeout(90_000),
      })
    let res: Response
    try {
      res = await post()
    } catch {
      // 连不上多半是 PicGo 没在运行（Typora 会自动启动它），这里同样拉起并等待它的 Server 就绪
      res = await launchPicgoAndRetry(post)
    }
    const body = (await res.json().catch(() => ({}))) as { success?: boolean; result?: string[]; message?: string }
    if (!body.success || !body.result?.[0]) {
      throw new Error(`PicGo 上传失败：${body.message ?? `HTTP ${res.status}`}（详见 ~/Library/Application Support/picgo/picgo.log）`)
    }
    return body.result[0]
  }
  if (s.imageUploader === 'command') {
    if (!s.uploadCommand.trim()) throw new Error('未设置上传命令')
    const out = await new Promise<string>((resolve, reject) => {
      exec(`${s.uploadCommand} "${file}"`, { timeout: 60_000 }, (err, stdout, stderr) =>
        err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout),
      )
    })
    // 与 Typora 一致：取输出里最后一个 URL
    const urls = out.match(/https?:\/\/\S+/g)
    if (!urls) throw new Error(`上传命令没有输出图片 URL：${out.trim() || '（空）'}`)
    return urls[urls.length - 1]
  }
  throw new Error('未启用图床')
}

/** 上传内存中的图片 */
export async function uploadBytes(bytes: Uint8Array, ext: string, s: UploadConf): Promise<string> {
  const tmp = path.join(os.tmpdir(), `itypora-upload-${Date.now()}.${ext}`)
  await fs.writeFile(tmp, bytes)
  try {
    return await uploadFile(tmp, s)
  } finally {
    fs.unlink(tmp).catch(() => {})
  }
}

const IMG = /!\[([^\]]*)\]\(\s*(<[^>]+>|[^\s)]+)((?:\s+"[^"]*")?)\s*\)/g

/** 把 Markdown 里的本地图片全部上传并替换为 URL。返回新文本与结果统计。 */
export async function uploadLocalImages(
  markdown: string,
  docDir: string | null,
  s: UploadConf,
): Promise<{ markdown: string; uploaded: number; failed: string[] }> {
  const cache = new Map<string, string>()
  const failed: string[] = []
  let uploaded = 0
  const jobs: Promise<void>[] = []
  for (const m of markdown.matchAll(IMG)) {
    const raw = m[2].replace(/^<|>$/g, '')
    if (/^(https?:|data:)/i.test(raw) || cache.has(raw)) continue
    let file: string
    try {
      file = raw.startsWith('file://') ? fileURLToPath(raw) : decodeURIComponent(raw)
    } catch {
      continue
    }
    if (!path.isAbsolute(file)) {
      if (!docDir) continue
      file = path.join(docDir, file)
    }
    cache.set(raw, '')
    jobs.push(
      fs
        .access(file)
        .then(() => uploadFile(file, s))
        .then((url) => {
          cache.set(raw, url)
          uploaded++
        })
        .catch((err) => void failed.push(`${path.basename(file)}：${(err as Error).message}`)),
    )
  }
  for (let i = 0; i < jobs.length; i += 4) await Promise.all(jobs.slice(i, i + 4))
  const out = markdown.replace(IMG, (all, alt, src, title) => {
    const url = cache.get(src.replace(/^<|>$/g, ''))
    return url ? `![${alt}](${url}${title})` : all
  })
  return { markdown: out, uploaded, failed }
}
