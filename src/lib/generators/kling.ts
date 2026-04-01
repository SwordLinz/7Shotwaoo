import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
/**
 * KlingAI (可灵) 视频生成器（图生视频）
 *
 * 可灵官方网关（api-beijing.klingai.com）路径：
 * - POST /v1/videos/image2video
 * - GET  /v1/videos/image2video/{task_id}
 *
 * 说明：带 /kling 前缀的路径多为三方聚合网关，直连官方会得到 404。
 *
 * 认证：Authorization: Bearer <API Token>
 */

import { BaseVideoGenerator, type GenerateResult, type VideoGenerateParams } from './base'
import { getProviderConfig } from '@/lib/api-config'
import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'

type KlingMode = 'std' | 'pro'

interface KlingVideoOptions {
  modelId?: string
  model?: string
  duration?: number
  aspectRatio?: string
  aspect_ratio?: string
  mode?: KlingMode
  prompt?: string
  negativePrompt?: string
  negative_prompt?: string
  cfgScale?: number
  cfg_scale?: number
  lastFrameImageUrl?: string
  image_tail?: string
  callbackUrl?: string
  callback_url?: string
  [key: string]: unknown
}

interface KlingCreateResponse {
  task_id?: string
  status?: string
  data?: { task_id?: string; status?: string }
  error?: { message?: string; code?: unknown }
}

const KLING_VIDEO_IMAGE2VIDEO_PATH = '/v1/videos/image2video'

function readKlingTaskIdFromCreateBody(data: Record<string, unknown>): string {
  const top = data.task_id
  if (typeof top === 'string' && top.trim()) return top.trim()
  const nested = data.data
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const inner = (nested as Record<string, unknown>).task_id
    if (typeof inner === 'string' && inner.trim()) return inner.trim()
  }
  return ''
}

function normalizeBaseUrl(raw: string | undefined): string {
  let base = (raw || '').trim().replace(/\/+$/, '')
  if (/\/kling$/i.test(base)) {
    base = base.replace(/\/kling$/i, '').replace(/\/+$/, '')
  }
  return base || 'https://api-beijing.klingai.com'
}

function pickFirstDefined<T>(...values: Array<T | undefined>): T | undefined {
  for (const value of values) {
    if (value !== undefined) return value
  }
  return undefined
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export class KlingVideoGenerator extends BaseVideoGenerator {
  protected async doGenerate(params: VideoGenerateParams): Promise<GenerateResult> {
    const { userId, imageUrl, prompt = '', options = {} } = params
    const optProvider = (options as Record<string, unknown>).provider
    const providerId = typeof optProvider === 'string' && optProvider.trim()
      ? optProvider.trim()
      : 'kling'
    const { apiKey, baseUrl } = await getProviderConfig(userId, providerId)
    const endpointBase = normalizeBaseUrl(baseUrl)

    const rawOptions = options as KlingVideoOptions
    const modelId = (rawOptions.modelId || rawOptions.model || (options as Record<string, unknown>).modelId) as string | undefined
    const duration = typeof rawOptions.duration === 'number' && Number.isFinite(rawOptions.duration)
      ? rawOptions.duration
      : undefined
    const aspectRatio = pickFirstDefined(rawOptions.aspectRatio, rawOptions.aspect_ratio)
    const mode = rawOptions.mode
    const negativePrompt = pickFirstDefined(rawOptions.negativePrompt, rawOptions.negative_prompt)
    const cfgScale = pickFirstDefined(rawOptions.cfgScale, rawOptions.cfg_scale)
    const lastFrameImageUrl = pickFirstDefined(rawOptions.lastFrameImageUrl, rawOptions.image_tail)
    const callbackUrl = pickFirstDefined(rawOptions.callbackUrl, rawOptions.callback_url)

    const firstFrame = imageUrl.startsWith('data:')
      ? imageUrl
      : await normalizeToBase64ForGeneration(imageUrl)

    const requestBody: Record<string, unknown> = {
      image: firstFrame,
    }
    if (isNonEmptyString(modelId)) requestBody.model = modelId.trim()
    if (isNonEmptyString(prompt)) requestBody.prompt = prompt
    if (isNonEmptyString(negativePrompt)) requestBody.negative_prompt = negativePrompt.trim()
    if (typeof duration === 'number') requestBody.duration = duration
    if (isNonEmptyString(aspectRatio)) requestBody.aspect_ratio = aspectRatio.trim()
    if (mode === 'std' || mode === 'pro') requestBody.mode = mode
    if (typeof cfgScale === 'number' && Number.isFinite(cfgScale)) requestBody.cfg_scale = cfgScale
    if (isNonEmptyString(lastFrameImageUrl)) {
      requestBody.image_tail = lastFrameImageUrl.startsWith('data:')
        ? lastFrameImageUrl
        : await normalizeToBase64ForGeneration(lastFrameImageUrl)
    }
    if (isNonEmptyString(callbackUrl)) requestBody.callback_url = callbackUrl.trim()

    const createUrl = `${endpointBase}${KLING_VIDEO_IMAGE2VIDEO_PATH}`

    _ulogInfo('[Kling Video] submitting task', {
      baseUrl: endpointBase,
      model: requestBody.model,
      duration: requestBody.duration,
      aspect_ratio: requestBody.aspect_ratio,
      mode: requestBody.mode,
    })

    const response = await fetch(createUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(60_000),
    })

    const rawText = await response.text().catch(() => '')
    if (!response.ok) {
      _ulogError('[Kling Video] submit failed', { status: response.status, body: rawText.slice(0, 500) })
      throw new Error(`Kling API Error: ${response.status} ${rawText.slice(0, 200)}`.trim())
    }

    let data: KlingCreateResponse = {}
    if (rawText.trim()) {
      try {
        data = JSON.parse(rawText) as KlingCreateResponse
      } catch {
        data = {}
      }
    }

    const taskId = readKlingTaskIdFromCreateBody(data as Record<string, unknown>)
    if (!taskId) {
      throw new Error('KLING_TASK_ID_MISSING')
    }

    const externalId = `KLING:VIDEO:${taskId}`
    return {
      success: true,
      async: true,
      requestId: taskId,
      externalId,
    }
  }
}

