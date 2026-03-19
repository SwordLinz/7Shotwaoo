/**
 * Gemini Batch 工具函数
 * 
 * 用于提交和查询 Google Gemini Batch API 的任务
 * 参考: https://ai.google.dev/gemini-api/docs/batch-api
 * 
 * 特点：
 * - 价格是标准 API 的 50%
 * - 处理时间 24 小时内
 */

import { GoogleGenAI } from '@google/genai'
import { getImageBase64Cached } from './image-cache'
import { logInternal } from './logging/semantic'

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? (value as UnknownRecord) : null
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  const record = asRecord(error)
  if (record && typeof record.message === 'string') return record.message
  return String(error)
}

/** Google ImageConfig 仅支持以下比例，否则会报 invalid argument */
function normalizeAspectRatio(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().replace('：', ':').replace('/', ':')
  if (!normalized) return undefined
  const allowed = new Set(['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'])
  return allowed.has(normalized) ? normalized : undefined
}

/** Google ImageConfig.imageSize 仅支持 1K / 2K / 4K；0.5K 等需映射 */
function normalizeGoogleImageSize(value: unknown): '1K' | '2K' | '4K' | undefined {
  if (typeof value !== 'string') return undefined
  const raw = value.trim()
  if (!raw) return undefined
  const normalized = raw.toUpperCase().replace(/\s+/g, '')
  if (normalized === '1K' || normalized === '2K' || normalized === '4K') return normalized
  if (normalized === '0.5K') return '1K'
  const lower = raw.toLowerCase().replace(/\s+/g, '')
  if (lower.includes('4k') || lower.includes('4096')) return '4K'
  if (lower.includes('2k') || lower.includes('2048') || lower.includes('1440p')) return '2K'
  if (lower.includes('0.5k') || lower.includes('1k') || lower.includes('1024') || lower.includes('1080p') || lower.includes('720p')) return '1K'
  const match = lower.match(/(\d{3,4})x(\d{3,4})/)
  if (match) {
    const w = Number(match[1])
    const h = Number(match[2])
    const max = Math.max(w, h)
    if (Number.isFinite(max)) {
      if (max >= 3000) return '4K'
      if (max >= 1500) return '2K'
      return '1K'
    }
  }
  return undefined
}

interface GeminiBatchClient {
  batches: {
    create(args: {
      model: string
      src: unknown[]
      config: { displayName: string }
    }): Promise<unknown>
    get(args: { name: string }): Promise<unknown>
  }
}

/**
 * 提交 Gemini Batch 图片生成任务
 * 
 * 使用 ai.batches.create() 方法提交批量任务
 * 
 * @param apiKey Google AI API Key
 * @param prompt 图片生成提示词
 * @param options 生成选项
 * @returns 返回 batchName（如 batches/xxx）用于后续查询
 */
export async function submitGeminiBatch(
  apiKey: string,
  prompt: string,
  options?: {
    referenceImages?: string[]
    aspectRatio?: string
    resolution?: string
  }
): Promise<{
  success: boolean
  batchName?: string
  error?: string
}> {
  if (!apiKey) {
    return { success: false, error: '请配置 Google AI API Key' }
  }

  try {
    const ai = new GoogleGenAI({ apiKey })

    // 构建 content parts
    const contentParts: UnknownRecord[] = []

    // 添加参考图片（最多 14 张）
    const referenceImages = options?.referenceImages || []
    for (let i = 0; i < Math.min(referenceImages.length, 14); i++) {
      const imageData = referenceImages[i]

      if (imageData.startsWith('data:')) {
        // Base64 格式
        const base64Start = imageData.indexOf(';base64,')
        if (base64Start !== -1) {
          const mimeType = imageData.substring(5, base64Start)
          const data = imageData.substring(base64Start + 8)
          contentParts.push({ inlineData: { mimeType, data } })
        }
      } else if (imageData.startsWith('http') || imageData.startsWith('/')) {
        // URL 格式（包括本地相对路径 /api/files/...）：下载转 base64
        try {
          // 🔧 本地模式修复：相对路径需要补全完整 URL
          let fullUrl = imageData
          if (imageData.startsWith('/')) {
            const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'
            fullUrl = `${baseUrl}${imageData}`
          }
          const base64DataUrl = await getImageBase64Cached(fullUrl)
          const base64Start = base64DataUrl.indexOf(';base64,')
          if (base64Start !== -1) {
            const mimeType = base64DataUrl.substring(5, base64Start)
            const data = base64DataUrl.substring(base64Start + 8)
            contentParts.push({ inlineData: { mimeType, data } })
          }
        } catch (e: unknown) {
          logInternal('GeminiBatch', 'WARN', `下载参考图片 ${i + 1} 失败`, { error: getErrorMessage(e) })
        }
      } else {
        // 纯 base64
        contentParts.push({
          inlineData: { mimeType: 'image/png', data: imageData }
        })
      }
    }

    // 添加文本提示
    contentParts.push({ text: prompt })

    // 构建内嵌请求（Inline Requests）
    // Google 仅支持固定 aspectRatio / imageSize 枚举，未归一化会报 invalid argument
    const imageConfig: UnknownRecord = {}
    const aspectRatio = normalizeAspectRatio(options?.aspectRatio)
    const imageSize = normalizeGoogleImageSize(options?.resolution)
    if (aspectRatio) imageConfig.aspectRatio = aspectRatio
    if (imageSize) imageConfig.imageSize = imageSize

    const inlinedRequests = [
      {
        contents: [{ parts: contentParts }],
        config: {
          responseModalities: ['TEXT', 'IMAGE'],  // 🔥 必须指定包含 IMAGE
          ...(Object.keys(imageConfig).length > 0 && { imageConfig })  // 🔥 添加图片配置
        }
      }
    ]

    // 🔥 使用 ai.batches.create 创建批量任务
    const batchClient = ai as unknown as GeminiBatchClient
    const batchJob = await batchClient.batches.create({
      model: 'gemini-3-pro-image-preview',
      src: inlinedRequests,
      config: {
        displayName: `image-gen-${Date.now()}`
      }
    })

    const batchName = asRecord(batchJob)?.name  // 格式: batches/xxx

    if (typeof batchName !== 'string' || !batchName) {
      return { success: false, error: '未返回 batch name' }
    }

    logInternal('GeminiBatch', 'INFO', `✅ 任务已提交: ${batchName}`)
    return { success: true, batchName }

  } catch (error: unknown) {
    const message = getErrorMessage(error)
    logInternal('GeminiBatch', 'ERROR', '提交异常', { error: message })
    return { success: false, error: `提交异常: ${message}` }
  }
}

