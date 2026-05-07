import {
  assertOfficialModelRegistered,
  type OfficialModelModality,
} from '@/lib/providers/official/model-registry'
import { getProviderConfig } from '@/lib/api-config'
import type { GenerateResult } from '@/lib/generators/base'
import { toFetchableUrl } from '@/lib/storage/utils'
import { ensureBailianCatalogRegistered } from './catalog'
import type { BailianGenerateRequestOptions } from './types'

export interface BailianVideoGenerateParams {
  userId: string
  imageUrl?: string
  prompt?: string
  options: BailianGenerateRequestOptions
}

function assertRegistered(modelId: string): void {
  ensureBailianCatalogRegistered()
  assertOfficialModelRegistered({
    provider: 'bailian',
    modality: 'video' satisfies OfficialModelModality,
    modelId,
  })
}

const BAILIAN_VIDEO_ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis'
const BAILIAN_KF2V_ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/image2video/video-synthesis'
const BAILIAN_KF2V_MODELS = new Set([
  'wan2.2-kf2v-flash',
  'wanx2.1-kf2v-plus',
])

interface BailianVideoSubmitResponse {
  request_id?: string
  code?: string
  message?: string
  output?: {
    task_id?: string
    task_status?: string
  }
}

interface BailianVideoSubmitParameters {
  resolution?: string
  size?: string
  watermark?: boolean
  prompt_extend?: boolean
  duration?: number
}

interface BailianVideoSubmitBody {
  model: string
  input: Record<string, unknown>
  parameters?: BailianVideoSubmitParameters
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function readOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`BAILIAN_VIDEO_OPTION_INVALID_${fieldName.toUpperCase()}`)
  }
  return value
}

function isKf2vModel(modelId: string): boolean {
  return BAILIAN_KF2V_MODELS.has(modelId)
}

function isHappyHorseModel(modelId: string): boolean {
  return modelId.startsWith('happyhorse-1.0-')
}

function resolveAuthorizationHeader(apiKeyRaw: string): string {
  const trimmed = readTrimmedString(apiKeyRaw)
  if (!trimmed) return ''
  if (/^Bearer\s+/i.test(trimmed)) return trimmed
  return `Bearer ${trimmed}`
}

function assertNoUnsupportedOptions(options: BailianGenerateRequestOptions): void {
  const allowedOptionKeys = new Set([
    'provider',
    'modelId',
    'modelKey',
    'prompt',
    'resolution',
    'size',
    'watermark',
    'promptExtend',
    'duration',
    'ratio',
    'aspectRatio',
    'aspect_ratio',
    'seed',
    'lastFrameImageUrl',
    'videoUrl',
    'referenceImageUrls',
    'audioSetting',
  ])
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue
    if (!allowedOptionKeys.has(key)) {
      throw new Error(`BAILIAN_VIDEO_OPTION_UNSUPPORTED: ${key}`)
    }
  }
}

