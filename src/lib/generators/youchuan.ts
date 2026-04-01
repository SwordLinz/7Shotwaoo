/**
 * 悠船开放平台 (Youchuan) 文生图
 * @see https://tob.youchuan.cn/docs/apis/api_list
 */

import { logInfo as _ulogInfo, logWarn as _ulogWarn } from '@/lib/logging/core'
import { BaseImageGenerator, type GenerateResult, type ImageGenerateParams } from './base'
import { getProviderConfig } from '@/lib/api-config'
import { setProxy } from '../../../lib/prompts/proxy'

const DEFAULT_YOUCUAN_BASE = 'https://ali.youchuan.cn'

export function getYouchuanApiBase(): string {
  const raw = typeof process.env.YOUCUAN_API_BASE === 'string' ? process.env.YOUCUAN_API_BASE.trim() : ''
  return raw || DEFAULT_YOUCUAN_BASE
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null) {
    const candidate = (error as { message?: unknown }).message
    if (typeof candidate === 'string') return candidate
  }
  return '未知错误'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const YOUCUAN_AR_TOKEN_RE = /--ar\b/i
const YOUCUAN_Q_TOKEN_RE = /--q\b/i

/** 悠船 TOB 文生图仅接受 text；宽高比与画质通过提示词后缀传入（见官方参数列表）。 */
export function applyYouchuanTobPromptSuffixes(
  prompt: string,
  opts?: { aspectRatio?: string; resolution?: string },
): string {
  let out = prompt.trim()
  if (!out) return out

  if (opts?.aspectRatio) {
    const ar = normalizeYouchuanAspectRatio(opts.aspectRatio)
    if (ar && !YOUCUAN_AR_TOKEN_RE.test(out)) {
      out = `${out} --ar ${ar}`
    }
  }

  if (opts?.resolution) {
    const q = mapResolutionToYouchuanQ(opts.resolution)
    if (q !== null && !YOUCUAN_Q_TOKEN_RE.test(out)) {
      out = `${out} --q ${q}`
    }
  }

  return out
}

function normalizeYouchuanAspectRatio(raw: string): string | null {
  const compact = raw.trim().replace(/×/g, 'x').replace(/\s+/g, '')
  if (!compact) return null
  const normalized = compact.replace(/[xX/]/g, ':')
  const m = /^(\d+)\s*:\s*(\d+)$/.exec(normalized)
  if (!m) return null
  return `${m[1]}:${m[2]}`
}

function mapResolutionToYouchuanQ(resolution: string): string | null {
  const t = resolution.trim().toLowerCase()
  if (!t) return null
  if (['0.25', '0.5', '1', '2'].includes(t)) return t
  if (t === '1k' || t === '2k') return '1'
  if (t === '4k') return '2'
  return null
}

export class YouchuanImageGenerator extends BaseImageGenerator {
  protected async doGenerate(params: ImageGenerateParams): Promise<GenerateResult> {
    const { userId, prompt, referenceImages = [], options } = params
    const promptTrimmed = typeof prompt === 'string' ? prompt.trim() : ''
    if (!promptTrimmed) {
      return { success: false, error: '提示词不能为空' }
    }
    const text = applyYouchuanTobPromptSuffixes(promptTrimmed, {
      aspectRatio: typeof options?.aspectRatio === 'string' ? options.aspectRatio : undefined,
      resolution: typeof options?.resolution === 'string' ? options.resolution : undefined,
    })

    if (referenceImages.length > 0) {
      _ulogWarn('[Youchuan] 当前仅支持文生图，已忽略参考图')
    }

    const config = await getProviderConfig(userId, 'youchuan')
    const appId = (config.apiAppId || '').trim()
    const secret = config.apiKey.trim()

    await setProxy()
    const base = getYouchuanApiBase().replace(/\/+$/, '')
    const url = `${base}/v1/tob/diffusion`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-youchuan-app': appId,
        'x-youchuan-secret': secret,
      },
      body: JSON.stringify({
        text,
        callback: '',
      }),
      signal: AbortSignal.timeout(120_000),
    })

    const rawText = await response.text().catch(() => '')
    if (!response.ok) {
      let detail = rawText.slice(0, 400)
      try {
        const errJson = JSON.parse(rawText) as unknown
        if (isRecord(errJson)) {
          const msg = typeof errJson.message === 'string' ? errJson.message.trim() : ''
          const reason = typeof errJson.reason === 'string' ? errJson.reason.trim() : ''
          detail = [msg, reason].filter(Boolean).join(' — ') || detail
        }
      } catch {
        /* keep raw */
      }
      return {
        success: false,
        error: `悠船文生图失败 (${response.status}): ${detail}`,
      }
    }

    let data: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(rawText) as unknown
      if (isRecord(parsed)) data = parsed
    } catch {
      return { success: false, error: '悠船返回非 JSON 响应' }
    }

    const jobId = typeof data.id === 'string' ? data.id.trim() : ''
    if (!jobId) {
      return { success: false, error: '悠船未返回任务 id' }
    }

    _ulogInfo(`[Youchuan] 任务已提交 jobId=${jobId}`)
    return {
      success: true,
      async: true,
      externalId: `YOUCHUAN:IMAGE:${jobId}`,
      requestId: jobId,
    }
  }
}

