// 演示模式：全屏逐页放映。← → / 空格 / PageUp PageDown 翻页，Home End 首尾页，Esc 退出。
import type { SlideDeck } from './api'

const LOGICAL = { '16:9': [1280, 720], '4:3': [1024, 768] } as const
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export class Presenter {
  private el: HTMLElement | null = null
  private deck: SlideDeck | null = null
  private index = 0
  private idle: ReturnType<typeof setTimeout> | undefined
  private baseUrl: string | null = null

  constructor(private onExit: () => void) {}

  get active() {
    return !!this.el
  }

  start(deck: SlideDeck, baseUrl: string | null, startAt = 0) {
    this.stop()
    this.deck = deck
    this.baseUrl = baseUrl
    this.index = Math.min(Math.max(0, startAt), deck.pages.length - 1)
    const [w, h] = LOGICAL[deck.size]
    const el = document.createElement('div')
    el.id = 'presenter'
    el.tabIndex = -1
    el.innerHTML = `<div class="stage" style="width:${w}px;height:${h}px"><header></header><section class="slide-body"></section><footer><span class="slide-footer"></span><span class="slide-page"></span></footer></div>`
    document.body.append(el)
    this.el = el
    window.addEventListener('keydown', this.onKey, true)
    window.addEventListener('resize', this.fit)
    el.addEventListener('mousemove', this.wake)
    el.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('a')) this.go(this.index + 1)
    })
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      this.go(this.index - 1)
    })
    el.focus()
    this.render()
    this.fit()
    this.wake()
  }

  stop() {
    if (!this.el) return
    window.removeEventListener('keydown', this.onKey, true)
    window.removeEventListener('resize', this.fit)
    clearTimeout(this.idle)
    this.el.remove()
    this.el = null
    this.onExit()
  }

  private go(i: number) {
    if (!this.deck) return
    const n = Math.min(Math.max(0, i), this.deck.pages.length - 1)
    if (n === this.index) return
    this.index = n
    this.render()
  }

  private render() {
    const el = this.el!
    const deck = this.deck!
    const body = el.querySelector<HTMLElement>('.slide-body')!
    body.innerHTML = deck.pages[this.index]
    // 相对路径的图片按文档所在目录解析
    if (this.baseUrl) {
      for (const img of body.querySelectorAll('img')) {
        const src = img.getAttribute('src') ?? ''
        if (src && !/^[a-z][a-z0-9+.-]*:/i.test(src)) img.src = new URL(src, this.baseUrl).href
      }
    }
    for (const a of body.querySelectorAll('a')) a.target = '_blank'
    el.querySelector('header')!.innerHTML = esc(deck.header)
    el.querySelector('.slide-footer')!.innerHTML = esc(deck.footer)
    el.querySelector('.slide-page')!.textContent = deck.paginate ? `${this.index + 1} / ${deck.pages.length}` : ''
    // 第一页只有标题和一两行文字时居中，做成封面
    const lead = this.index === 0 && body.children.length <= 3 && [...body.children].every((c) => /^(H[1-3]|P)$/.test(c.tagName))
    body.classList.toggle('lead', lead)
    this.shrinkToFit(body)
    body.querySelectorAll('img').forEach((img) => !img.complete && img.addEventListener('load', () => this.shrinkToFit(body), { once: true }))
  }

  /** 内容超出一页时逐步缩小字号，最小到 50% */
  private shrinkToFit(body: HTMLElement) {
    let scale = 1
    body.style.fontSize = ''
    while (scale > 0.5 && (body.scrollHeight > body.clientHeight + 1 || body.scrollWidth > body.clientWidth + 1)) {
      scale -= 0.05
      body.style.fontSize = `${scale}em`
    }
  }

  private fit = () => {
    if (!this.el || !this.deck) return
    const [w, h] = LOGICAL[this.deck.size]
    const s = Math.min(window.innerWidth / w, window.innerHeight / h)
    this.el.querySelector<HTMLElement>('.stage')!.style.transform = `translate(-50%, -50%) scale(${s})`
  }

  /** 鼠标闲置 2.5 秒后隐藏光标 */
  private wake = () => {
    if (!this.el) return
    this.el.classList.remove('idle')
    clearTimeout(this.idle)
    this.idle = setTimeout(() => this.el?.classList.add('idle'), 2500)
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const map: Record<string, () => void> = {
      ArrowRight: () => this.go(this.index + 1),
      ArrowDown: () => this.go(this.index + 1),
      PageDown: () => this.go(this.index + 1),
      ' ': () => this.go(this.index + (e.shiftKey ? -1 : 1)),
      Enter: () => this.go(this.index + 1),
      ArrowLeft: () => this.go(this.index - 1),
      ArrowUp: () => this.go(this.index - 1),
      PageUp: () => this.go(this.index - 1),
      Backspace: () => this.go(this.index - 1),
      Home: () => this.go(0),
      End: () => this.go(this.deck!.pages.length - 1),
      Escape: () => this.stop(),
    }
    const fn = map[e.key]
    if (!fn) return
    e.preventDefault()
    e.stopPropagation()
    fn()
  }
}