/**
 * 查询 Gemini Batch 任务状态
 * 
 * 使用 ai.batches.get() 方法查询任务状态
 * 
 * @param batchName 批量任务名称（如 batches/xxx）
 * @param apiKey Google AI API Key
 */
export async function queryGeminiBatchStatus(batchName: string, apiKey: string): Promise<{
  status: string
  completed: boolean
  failed: boolean
  imageBase64?: string
  imageUrl?: string
  error?: string
}> {
  if (!apiKey) {
    return { status: 'error', completed: false, failed: true, error: '请配置 Google AI API Key' }
  }

  try {
    const ai = new GoogleGenAI({ apiKey })

    // 🔥 使用 ai.batches.get 查询任务状态
    const batchClient = ai as unknown as GeminiBatchClient
    const batchJob = await batchClient.batches.get({ name: batchName })
    const batchRecord = asRecord(batchJob) || {}

    const state = typeof batchRecord.state === 'string' ? batchRecord.state : 'UNKNOWN'
    logInternal('GeminiBatch', 'INFO', `查询状态: ${batchName} -> ${state}`)

    // 检查完成状态
    const completedStates = new Set([
      'JOB_STATE_SUCCEEDED'
    ])
    const failedStates = new Set([
      'JOB_STATE_FAILED',
      'JOB_STATE_CANCELLED',
      'JOB_STATE_EXPIRED'
    ])

    if (completedStates.has(state)) {
      // 从 inlinedResponses 中提取图片
      const dest = asRecord(batchRecord.dest)
      const responses = Array.isArray(dest?.inlinedResponses) ? dest.inlinedResponses : []

      if (responses.length > 0) {
        const firstResponse = asRecord(responses[0])
        const response = asRecord(firstResponse?.response)
        const candidates = Array.isArray(response?.candidates) ? response.candidates : []
        const firstCandidate = asRecord(candidates[0])
        const content = asRecord(firstCandidate?.content)
        const parts = Array.isArray(content?.parts) ? content.parts : []

        for (const part of parts) {
          const partRecord = asRecord(part)
          const inlineData = asRecord(partRecord?.inlineData)
          if (typeof inlineData?.data === 'string') {
            const imageBase64 = inlineData.data
            const mimeType = typeof inlineData.mimeType === 'string' ? inlineData.mimeType : 'image/png'

            logInternal('GeminiBatch', 'INFO', `✅ 获取到图片，MIME 类型: ${mimeType}`, { batchName })
            return {
              status: 'completed',
              completed: true,
              failed: false,
              imageBase64,
              imageUrl: `data:${mimeType};base64,${imageBase64}`
            }
          }
        }
      }

      // 任务完成但没有图片
      return {
        status: 'completed_no_image',
        completed: false,
        failed: true,
        error: '任务完成但未找到图片（可能被内容安全策略过滤）'
      }
    }

    if (failedStates.has(state)) {
      return {
        status: state,
        completed: false,
        failed: true,
        error: `任务失败: ${state}`
      }
    }

    // 仍在处理中 (PENDING, RUNNING 等)
    return { status: state, completed: false, failed: false }

  } catch (error: unknown) {
    const message = getErrorMessage(error)
    logInternal('GeminiBatch', 'ERROR', '查询异常', { batchName, error: message })
    return { status: 'error', completed: false, failed: false, error: `查询异常: ${message}` }
  }
}
