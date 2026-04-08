/**
 * 画面比例安全归一化
 *
 * 各上游视频/图像 API 对 aspect_ratio 有不同白名单。
 * 在调用前统一映射到该 API 可接受的最近比例，避免参数报错。
 */

/* ── 各 API 支持的比例白名单 ──────────────────────────────────── */

/** Kling (v2 Omni / v1 Legacy) */
const KLING_RATIOS = new Set([
  '16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3',
])

/** RunningHub OpenAPI / 超能 AI App */
const RUNNINGHUB_RATIOS = new Set([
  'adaptive', '16:9', '9:16', '4:3', '3:4', '1:1', '3:2', '2:3',
])

/** 豆包 Seedance / Bailian 视频 */
const DOUBAO_VIDEO_RATIOS = new Set([
  '16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3',
])

/** 图像/视频生成通用安全比例 */
const UNIVERSAL_SAFE_RATIOS = new Set([
  '16:9', '9:16', '1:1', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4',
])

/* ── 回退映射表（不安全比例 → 最接近的安全比例） ───────────────── */

const FALLBACK_MAP: Record<string, string> = {
  '21:9': '16:9',
  '5:4': '4:3',
  '4:5': '3:4',
}

function normalizeKey(ratio: string | null | undefined): string {
  return (ratio || '').trim().toLowerCase()
}

function resolveClosest(ratio: string, allowedSet: Set<string>, fallback: string): string {
  if (allowedSet.has(ratio)) return ratio
  const mapped = FALLBACK_MAP[ratio]
  if (mapped && allowedSet.has(mapped)) return mapped
  return fallback
}

/* ── 对外导出 ─────────────────────────────────────────────────── */

/**
 * 通用安全归一化（图像/视频 API 通用）
 * 21:9 → 16:9，未知 → 16:9
 */
export function sanitizeVideoRatioForApis(ratio: string | null | undefined): string {
  const key = normalizeKey(ratio)
  if (!key) return '16:9'
  return resolveClosest(key, UNIVERSAL_SAFE_RATIOS, '16:9')
}

/**
 * RunningHub（含 SparkVideo / 超能 AI App）
 */
export function sanitizeVideoRatioForRunningHub(ratio: string | null | undefined): string {
  const key = normalizeKey(ratio)
  if (!key) return 'adaptive'
  return resolveClosest(key, RUNNINGHUB_RATIOS, 'adaptive')
}

/**
 * Kling (O1 / V2 / Legacy)
 */
export function sanitizeVideoRatioForKling(ratio: string | null | undefined): string {
  const key = normalizeKey(ratio)
  if (!key) return '16:9'
  return resolveClosest(key, KLING_RATIOS, '16:9')
}

/**
 * 豆包 Seedance / Bailian 视频
 */
export function sanitizeVideoRatioForDoubao(ratio: string | null | undefined): string {
  const key = normalizeKey(ratio)
  if (!key) return '16:9'
  return resolveClosest(key, DOUBAO_VIDEO_RATIOS, '16:9')
}

export function isUniversalSafeVideoRatio(ratio: string | null | undefined): boolean {
  const key = normalizeKey(ratio)
  return key !== '' && UNIVERSAL_SAFE_RATIOS.has(key)
}
