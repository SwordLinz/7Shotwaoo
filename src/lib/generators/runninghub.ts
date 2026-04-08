/**
 * RunningHub OpenAPI v2 视频生成
 *
 * 支持两种模式：
 * A) 标准模型 API（如 rhart-video/sparkvideo-2.0/image-to-video）
 *    → 扁平 body: { firstFrameUrl, prompt, resolution, ... }
 * B) AI 应用接口（如 run/ai-app/{appId}）
 *    → nodeInfoList body: { nodeInfoList: [...], instanceType, ... }
 *
 * 参考：https://www.runninghub.cn/openapi/v2
 */

import { logError as _ulogError, logInfo as _ulogInfo } from '@/lib/logging/core'
import { BaseVideoGenerator, type GenerateResult, type VideoGenerateParams } from './base'
import { getProviderConfig } from '@/lib/api-config'
import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'
import { sanitizeVideoRatioForRunningHub } from '@/lib/media/safe-aspect-ratio'

const DEFAULT_BASE = 'https://www.runninghub.cn/openapi/v2'

/* ── Standard model endpoints ────────────────────────────────── */
const DEFAULT_SPARKVIDEO_I2V_ENDPOINT = 'rhart-video/sparkvideo-2.0/image-to-video'
const FAST_SPARKVIDEO_I2V_ENDPOINT = 'rhart-video/sparkvideo-2.0-fast/image-to-video'

/* ── AI App endpoints (nodeInfoList 模式) ────────────────────── */
const CHAONENG_REALPEOPLE_APP_ID = '2037365179167543298'
const CHAONENG_REALPEOPLE_ENDPOINT = `run/ai-app/${CHAONENG_REALPEOPLE_APP_ID}`

const MODEL_ID_TO_ENDPOINT: Record<string, string> = {
  'sparkvideo-2.0-i2v': DEFAULT_SPARKVIDEO_I2V_ENDPOINT,
  'sparkvideo-2.0-fast-i2v': FAST_SPARKVIDEO_I2V_ENDPOINT,
  'chaoneng-video-2-i2v': DEFAULT_SPARKVIDEO_I2V_ENDPOINT,
  'chaoneng-realpeople-i2v': CHAONENG_REALPEOPLE_ENDPOINT,
}

/* ── AI App: nodeId 常量（地表最强超能视频/全能参考 生真人视频） */
const RP_NODE = {
  IMAGE_1: '12',
  IMAGE_2: '17',
  IMAGE_3: '18',
  VIDEO: '16',
  AUDIO: '19',
  PARAMS: '15',
} as const

/* ── helpers ─────────────────────────────────────────────────── */

function encodeProviderId(providerId: string): string {
  return Buffer.from(providerId, 'utf8').toString('base64url')
}

function normalizeBaseUrl(raw: string | undefined): string {
  const t = (raw || '').trim().replace(/\/+$/, '')
  return t || DEFAULT_BASE
}

function stripEndpointSlashes(endpoint: string): string {
  return endpoint.trim().replace(/^\/+/, '').replace(/\/+$/, '')
}

function isAiAppEndpoint(endpoint: string): boolean {
  return endpoint.startsWith('run/ai-app/')
}

function resolveEndpoint(modelId: string | undefined, options: Record<string, unknown>): string {
  const fromOpt =
    (typeof options.rhEndpoint === 'string' && options.rhEndpoint.trim())
    || (typeof options.endpoint === 'string' && options.endpoint.trim())
  if (fromOpt) return stripEndpointSlashes(fromOpt)

  const mid = (modelId || '').trim()
  if (mid.includes('/')) return stripEndpointSlashes(mid)

  const mapped = MODEL_ID_TO_ENDPOINT[mid]
  if (mapped) return mapped

  return DEFAULT_SPARKVIDEO_I2V_ENDPOINT
}

function parseDataUrl(dataUrl: string): { bytes: Buffer; mime: string; ext: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl.replace(/\s/g, ''))
  if (!m) return null
  const mime = m[1].trim().toLowerCase()
  const bytes = Buffer.from(m[2], 'base64')
  const ext =
    mime === 'image/png' ? 'png'
    : mime === 'image/jpeg' || mime === 'image/jpg' ? 'jpg'
    : mime === 'image/webp' ? 'webp'
    : 'png'
  return { bytes, mime: mime || 'image/png', ext }
}

