export const UPSTREAM_COPYRIGHT_BLOCK_MESSAGE = '上游版权风控拦截'

function toLowerText(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function isUpstreamCopyrightRestrictionCode(value: unknown): boolean {
  const lower = toLowerText(value)
  if (!lower) return false
  return (
    lower.includes('outputvideosensitivecontentdetected')
    || lower.includes('inputimagesensitivecontentdetected')
    || lower.includes('copyrightrestriction')
  )
}

export function isUpstreamCopyrightRestrictionMessage(value: unknown): boolean {
  const lower = toLowerText(value)
  if (!lower) return false
  return (
    lower.includes('copyright restrictions')
    || lower.includes('copyright restriction')
    || lower.includes('may be related to copyright')
    || lower.includes('outputvideosensitivecontentdetected')
    || lower.includes('inputimagesensitivecontentdetected')
  )
}

export function getUpstreamCopyrightRestrictionUserMessage(input?: {
  code?: unknown
  message?: unknown
} | null): string | null {
  if (!input) return null
  if (
    isUpstreamCopyrightRestrictionCode(input.code)
    || isUpstreamCopyrightRestrictionMessage(input.message)
  ) {
    return UPSTREAM_COPYRIGHT_BLOCK_MESSAGE
  }
  return null
}
