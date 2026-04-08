import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
/**
 * KlingAI (可灵) 视频生成器
 *
 * 支持模型：kling-video-o1、kling-v3-omni（omni-video 统一端点）
 *
 * 可灵官方网关（api-beijing.klingai.com）路径：
 * - POST /v1/videos/omni-video       (O1 / V3-Omni 新端点)
 * - GET  /v1/videos/omni-video/{task_id}
 * - POST /v1/videos/image2video       (旧模型 kling-v1~v3 兼容)
 * - GET  /v1/videos/image2video/{task_id}
 *
 * 认证：AccessKey + SecretKey → HS256 JWT → Bearer Token
 */

import { BaseVideoGenerator, type GenerateResult, type VideoGenerateParams } from './base'
import { getProviderConfig } from '@/lib/api-config'
import { signKlingJwt } from './kling-jwt'
import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'
import { sanitizeVideoRatioForKling } from '@/lib/media/safe-aspect-ratio'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type KlingMode = 'std' | 'pro'

interface KlingImageItem {
  image_url: string
  type?: 'first_frame' | 'end_frame'
}

interface KlingVideoItem {
  video_url: string
  refer_type?: 'feature' | 'base'
  keep_original_sound?: 'yes' | 'no'
}

interface KlingShotPrompt {
  index: number
  prompt: string
  duration: string
}

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

  imageMode?: 'first_frame' | 'reference'
  referenceImageUrls?: string[]
  sound?: 'on' | 'off'
  multiShot?: boolean
  multi_shot?: boolean
  shotType?: string
  shot_type?: string
  multiPrompt?: KlingShotPrompt[]
  multi_prompt?: KlingShotPrompt[]
  videoUrl?: string
  video_url?: string
  videoReferType?: 'feature' | 'base'
  video_refer_type?: 'feature' | 'base'
  keepOriginalSound?: 'yes' | 'no'
  keep_original_sound?: 'yes' | 'no'

  [key: string]: unknown
}

interface KlingCreateResponse {
  task_id?: string
  status?: string
  data?: { task_id?: string; status?: string }
  error?: { message?: string; code?: unknown }
}

// ---------------------------------------------------------------------------
// Constants & Helpers
// ---------------------------------------------------------------------------

const KLING_OMNI_VIDEO_PATH = '/v1/videos/omni-video'
export const KLING_VIDEO_IMAGE2VIDEO_PATH = '/v1/videos/image2video'

const OMNI_MODELS = new Set(['kling-video-o1', 'kling-v3-omni'])

/** Pick the correct API path based on model name. */
export function pickKlingApiPath(modelId: string | undefined): string {
  if (modelId && OMNI_MODELS.has(modelId)) return KLING_OMNI_VIDEO_PATH
  return KLING_VIDEO_IMAGE2VIDEO_PATH
}

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

export function normalizeKlingBaseUrl(raw: string | undefined): string {
  let base = (raw || '').trim().replace(/\/+$/, '')
  if (/\/kling$/i.test(base)) {
    base = base.replace(/\/kling$/i, '').replace(/\/+$/, '')
  }
  return base || 'https://api-beijing.klingai.com'
}