async function bytesFromImageInput(imageUrl: string): Promise<{ bytes: Buffer; filename: string; mime: string }> {
  if (imageUrl.startsWith('data:')) {
    const parsed = parseDataUrl(imageUrl)
    if (!parsed) throw new Error('RUNNINGHUB_IMAGE_DATA_URL_INVALID')
    return { bytes: parsed.bytes, filename: `frame.${parsed.ext}`, mime: parsed.mime }
  }
  const base64DataUrl = await normalizeToBase64ForGeneration(imageUrl)
  const parsed = parseDataUrl(base64DataUrl)
  if (!parsed) throw new Error('RUNNINGHUB_IMAGE_NORMALIZE_FAILED')
  return { bytes: parsed.bytes, filename: `frame.${parsed.ext}`, mime: parsed.mime }
}

function resolveDownloadUrl(baseUrl: string, downloadUrl: string): string {
  const t = downloadUrl.trim()
  if (t.startsWith('http://') || t.startsWith('https://')) return t
  const origin = new URL(baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`).origin
  return `${origin}/${t.replace(/^\//, '')}`
}

interface RhUploadResult {
  rawFilename: string
  fullUrl: string
}

async function uploadBinaryToRunningHub(
  apiKey: string,
  baseUrl: string,
  bytes: Buffer,
  filename: string,
  mime: string,
): Promise<RhUploadResult> {
  const url = `${normalizeBaseUrl(baseUrl)}/media/upload/binary`
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), filename)

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  })

  const rawText = await res.text().catch(() => '')
  let json: Record<string, unknown> = {}
  if (rawText.trim()) {
    try { json = JSON.parse(rawText) as Record<string, unknown> } catch { json = {} }
  }

  if (!res.ok) {
    throw new Error(`RunningHub upload failed (${res.status}): ${rawText.slice(0, 240)}`.trim())
  }

  const code = json.code
  if (code !== undefined && code !== 0 && code !== '0') {
    const msg = typeof json.message === 'string' ? json.message : 'upload error'
    throw new Error(`RunningHub upload: ${msg}`)
  }

  const data = json.data
  const downloadUrl =
    data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>).download_url
      : undefined
  if (typeof downloadUrl !== 'string' || !downloadUrl.trim()) {
    throw new Error('RUNNINGHUB_UPLOAD_MISSING_DOWNLOAD_URL')
  }

  const raw = downloadUrl.trim()
  return {
    rawFilename: raw,
    fullUrl: resolveDownloadUrl(baseUrl, raw),
  }
}

function readRhTaskId(json: Record<string, unknown>): string {
  const top = json.taskId ?? json.task_id
  if (typeof top === 'string' && top.trim()) return top.trim()
  const inner = json.data
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    const d = inner as Record<string, unknown>
    const id = d.taskId ?? d.task_id
    if (typeof id === 'string' && id.trim()) return id.trim()
  }
  return ''
}

