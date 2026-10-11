export interface OutlineItem {
  level: number
  text: string
  pos: number
}

interface NodeLike {
  type: { name: string }
  attrs: Record<string, any>
  textContent: string
}

/** 取文档顶层的标题节点，pos 即该节点在文档中的位置 */
export function extractOutline(doc: { forEach(cb: (node: NodeLike, offset: number) => void): void }): OutlineItem[] {
  const items: OutlineItem[] = []
  doc.forEach((node, offset) => {
    if (node.type.name === 'heading' && node.textContent.trim()) {
      items.push({ level: Number(node.attrs.level) || 1, text: node.textContent.trim(), pos: offset })
    }
  })
  return items
}
