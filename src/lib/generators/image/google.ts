import { logInfo as _ulogInfo, logWarn as _ulogWarn } from '@/lib/logging/core'
/**
 * Google AI 图片生成器
 * 
 * 支持：
 * - Gemini 3 Pro Image (实时)
 * - Gemini 2.5 Flash Image (实时)
 * - Imagen 4
 */

import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai'
import { BaseImageGenerator, ImageGenerateParams, GenerateResult } from '../base'
import { getProviderConfig } from '@/lib/api-config'
import { getImageBase64Cached } from '@/lib/image-cache'
import { setProxy } from '../../../../lib/prompts/proxy'

type ContentPart = { inlineData: { mimeType: string; data: string } } | { text: string }

interface ImagenResponse {
    generatedImages?: Array<{
        image?: {
            imageBytes?: string
        }
    }>
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    if (typeof error === 'object' && error !== null) {
        const candidate = (error as { message?: unknown }).message
        if (typeof candidate === 'string') return candidate
    }
    return '未知错误'
}

function normalizeAspectRatio(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined
    const normalized = value.trim().replace('：', ':').replace('/', ':')
    if (!normalized) return undefined
    const allowed = new Set(['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'])
    if (allowed.has(normalized)) return normalized
    return undefined
}

function normalizeGoogleImageSize(value: unknown): '1K' | '2K' | '4K' | undefined {
    if (typeof value !== 'string') return undefined
    const raw = value.trim()
    if (!raw) return undefined
    const normalized = raw.toUpperCase().replace(/\s+/g, '')
    if (normalized === '1K' || normalized === '2K' || normalized === '4K') return normalized
    // UI 常见 0.5K → Google 仅支持 1K/2K/4K，映射为 1K
    if (normalized === '0.5K') return '1K'

    // Common UI inputs → Google ImageConfig.imageSize enum
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

export class GoogleGeminiImageGenerator extends BaseImageGenerator {
    private modelId: string

    constructor(modelId: string = 'gemini-3-pro-image-preview') {
        super()
        this.modelId = modelId
    }

    protected async doGenerate(params: ImageGenerateParams): Promise<GenerateResult> {
        const { userId, prompt, referenceImages = [], options = {} } = params

        const { apiKey } = await getProviderConfig(userId, 'google')
        const {
            aspectRatio,
            resolution
        } = options as {
            aspectRatio?: string
            resolution?: string
            provider?: string
            modelId?: string
            modelKey?: string
        }
        const normalizedAspectRatio = normalizeAspectRatio(aspectRatio)
        const normalizedImageSize = normalizeGoogleImageSize(resolution)

        const allowedOptionKeys = new Set([
            'provider',
            'modelId',
            'modelKey',
            'aspectRatio',
            'resolution',
        ])
        for (const [key, value] of Object.entries(options)) {
            if (value === undefined) continue
            if (!allowedOptionKeys.has(key)) {
                throw new Error(`GOOGLE_IMAGE_OPTION_UNSUPPORTED: ${key}`)
            }
        }

        await setProxy()
        const ai = new GoogleGenAI({ apiKey })

        // 构建内容数组
        const contentParts: ContentPart[] = []

        // 添加参考图片（最多 14 张）
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
                } catch (e) {
                    _ulogWarn(`下载参考图片 ${i + 1} 失败:`, e)
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

        // 安全配置（关闭过滤）
        const safetySettings = [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ]

        // 调用 API
        const response = await ai.models.generateContent({
            model: this.modelId,
            contents: [{ parts: contentParts }],
            config: {
                responseModalities: ['TEXT', 'IMAGE'],
                safetySettings,
                ...(normalizedAspectRatio || normalizedImageSize
                    ? {
                        imageConfig: {
                            ...(normalizedAspectRatio ? { aspectRatio: normalizedAspectRatio } : {}),
                            ...(normalizedImageSize ? { imageSize: normalizedImageSize } : {}),
                        },
                    }
                    : {})
            }
        })

        // 提取图片
        const candidate = response.candidates?.[0]
        const parts = candidate?.content?.parts || []

        for (const part of parts) {
            if (part.inlineData) {
                const imageBase64 = part.inlineData.data
                if (imageBase64) {
                    const mimeType = part.inlineData.mimeType || 'image/png'
                    return {
                        success: true,
                        imageBase64,
                        imageUrl: `data:${mimeType};base64,${imageBase64}`
                    }
                }
            }
        }

        // 检查失败原因
        const finishReason = candidate?.finishReason
        if (finishReason === 'IMAGE_SAFETY' || finishReason === 'SAFETY') {
            throw new Error('内容因安全策略被过滤')
        }

        throw new Error('Gemini 未返回图片')
    }
}

/**
 * Google Imagen 4 图片生成器
 * 
 * 使用 Imagen 4 API（与 Gemini 不同的 API）
 * 支持：imagen-4.0-generate-001, imagen-4.0-fast-generate-001, imagen-4.0-ultra-generate-001
 */
export class GoogleImagenGenerator extends BaseImageGenerator {
    private modelId: string

    constructor(modelId: string = 'imagen-4.0-generate-001') {
        super()
        this.modelId = modelId
    }

    protected async doGenerate(params: ImageGenerateParams): Promise<GenerateResult> {
        const { userId, prompt, options = {} } = params

        const { apiKey } = await getProviderConfig(userId, 'google')
        const {
            aspectRatio,
        } = options
        const normalizedAspectRatio = normalizeAspectRatio(aspectRatio)

        await setProxy()
        const ai = new GoogleGenAI({ apiKey })

        try {
            // 使用 Imagen API（不同于 Gemini generateContent）
            const response = await ai.models.generateImages({
                model: this.modelId,
                prompt,
                config: {
                    numberOfImages: 1,
                    ...(normalizedAspectRatio ? { aspectRatio: normalizedAspectRatio } : {}),
                }
            })

            // 提取图片
            const generatedImages = (response as ImagenResponse).generatedImages
            if (generatedImages && generatedImages.length > 0) {
                const imageBytes = generatedImages[0].image?.imageBytes
                if (imageBytes) {
                    return {
                        success: true,
                        imageBase64: imageBytes,
                        imageUrl: `data:image/png;base64,${imageBytes}`
                    }
                }
            }

            throw new Error('Imagen 未返回图片')
        } catch (error: unknown) {
            const message = getErrorMessage(error)
            // 检查安全过滤
            if (message.includes('SAFETY') || message.includes('blocked')) {
                throw new Error('内容因安全策略被过滤')
            }
            throw error
        }
    }
}

/**
 * Google Gemini Batch 图片生成器（异步模式）
 * 
 * 使用 ai.batches.create() 提交批量任务
 * 价格是标准 API 的 50%，处理时间 24 小时内
 */
export class GoogleGeminiBatchImageGenerator extends BaseImageGenerator {
    protected async doGenerate(params: ImageGenerateParams): Promise<GenerateResult> {
        const { userId, prompt, referenceImages = [], options = {} } = params

        const { apiKey } = await getProviderConfig(userId, 'google')
        const {
            aspectRatio,
            resolution
        } = options as {
            aspectRatio?: string
            resolution?: string
            provider?: string
            modelId?: string
            modelKey?: string
        }

        // 使用 Batch API 提交异步任务
        const { submitGeminiBatch } = await import('@/lib/gemini-batch-utils')
        await setProxy()

        const result = await submitGeminiBatch(apiKey, prompt, {
            referenceImages,
            ...(aspectRatio ? { aspectRatio } : {}),
            ...(resolution ? { resolution } : {}),
        })

        if (!result.success || !result.batchName) {
            return {
                success: false,
                error: result.error || 'Gemini Batch 提交失败'
            }
        }

        // 返回异步标识
        _ulogInfo(`[Gemini Batch Generator] ✅ 异步任务已提交: ${result.batchName}`)
        return {
            success: true,
            async: true,
            requestId: result.batchName,  // 向后兼容，格式: batches/xxx
            externalId: `GEMINI:BATCH:${result.batchName}`  // 🔥 标准格式
        }
    }
}