function readRhBusinessError(json: Record<string, unknown>): string | undefined {
  const code = json.errorCode ?? json.error_code
  const msg = json.errorMessage ?? json.error_message
  if ((code !== undefined && code !== null && String(code).trim() !== '')
    || (typeof msg === 'string' && msg.trim())) {
    const parts = [typeof code === 'string' || typeof code === 'number' ? String(code) : '', typeof msg === 'string' ? msg.trim() : '']
      .filter(Boolean)
    if (parts.length) return parts.join(': ')
  }
  return undefined
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function asBool(v: unknown, defaultValue: boolean): boolean {
  if (typeof v === 'boolean') return v
  if (v === 'true' || v === 1) return true
  if (v === 'false' || v === 0) return false
  return defaultValue
}

function mapAspectToRatio(aspectRatio: unknown): string | undefined {
  const s = asString(aspectRatio)
  if (!s) return undefined
  return sanitizeVideoRatioForRunningHub(s)
}

/* ── nodeInfoList builder for AI App (realpeople) ────────────── */

interface NodeInfoItem {
  nodeId: string
  fieldName: string
  fieldValue: string
  description: string
  fieldData?: string
}

function buildRealpeopleNodeInfoList(params: {
  imageFilename: string
  prompt: string
  duration: string
  ratio: string
  resolution: string
}): NodeInfoItem[] {
  const nodes: NodeInfoItem[] = []

  nodes.push({
    nodeId: RP_NODE.IMAGE_1,
    fieldName: 'image',
    fieldValue: params.imageFilename,
    description: '上传图像1 创建ID（支持真人）选填',
  })

  nodes.push({
    nodeId: RP_NODE.PARAMS,
    fieldName: 'duration',
    fieldValue: params.duration,
    description: '时长（秒）',
  })

  nodes.push({
    nodeId: RP_NODE.PARAMS,
    fieldName: 'ratio',
    fieldValue: params.ratio,
    description: '比例',
  })

  nodes.push({
    nodeId: RP_NODE.PARAMS,
    fieldName: 'resolution',
    fieldValue: params.resolution,
    description: '分辨率',
  })

  if (params.prompt.trim()) {
    nodes.push({
      nodeId: RP_NODE.PARAMS,
      fieldName: 'prompt',
      fieldValue: params.prompt.trim(),
      description: '输入文本',
    })
  }

  return nodes
}

/* ── Smart Reference: multi-image nodeInfoList builder ────────── */

export interface SmartRefInput {
  characterImages: Array<{ filename: string }>
  sceneImage?: { filename: string } | null
  prompt: string
  duration: string
  ratio: string
  resolution: string
}

function buildSmartRefNodeInfoList(input: SmartRefInput): NodeInfoItem[] {
  const nodes: NodeInfoItem[] = []
  const imageSlots = [RP_NODE.IMAGE_1, RP_NODE.IMAGE_2, RP_NODE.IMAGE_3]

  let slotIdx = 0
  for (const charImg of input.characterImages) {
    if (slotIdx >= imageSlots.length) break
    nodes.push({
      nodeId: imageSlots[slotIdx],
      fieldName: 'image',
      fieldValue: charImg.filename,
      description: `角色参考图${slotIdx + 1}`,
    })
    slotIdx++
  }

  if (input.sceneImage && slotIdx < imageSlots.length) {
    nodes.push({
      nodeId: imageSlots[slotIdx],
      fieldName: 'image',
      fieldValue: input.sceneImage.filename,
      description: '场景参考图',
    })
  }

  nodes.push({
    nodeId: RP_NODE.PARAMS,
    fieldName: 'duration',
    fieldValue: input.duration,
    description: '时长（秒）',
  })
  nodes.push({
    nodeId: RP_NODE.PARAMS,
    fieldName: 'ratio',
    fieldValue: input.ratio,
    description: '比例',
  })
  nodes.push({
    nodeId: RP_NODE.PARAMS,
    fieldName: 'resolution',
    fieldValue: input.resolution,
    description: '分辨率',
  })

  if (input.prompt.trim()) {
    nodes.push({
      nodeId: RP_NODE.PARAMS,
      fieldName: 'prompt',
      fieldValue: input.prompt.trim(),
      description: '视频描述文本',
    })
  }

  return nodes
}

export { uploadBinaryToRunningHub, bytesFromImageInput, normalizeBaseUrl, isAiAppEndpoint, resolveEndpoint, asString, mapAspectToRatio, readRhTaskId, readRhBusinessError, encodeProviderId }

/* ── Generator ───────────────────────────────────────────────── */

export class RunningHubVideoGenerator extends BaseVideoGenerator {
  protected async doGenerate(params: VideoGenerateParams): Promise<GenerateResult> {
    const { userId, imageUrl, prompt = '', options = {} } = params
    const optProvider = (options as Record<string, unknown>).provider
    const providerId = typeof optProvider === 'string' && optProvider.trim()
      ? optProvider.trim()
      : 'runninghub'

    const { apiKey, baseUrl: cfgBase } = await getProviderConfig(userId, providerId)
    const baseUrl = normalizeBaseUrl(cfgBase)

    const raw = options as Record<string, unknown>
    const modelId = typeof raw.modelId === 'string' ? raw.modelId : undefined
    const endpoint = resolveEndpoint(modelId, raw)

    const durationRaw = raw.duration
    const durationStr =
      typeof durationRaw === 'number' && Number.isFinite(durationRaw)
        ? String(Math.round(durationRaw))
        : asString(durationRaw) || '5'
    const resolution = asString(raw.resolution) || '720p'
    const ratio = mapAspectToRatio(raw.ratio ?? raw.aspectRatio ?? raw.aspect_ratio) || 'adaptive'

    let payload: Record<string, unknown>
    let submitUrl: string

    if (isAiAppEndpoint(endpoint)) {
      payload = await this.buildAiAppPayload({
        apiKey, baseUrl, imageUrl, prompt, durationStr, resolution, ratio, raw,
      })
      submitUrl = `${baseUrl}/${endpoint}`
    } else {
      payload = await this.buildStandardPayload({
        apiKey, baseUrl, imageUrl, prompt, durationStr, resolution, ratio, raw,
      })
      submitUrl = `${baseUrl}/${endpoint}`
    }

    _ulogInfo('[RunningHub Video] submit', {
      baseUrl, endpoint, resolution, duration: durationStr, aiApp: isAiAppEndpoint(endpoint),
    })

    const response = await fetch(submitUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    })

    const rawText = await response.text().catch(() => '')
    let data: Record<string, unknown> = {}
    if (rawText.trim()) {
      try { data = JSON.parse(rawText) as Record<string, unknown> } catch { data = {} }
    }

    if (!response.ok) {
      _ulogError('[RunningHub Video] submit HTTP error', { status: response.status, body: rawText.slice(0, 400) })
      throw new Error(`RunningHub API Error: ${response.status} ${rawText.slice(0, 200)}`.trim())
    }

    const wrapCode = data.code
    if (wrapCode !== undefined && wrapCode !== 0 && wrapCode !== '0') {
      const msg = typeof data.message === 'string' ? data.message : 'API error'
      throw new Error(`RunningHub: ${msg}`)
    }

    const bizErr = readRhBusinessError(data)
    if (bizErr) throw new Error(`RunningHub: ${bizErr}`)

    const taskId = readRhTaskId(data)
    if (!taskId) throw new Error('RUNNINGHUB_TASK_ID_MISSING')

    const providerToken = encodeProviderId(providerId)
    return {
      success: true,
      async: true,
      requestId: taskId,
      externalId: `RUNNINGHUB:VIDEO:${providerToken}:${taskId}`,
    }
  }

  /* ── AI App 模式（nodeInfoList） ─────────────────────────────── */

  private async buildAiAppPayload(ctx: {
    apiKey: string; baseUrl: string
    imageUrl: string; prompt: string
    durationStr: string; resolution: string; ratio: string
    raw: Record<string, unknown>
  }): Promise<Record<string, unknown>> {
    const { apiKey, baseUrl, imageUrl, prompt, durationStr, resolution, ratio, raw } = ctx

    const { bytes, filename, mime } = await bytesFromImageInput(imageUrl)
    const uploaded = await uploadBinaryToRunningHub(apiKey, baseUrl, bytes, filename, mime)

    const nodeInfoList = buildRealpeopleNodeInfoList({
      imageFilename: uploaded.rawFilename,
      prompt,
      duration: durationStr,
      ratio,
      resolution,
    })

    const payload: Record<string, unknown> = {
      nodeInfoList,
      instanceType: asString(raw.instanceType) || 'default',
    }

    if (typeof raw.usePersonalQueue === 'boolean') {
      payload.usePersonalQueue = String(raw.usePersonalQueue)
    } else {
      payload.usePersonalQueue = 'false'
    }

    const webhookUrl = asString(raw.webhookUrl)
    if (webhookUrl) payload.webhookUrl = webhookUrl

    return payload
  }

  /* ── 标准模型模式（扁平 body） ───────────────────────────────── */

  private async buildStandardPayload(ctx: {
    apiKey: string; baseUrl: string
    imageUrl: string; prompt: string
    durationStr: string; resolution: string; ratio: string
    raw: Record<string, unknown>
  }): Promise<Record<string, unknown>> {
    const { apiKey, baseUrl, imageUrl, prompt, durationStr, resolution, ratio, raw } = ctx

    let firstFrameUrl: string
    if (asBool(raw.rhSkipUpload, false) && imageUrl.startsWith('https://')) {
      firstFrameUrl = imageUrl.trim()
    } else {
      const { bytes, filename, mime } = await bytesFromImageInput(imageUrl)
      firstFrameUrl = (await uploadBinaryToRunningHub(apiKey, baseUrl, bytes, filename, mime)).fullUrl
    }

    const generateAudio = asBool(raw.generateAudio, true)

    const payload: Record<string, unknown> = {
      appCode: asString(raw.rhAppCode) || 'comfyui_rh_openapi',
      firstFrameUrl,
      prompt: prompt.trim(),
      resolution,
      duration: durationStr,
      ratio,
      generateAudio,
    }

    const lastFrame = asString(raw.lastFrameImageUrl ?? raw.last_frame_image_url)
    if (lastFrame) {
      if (lastFrame.startsWith('https://') && asBool(raw.rhSkipUpload, false)) {
        payload.lastFrameUrl = lastFrame
      } else {
        const { bytes, filename, mime } = await bytesFromImageInput(lastFrame)
        payload.lastFrameUrl = (await uploadBinaryToRunningHub(apiKey, baseUrl, bytes, filename, mime)).fullUrl
      }
    }

    const instanceType = asString(raw.instanceType)
    if (instanceType === 'default' || instanceType === 'plus') {
      payload.instanceType = instanceType
    }

    if (typeof raw.usePersonalQueue === 'boolean') {
      payload.usePersonalQueue = raw.usePersonalQueue
    }

    if (typeof raw.retainSeconds === 'number' && Number.isFinite(raw.retainSeconds)) {
      payload.retainSeconds = Math.round(raw.retainSeconds)
    }

    const webhookUrl = asString(raw.webhookUrl)
    if (webhookUrl) payload.webhookUrl = webhookUrl

    return payload
  }

  /* ── Smart Reference 多参考图模式 ─────────────────────────────── */

  static async submitSmartRefVideo(params: {
    userId: string
    providerId?: string
    appId?: string
    referenceImageUrls: string[]
    prompt: string
    duration?: number
    ratio?: string
    resolution?: string
    instanceType?: string
  }): Promise<GenerateResult> {
    const providerId = params.providerId || 'runninghub'
    const { apiKey, baseUrl: cfgBase } = await getProviderConfig(params.userId, providerId)
    const baseUrl = normalizeBaseUrl(cfgBase)

    const appId = params.appId || CHAONENG_REALPEOPLE_APP_ID
    const submitUrl = `${baseUrl}/run/ai-app/${appId}`

    const uploadedImages: Array<{ filename: string }> = []
    for (const imgUrl of params.referenceImageUrls) {
      if (!imgUrl) continue
      const { bytes, filename, mime } = await bytesFromImageInput(imgUrl)
      const uploaded = await uploadBinaryToRunningHub(apiKey, baseUrl, bytes, filename, mime)
      uploadedImages.push({ filename: uploaded.rawFilename })
    }

    const charImages = uploadedImages.slice(0, 2)
    const sceneImage = uploadedImages.length > 2 ? uploadedImages[2] : null

    const nodeInfoList = buildSmartRefNodeInfoList({
      characterImages: charImages,
      sceneImage,
      prompt: params.prompt,
      duration: String(params.duration || 5),
      ratio: sanitizeVideoRatioForRunningHub(params.ratio || 'adaptive'),
      resolution: params.resolution || '720p',
    })

    const payload: Record<string, unknown> = {
      nodeInfoList,
      instanceType: params.instanceType || 'default',
      usePersonalQueue: 'false',
    }

    _ulogInfo('[RunningHub SmartRef] submit', {
      baseUrl, appId, imageCount: uploadedImages.length,
    })

    const response = await fetch(submitUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    })

    const rawText = await response.text().catch(() => '')
    let data: Record<string, unknown> = {}
    if (rawText.trim()) {
      try { data = JSON.parse(rawText) as Record<string, unknown> } catch { data = {} }
    }

    if (!response.ok) {
      _ulogError('[RunningHub SmartRef] HTTP error', { status: response.status, body: rawText.slice(0, 400) })
      throw new Error(`RunningHub SmartRef Error: ${response.status} ${rawText.slice(0, 200)}`.trim())
    }

    const wrapCode = data.code
    if (wrapCode !== undefined && wrapCode !== 0 && wrapCode !== '0') {
      const msg = typeof data.message === 'string' ? data.message : 'API error'
      throw new Error(`RunningHub SmartRef: ${msg}`)
    }

    const bizErr = readRhBusinessError(data)
    if (bizErr) throw new Error(`RunningHub SmartRef: ${bizErr}`)

    const taskId = readRhTaskId(data)
    if (!taskId) throw new Error('RUNNINGHUB_SMARTREF_TASK_ID_MISSING')

    const providerToken = encodeProviderId(providerId)
    return {
      success: true,
      async: true,
      requestId: taskId,
      externalId: `RUNNINGHUB:VIDEO:${providerToken}:${taskId}`,
    }
  }
}