function pickFirst<T>(...values: Array<T | undefined>): T | undefined {
  for (const v of values) if (v !== undefined) return v
  return undefined
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** Strip data URI prefix — the omni-video API requires raw base64 without "data:image/...;base64," */
function stripDataUriPrefix(value: string): string {
  const idx = value.indexOf(';base64,')
  if (idx !== -1) return value.slice(idx + 8)
  return value
}

/**
 * Build a Bearer token from the Kling provider config.
 * Uses AccessKey (apiAppId) + SecretKey (apiKey) to sign a JWT.
 */
export function buildKlingBearerToken(apiKey: string, apiAppId?: string): string {
  if (apiAppId) {
    return signKlingJwt(apiAppId, apiKey)
  }
  return apiKey
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export class KlingVideoGenerator extends BaseVideoGenerator {
  protected async doGenerate(params: VideoGenerateParams): Promise<GenerateResult> {
    const { userId, imageUrl, prompt = '', options = {} } = params
    const optProvider = (options as Record<string, unknown>).provider
    const providerId = typeof optProvider === 'string' && optProvider.trim()
      ? optProvider.trim()
      : 'kling'
    const config = await getProviderConfig(userId, providerId)
    const endpointBase = normalizeKlingBaseUrl(config.baseUrl)
    const bearerToken = buildKlingBearerToken(config.apiKey, config.apiAppId)

    const raw = options as KlingVideoOptions
    const modelId = (raw.modelId || raw.model || (options as Record<string, unknown>).modelId) as string | undefined
    const duration = typeof raw.duration === 'number' && Number.isFinite(raw.duration) ? raw.duration : undefined
    const aspectRatio = sanitizeVideoRatioForKling(pickFirst(raw.aspectRatio, raw.aspect_ratio))
    const mode: KlingMode | undefined = raw.mode
    const negativePrompt = pickFirst(raw.negativePrompt, raw.negative_prompt)
    const cfgScale = pickFirst(raw.cfgScale, raw.cfg_scale)
    const lastFrameImageUrl = pickFirst(raw.lastFrameImageUrl, raw.image_tail)
    const callbackUrl = pickFirst(raw.callbackUrl, raw.callback_url)
    const generateAudio = (options as Record<string, unknown>).generateAudio
    const sound: 'on' | 'off' | undefined = raw.sound
      ?? (generateAudio === true ? 'on' : generateAudio === false ? 'off' : undefined)
    const multiShot = pickFirst(raw.multiShot, raw.multi_shot)
    const shotType = pickFirst(raw.shotType, raw.shot_type)
    const multiPrompt = pickFirst(raw.multiPrompt, raw.multi_prompt)
    const videoUrl = pickFirst(raw.videoUrl, raw.video_url)
    const videoReferType = pickFirst(raw.videoReferType, raw.video_refer_type)
    const keepOriginalSound = pickFirst(raw.keepOriginalSound, raw.keep_original_sound)
    const imageMode = (raw.imageMode as string) || 'first_frame'
    const referenceImageUrls = raw.referenceImageUrls
      || (typeof raw._referenceImageUrlsJson === 'string'
        ? (() => { try { return JSON.parse(raw._referenceImageUrlsJson) as string[] } catch { return undefined } })()
        : undefined)

    const isOmni = modelId ? OMNI_MODELS.has(modelId) : false
    const apiPath = pickKlingApiPath(modelId)

    // Build request body
    const requestBody: Record<string, unknown> = {}

    if (isOmni) {
      if (isNonEmpty(modelId)) requestBody.model = modelId.trim()

      const imageList: KlingImageItem[] = []

      if (imageMode === 'reference') {
        // Reference mode: images are subject/scene references, no type set.
        // Prompt uses <<<image_1>>>, <<<image_2>>> to reference them.
        const primaryB64 = stripDataUriPrefix(
          imageUrl.startsWith('data:') ? imageUrl : await normalizeToBase64ForGeneration(imageUrl),
        )
        imageList.push({ image_url: primaryB64 })
        if (Array.isArray(referenceImageUrls)) {
          for (const refUrl of referenceImageUrls) {
            if (!isNonEmpty(refUrl)) continue
            const refB64 = stripDataUriPrefix(
              refUrl.startsWith('data:') ? refUrl : await normalizeToBase64ForGeneration(refUrl),
            )
            imageList.push({ image_url: refB64 })
            if (imageList.length >= 7) break
          }
        }
      } else {
        // First-frame mode: primary image is first frame (standard image-to-video)
        const firstFrameB64 = stripDataUriPrefix(
          imageUrl.startsWith('data:') ? imageUrl : await normalizeToBase64ForGeneration(imageUrl),
        )
        imageList.push({ image_url: firstFrameB64, type: 'first_frame' })
        if (isNonEmpty(lastFrameImageUrl)) {
          const tailB64 = stripDataUriPrefix(
            lastFrameImageUrl.startsWith('data:') ? lastFrameImageUrl : await normalizeToBase64ForGeneration(lastFrameImageUrl),
          )
          imageList.push({ image_url: tailB64, type: 'end_frame' })
        }
      }

      requestBody.image_list = imageList

      if (isNonEmpty(prompt) && !multiShot) requestBody.prompt = prompt
      if (isNonEmpty(negativePrompt)) requestBody.negative_prompt = negativePrompt.trim()
      if (typeof duration === 'number') requestBody.duration = String(duration)
      if (isNonEmpty(aspectRatio)) requestBody.aspect_ratio = aspectRatio.trim()
      if (mode === 'std' || mode === 'pro') requestBody.mode = mode
      if (typeof cfgScale === 'number' && Number.isFinite(cfgScale)) requestBody.cfg_scale = cfgScale
      if (isNonEmpty(callbackUrl)) requestBody.callback_url = callbackUrl.trim()

      if (isNonEmpty(videoUrl)) {
        const videoItem: KlingVideoItem = { video_url: videoUrl }
        if (videoReferType) videoItem.refer_type = videoReferType
        if (keepOriginalSound) videoItem.keep_original_sound = keepOriginalSound
        requestBody.video_list = [videoItem]
      }

      if (sound === 'on' || sound === 'off') requestBody.sound = sound

      if (multiShot) {
        requestBody.multi_shot = true
        requestBody.shot_type = shotType || 'customize'
        if (multiPrompt && multiPrompt.length > 0) {
          requestBody.multi_prompt = multiPrompt
        }
      }
    } else {
      // Legacy image2video endpoint: model_name, image (base64)
      const legacyFirstFrame = stripDataUriPrefix(
        imageUrl.startsWith('data:') ? imageUrl : await normalizeToBase64ForGeneration(imageUrl),
      )
      if (isNonEmpty(modelId)) requestBody.model_name = modelId.trim()
      requestBody.image = legacyFirstFrame
      if (isNonEmpty(prompt)) requestBody.prompt = prompt
      if (isNonEmpty(negativePrompt)) requestBody.negative_prompt = negativePrompt.trim()
      if (typeof duration === 'number') requestBody.duration = duration
      if (isNonEmpty(aspectRatio)) requestBody.aspect_ratio = aspectRatio.trim()
      if (mode === 'std' || mode === 'pro') requestBody.mode = mode
      if (typeof cfgScale === 'number' && Number.isFinite(cfgScale)) requestBody.cfg_scale = cfgScale
      if (isNonEmpty(callbackUrl)) requestBody.callback_url = callbackUrl.trim()
      if (isNonEmpty(lastFrameImageUrl)) {
        requestBody.image_tail = lastFrameImageUrl.startsWith('data:')
          ? lastFrameImageUrl
          : await normalizeToBase64ForGeneration(lastFrameImageUrl)
      }
    }

    const createUrl = `${endpointBase}${apiPath}`

    _ulogInfo('[Kling Video] submitting task', {
      baseUrl: endpointBase,
      apiPath,
      model: modelId,
      duration: requestBody.duration,
      aspect_ratio: requestBody.aspect_ratio,
      mode: requestBody.mode,
      sound: requestBody.sound,
    })

    const response = await fetch(createUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearerToken}`,
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

    // Encode model in externalId so polling uses the correct endpoint
    const externalId = isOmni
      ? `KLING:OMNI:${taskId}`
      : `KLING:VIDEO:${taskId}`
    return {
      success: true,
      async: true,
      requestId: taskId,
      externalId,
    }
  }
}