export async function fetchYouchuanJobStatus(
  userId: string,
  jobId: string,
): Promise<PollStyleResult> {
  const config = await getProviderConfig(userId, 'youchuan')
  const appId = typeof config.apiAppId === 'string' ? config.apiAppId.trim() : ''
  const secret = config.apiKey.trim()
  if (!appId || !secret) {
    return { kind: 'failed', error: '悠船凭证不完整' }
  }

  await setProxy()
  const base = getYouchuanApiBase().replace(/\/+$/, '')
  const url = `${base}/v1/tob/job/${encodeURIComponent(jobId)}`

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'x-youchuan-app': appId,
      'x-youchuan-secret': secret,
    },
    signal: AbortSignal.timeout(30_000),
  })

  const rawText = await response.text().catch(() => '')
  if (!response.ok) {
    let detail = rawText.slice(0, 300)
    try {
      const errJson = JSON.parse(rawText) as unknown
      if (isRecord(errJson)) {
        const msg = typeof errJson.message === 'string' ? errJson.message.trim() : ''
        if (msg) detail = msg
      }
    } catch {
      /* keep */
    }
    if (response.status === 404) {
      return { kind: 'failed', error: `任务不存在: ${jobId}` }
    }
    return { kind: 'failed', error: `查询任务失败 (${response.status}): ${detail}` }
  }

  let data: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(rawText) as unknown
    if (isRecord(parsed)) data = parsed
  } catch {
    return { kind: 'failed', error: '任务查询返回非 JSON' }
  }

  const statusNum = typeof data.status === 'number' ? data.status : Number.NaN
  const comment = typeof data.comment === 'string' ? data.comment.trim() : ''

  // 文档示例: 1=执行中, 2=成功；其它视为失败或待定
  if (statusNum === 1) {
    return { kind: 'pending' }
  }

  if (statusNum === 2) {
    const picked = pickYouchuanOutputUrl(data.urls, data.audits)
    if ('error' in picked) {
      return { kind: 'failed', error: picked.error }
    }
    return { kind: 'completed', url: picked.url }
  }

  if (Number.isFinite(statusNum) && statusNum !== 1 && statusNum !== 2) {
    return { kind: 'failed', error: comment || `悠船任务失败 (status=${statusNum})` }
  }

  return { kind: 'pending' }
}

export type PollStyleResult =
  | { kind: 'pending' }
  | { kind: 'completed'; url: string }
  | { kind: 'failed'; error: string }

export function pickYouchuanOutputUrl(urls: unknown, audits: unknown): { url: string } | { error: string } {
  if (!Array.isArray(urls)) {
    return { error: '响应中缺少 urls' }
  }
  const auditArr = Array.isArray(audits) ? audits : []

  for (let i = 0; i < urls.length; i += 1) {
    const u = urls[i]
    if (typeof u !== 'string' || !u.trim().startsWith('http')) continue
    const auditRaw = i < auditArr.length ? auditArr[i] : ''
    const audit = typeof auditRaw === 'string' ? auditRaw.trim() : ''
    if (audit) {
      return { error: `内容审核未通过: ${audit}` }
    }
    return { url: u.trim() }
  }

  return { error: '未返回可用图片 URL' }
}

export async function probeYouchuanCredentials(appId: string, secret: string): Promise<{ ok: boolean; message: string; detail?: string }> {
  const id = appId.trim()
  const key = secret.trim()
  if (!id || !key) {
    return { ok: false, message: '请同时填写机构标识与授权码' }
  }

  try {
    await setProxy()
    const base = getYouchuanApiBase().replace(/\/+$/, '')
    const url = `${base}/v1/tob/subscribe`
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-youchuan-app': id,
        'x-youchuan-secret': key,
      },
      signal: AbortSignal.timeout(20_000),
    })
    const raw = await response.text().catch(() => '')
    if (response.ok) {
      return { ok: true, message: '悠船账户接口校验通过' }
    }
    if (response.status === 401) {
      return { ok: false, message: '鉴权失败 (401)，请检查机构标识与授权码', detail: raw.slice(0, 400) }
    }
    if (response.status === 403) {
      return { ok: false, message: '无有效套餐或权限不足 (403)', detail: raw.slice(0, 400) }
    }
    return {
      ok: false,
      message: `账户接口返回 ${response.status}`,
      detail: raw.slice(0, 400),
    }
  } catch (error: unknown) {
    return { ok: false, message: getErrorMessage(error) }
  }
}
