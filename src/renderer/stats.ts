const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/g

export interface Stats {
  words: number
  chars: number
  minutes: number
}

/** CJK 每个字算一个词，其余按空白分词（与 Typora 的统计口径一致） */
export function countStats(text: string): Stats {
  const cjk = text.match(CJK)?.length ?? 0
  const latin = text.replace(CJK, ' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
  const words = cjk + latin
  return {
    words,
    chars: text.replace(/\s/g, '').length,
    minutes: words ? Math.max(1, Math.round(words / 300)) : 0,
  }
}
