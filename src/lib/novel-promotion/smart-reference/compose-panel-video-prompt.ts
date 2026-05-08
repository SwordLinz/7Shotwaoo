/**
 * 智能参考分镜：将镜头元数据与画面描述组合为与分镜阶段一致的「视频提示词」骨架，
 * 与 {@link NovelPromotionPanel#videoPrompt} 对应，供 API / worker 使用。
 */
export interface ComposeSmartRefPanelParts {
  shotType?: string | null
  cameraMove?: string | null
  description?: string | null
}

export function composeSmartRefPanelVideoPrompt(parts: ComposeSmartRefPanelParts): string {
  const st = typeof parts.shotType === 'string' ? parts.shotType.trim() : ''
  const cm = typeof parts.cameraMove === 'string' ? parts.cameraMove.trim() : ''
  const desc = typeof parts.description === 'string' ? parts.description.trim() : ''

  const lines: string[] = []
  if (st) {
    lines.push(`镜头类型：${st}。`)
  }
  if (cm) {
    lines.push(`镜头运动：${cm}。`)
  }
  if (desc) {
    lines.push(desc)
  }
  return lines.join('\n').trim()
}

export function smartRefVideoPromptMatchesComposed(
  videoPrompt: string | null | undefined,
  parts: ComposeSmartRefPanelParts,
): boolean {
  const v = (videoPrompt ?? '').trim()
  const c = composeSmartRefPanelVideoPrompt(parts)
  if (!v && !c) return true
  return v === c
}