function buildSubmitRequest(params: BailianVideoGenerateParams): {
  endpoint: string
  body: BailianVideoSubmitBody
} {
  const modelId = readTrimmedString(params.options.modelId)
  if (!modelId) {
    throw new Error('BAILIAN_VIDEO_MODEL_ID_REQUIRED')
  }
  const happyHorse = isHappyHorseModel(modelId)
  const imageUrl = readTrimmedString(params.imageUrl)
  const prompt = readTrimmedString(params.prompt) || readTrimmedString(params.options.prompt)
  if (!happyHorse && !imageUrl) {
    throw new Error('BAILIAN_VIDEO_IMAGE_URL_REQUIRED')
  }

  const kf2v = isKf2vModel(modelId)
  const lastFrameImageUrl = readTrimmedString(params.options.lastFrameImageUrl)
  if (kf2v && !lastFrameImageUrl) {
    throw new Error('BAILIAN_VIDEO_LAST_FRAME_IMAGE_URL_REQUIRED')
  }
  if (!kf2v && lastFrameImageUrl) {
    throw new Error(`BAILIAN_VIDEO_LAST_FRAME_UNSUPPORTED_FOR_MODEL: ${modelId}`)
  }

  const resolution = readTrimmedString(params.options.resolution)
  const size = readTrimmedString(params.options.size)
  const ratio = readTrimmedString(params.options.ratio)
    || readTrimmedString(params.options.aspectRatio)
    || readTrimmedString(params.options.aspect_ratio)
  const seed = readOptionalPositiveInteger(params.options.seed, 'seed')
  const watermark = readOptionalBoolean(params.options.watermark)
  const promptExtend = readOptionalBoolean(params.options.promptExtend)
  const duration = readOptionalPositiveInteger(params.options.duration, 'duration')
  const videoUrl = readTrimmedString(params.options.videoUrl)
  const referenceImageUrls = Array.isArray(params.options.referenceImageUrls)
    ? params.options.referenceImageUrls
      .map((value) => readTrimmedString(value))
      .filter((value) => !!value)
    : []

  const submitBody: BailianVideoSubmitBody = {
    model: modelId,
    input: {},
  }
  if (happyHorse) {
    if (modelId === 'happyhorse-1.0-t2v') {
      if (!prompt) throw new Error('BAILIAN_VIDEO_PROMPT_REQUIRED')
      submitBody.input = { prompt }
    } else if (modelId === 'happyhorse-1.0-i2v') {
      if (!imageUrl) throw new Error('BAILIAN_VIDEO_IMAGE_URL_REQUIRED')
      submitBody.input = {
        ...(prompt ? { prompt } : {}),
        media: [{ type: 'first_frame', url: toFetchableUrl(imageUrl) }],
      }
    } else if (modelId === 'happyhorse-1.0-r2v') {
      if (!prompt) throw new Error('BAILIAN_VIDEO_PROMPT_REQUIRED')
      const media = referenceImageUrls.length > 0
        ? referenceImageUrls.map((url) => ({ type: 'reference_image', url: toFetchableUrl(url) }))
        : imageUrl
          ? [{ type: 'reference_image', url: toFetchableUrl(imageUrl) }]
          : []
      if (media.length < 1) {
        throw new Error('BAILIAN_VIDEO_REFERENCE_IMAGE_REQUIRED')
      }
      submitBody.input = { prompt, media }
    } else if (modelId === 'happyhorse-1.0-video-edit') {
      if (!prompt) throw new Error('BAILIAN_VIDEO_PROMPT_REQUIRED')
      if (!videoUrl) throw new Error('BAILIAN_VIDEO_SOURCE_VIDEO_URL_REQUIRED')
      const media = [{ type: 'video', url: toFetchableUrl(videoUrl) }]
      if (imageUrl) media.push({ type: 'reference_image', url: toFetchableUrl(imageUrl) })
      for (const refUrl of referenceImageUrls) {
        media.push({ type: 'reference_image', url: toFetchableUrl(refUrl) })
      }
      submitBody.input = { prompt, media }
    } else {
      throw new Error(`BAILIAN_VIDEO_MODEL_UNSUPPORTED: ${modelId}`)
    }
  } else {
    const firstFrameUrl = toFetchableUrl(imageUrl)
    submitBody.input = kf2v
      ? {
        first_frame_url: firstFrameUrl,
        last_frame_url: toFetchableUrl(lastFrameImageUrl),
      }
      : {
        img_url: firstFrameUrl,
      }
    if (prompt) {
      submitBody.input.prompt = prompt
    }
  }

  const submitParameters: BailianVideoSubmitParameters = {}
  if (resolution) {
    submitParameters.resolution = resolution
  }
  if (size) {
    submitParameters.size = size
  }
  if (typeof watermark === 'boolean') {
    submitParameters.watermark = watermark
  }
  if (typeof promptExtend === 'boolean') {
    submitParameters.prompt_extend = promptExtend
  }
  if (typeof duration === 'number') {
    submitParameters.duration = duration
  }
  if (ratio) {
    submitParameters.size = ratio
  }
  if (typeof seed === 'number') {
    ;(submitParameters as Record<string, unknown>).seed = seed
  }
  if (happyHorse && modelId === 'happyhorse-1.0-video-edit') {
    const audioSetting = readTrimmedString(params.options.audioSetting)
    if (audioSetting) {
      ;(submitParameters as Record<string, unknown>).audio_setting = audioSetting
    }
  }
  if (Object.keys(submitParameters).length > 0) {
    submitBody.parameters = submitParameters
  }

  return {
    endpoint: happyHorse ? BAILIAN_VIDEO_ENDPOINT : (kf2v ? BAILIAN_KF2V_ENDPOINT : BAILIAN_VIDEO_ENDPOINT),
    body: submitBody,
  }
}

async function parseSubmitResponse(response: Response): Promise<BailianVideoSubmitResponse> {
  const raw = await response.text()
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('BAILIAN_VIDEO_RESPONSE_INVALID')
    }
    return parsed as BailianVideoSubmitResponse
  } catch {
    throw new Error('BAILIAN_VIDEO_RESPONSE_INVALID_JSON')
  }
}

export async function generateBailianVideo(params: BailianVideoGenerateParams): Promise<GenerateResult> {
  assertRegistered(params.options.modelId)
  assertNoUnsupportedOptions(params.options)

  const { apiKey } = await getProviderConfig(params.userId, params.options.provider)
  const authorization = resolveAuthorizationHeader(apiKey)
  if (!authorization) {
    throw new Error('BAILIAN_AUTH_MISSING')
  }
  const submitRequest = buildSubmitRequest(params)
  const response = await fetch(submitRequest.endpoint, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify(submitRequest.body),
  })
  const data = await parseSubmitResponse(response)

  if (!response.ok) {
    const code = readTrimmedString(data.code)
    const message = readTrimmedString(data.message)
    throw new Error(`BAILIAN_VIDEO_SUBMIT_FAILED(${response.status}): ${code || message || 'unknown error'}`)
  }

  const taskId = readTrimmedString(data.output?.task_id)
  if (!taskId) {
    throw new Error('BAILIAN_VIDEO_TASK_ID_MISSING')
  }

  return {
    success: true,
    async: true,
    requestId: taskId,
    externalId: `BAILIAN:VIDEO:${taskId}`,
  }
}
