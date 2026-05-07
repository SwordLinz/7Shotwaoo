/**
 * 异步任务工具函数
 * 用于查询第三方 AI 服务的任务状态
 * 
 * 注意：API Key 现在通过参数传入，不再使用环境变量
 */

import { normalizeArkApiKeyForBearer, resolveArkOpenApiV3BaseUrl } from '@/lib/ark-api'
import { logInternal } from './logging/semantic'

export interface TaskStatus {
    status: 'pending' | 'completed' | 'failed'
    imageUrl?: string
    videoUrl?: string
    error?: string
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
    return value && typeof value === 'object' ? (value as UnknownRecord) : null
}

function readTrimmedString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined
    const t = value.trim()
    return t.length > 0 ? t : undefined
}

function normalizeUpstreamTaskStatus(raw: unknown): string {
    return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}

function isUpstreamTaskSucceeded(norm: string): boolean {
    return (
        norm === 'succeeded'
        || norm === 'success'
        || norm === 'completed'
        || norm === 'complete'
        || norm === 'finish'
        || norm === 'finished'
    )
}

function isUpstreamTaskFailed(norm: string): boolean {
    return (
        norm === 'failed'
        || norm === 'failure'
        || norm === 'error'
        || norm === 'canceled'
        || norm === 'cancelled'
    )
}

/**
 * 方舟官方与兼容网关：`GET …/contents/generations/tasks/{id}` 成功时成片 URL 可能出现在多条路径。
 */
export function extractSeedanceTaskVideoUrl(queryData: unknown): string | undefined {
    const root = asRecord(queryData)
    if (!root) return undefined

    for (const u of [
        readTrimmedString(root.video_url),
        readTrimmedString(root.videoUrl),
    ]) {
        if (u) return u
    }

    const outputUnknown = root.output
    const outputRec = asRecord(outputUnknown)
    if (outputRec) {
        const u = readTrimmedString(outputRec.video_url) || readTrimmedString(outputRec.url)
        if (u) return u
    }
    if (Array.isArray(outputUnknown) && outputUnknown.length > 0) {
        const first = asRecord(outputUnknown[0])
        const u = readTrimmedString(first?.video_url) || readTrimmedString(first?.url)
        if (u) return u
    }

    const result = asRecord(root.result)
    if (result) {
        const u = readTrimmedString(result.video_url) || readTrimmedString(result.url)
        if (u) return u
    }

    let contentUnknown: unknown = root.content
    if (typeof contentUnknown === 'string') {
        try {
            contentUnknown = JSON.parse(contentUnknown) as unknown
        } catch {
            contentUnknown = undefined
        }
    }

    if (Array.isArray(contentUnknown)) {
        for (const item of contentUnknown) {
            const rec = asRecord(item)
            if (!rec) continue
            if (rec.type === 'video_url') {
                const nested = asRecord(rec.video_url)
                const u = readTrimmedString(nested?.url)
                if (u) return u
            }
            const flat = readTrimmedString(rec.video_url) || readTrimmedString(rec.url)
            if (flat) return flat
        }
        return undefined
    }

    const content = asRecord(contentUnknown)
    if (content) {
        const u = readTrimmedString(content.video_url) || readTrimmedString(content.url)
        if (u) return u
    }

    const choicesUnknown = root.choices
    if (Array.isArray(choicesUnknown) && choicesUnknown.length > 0) {
        const firstChoice = asRecord(choicesUnknown[0])
        const message = firstChoice ? asRecord(firstChoice.message) : null
        const u = message ? readTrimmedString(message.video_url) : undefined
        if (u) return u
    }

    return undefined
}

export function classifyArkGenerationTaskPhase(data: unknown): 'success' | 'failure' | 'running' {
    const root = asRecord(data)
    const norm = normalizeUpstreamTaskStatus(root?.status)
    if (isUpstreamTaskSucceeded(norm)) return 'success'
    if (isUpstreamTaskFailed(norm)) return 'failure'
    return 'running'
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    const record = asRecord(error)
    if (record && typeof record.message === 'string') return record.message
    return String(error)
}

function getErrorStatus(error: unknown): number | undefined {
    const record = asRecord(error)
    if (!record) return undefined
    return typeof record.status === 'number' ? record.status : undefined
}

interface GeminiBatchClient {
    batches: {
        get(args: { name: string }): Promise<unknown>
    }
}

/**
 * 查询 FAL Banana 任务状态
 * @param requestId 任务ID
 * @param apiKey FAL API Key
 */
export async function queryBananaTaskStatus(requestId: string, apiKey: string): Promise<TaskStatus> {
    if (!apiKey) {
        throw new Error('请配置 FAL API Key')
    }

    try {
        const statusResponse = await fetch(
            `https://queue.fal.run/fal-ai/nano-banana-pro/requests/${requestId}/status`,
            {
                headers: { 'Authorization': `Key ${apiKey}` },
                cache: 'no-store'
            }
        )

        if (!statusResponse.ok) {
            logInternal('Banana', 'ERROR', `Status query failed: ${statusResponse.status}`)
            return { status: 'pending' }
        }

        const data = await statusResponse.json()

        if (data.status === 'COMPLETED') {
            // 获取结果
            const resultResponse = await fetch(
                `https://queue.fal.run/fal-ai/nano-banana-pro/requests/${requestId}`,
                {
                    headers: { 'Authorization': `Key ${apiKey}` },
                    cache: 'no-store'
                }
            )

            if (resultResponse.ok) {
                const result = await resultResponse.json()
                const imageUrl = result.images?.[0]?.url

                if (imageUrl) {
                    return { status: 'completed', imageUrl }
                }
            }

            return { status: 'failed', error: 'No image URL in result' }
        } else if (data.status === 'FAILED') {
            return { status: 'failed', error: data.error || 'Banana generation failed' }
        }

        return { status: 'pending' }
    } catch (error: unknown) {
        logInternal('Banana', 'ERROR', 'Query error', { error: getErrorMessage(error) })
        return { status: 'pending' }
    }
}

/**
 * 查询 Gemini Batch 任务状态
 * 使用 ai.batches.get() 方法查询任务状态
 * @param batchName 任务名称（如 batches/xxx）
 * @param apiKey Google AI API Key
 */
export async function queryGeminiBatchStatus(batchName: string, apiKey: string): Promise<TaskStatus> {
    if (!apiKey) {
        throw new Error('请配置 Google AI API Key')
    }

    try {
        const { GoogleGenAI } = await import('@google/genai')
        const ai = new GoogleGenAI({ apiKey })

        // 🔥 使用 ai.batches.get 查询任务状态
        const batchClient = ai as unknown as GeminiBatchClient
        const batchJob = await batchClient.batches.get({ name: batchName })
        const batchRecord = asRecord(batchJob) || {}

        const state = typeof batchRecord.state === 'string' ? batchRecord.state : 'UNKNOWN'
        logInternal('GeminiBatch', 'INFO', `查询状态: ${batchName} -> ${state}`)

        // 检查完成状态
        if (state === 'JOB_STATE_SUCCEEDED') {
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
                        const imageUrl = `data:${mimeType};base64,${imageBase64}`

                        logInternal('GeminiBatch', 'INFO', `✅ 获取到图片，MIME 类型: ${mimeType}`, { batchName })
                        return { status: 'completed', imageUrl }
                    }
                }
            }

            return { status: 'failed', error: 'No image data in batch result' }
        } else if (state === 'JOB_STATE_FAILED' || state === 'JOB_STATE_CANCELLED' || state === 'JOB_STATE_EXPIRED') {
            return { status: 'failed', error: `Gemini Batch failed: ${state}` }
        }

        // 仍在处理中 (PENDING, RUNNING 等)
        return { status: 'pending' }
    } catch (error: unknown) {
        const message = getErrorMessage(error)
        const status = getErrorStatus(error)
        logInternal('GeminiBatch', 'ERROR', 'Query error', { batchName, error: message, status })
        // 如果是 404 或任务不存在，标记为失败（不再重试）
        if (status === 404 || message.includes('404') || message.includes('not found') || message.includes('NOT_FOUND')) {
            return { status: 'failed', error: `Batch task not found` }
        }
        return { status: 'pending' }
    }
}

/**
 * 查询 Google Veo 视频任务状态
 * @param operationName 操作名称（如 operations/xxx）
 * @param apiKey Google AI API Key
 */
export async function queryGoogleVideoStatus(operationName: string, apiKey: string): Promise<TaskStatus> {
    if (!apiKey) {
        throw new Error('请配置 Google AI API Key')
    }

    const logPrefix = '[Veo Query]'

    try {
        const { GoogleGenAI, GenerateVideosOperation } = await import('@google/genai')
        const ai = new GoogleGenAI({ apiKey })
        const operation = new GenerateVideosOperation()
        operation.name = operationName
        const op = await ai.operations.getVideosOperation({ operation })

        // 打印完整响应以便调试
        logInternal('Veo', 'INFO', `${logPrefix} 原始响应`, {
            operationName,
            done: op.done,
            hasError: !!op.error,
            hasResponse: !!op.response,
            responseKeys: op.response ? Object.keys(op.response) : [],
            generatedVideosCount: op.response?.generatedVideos?.length ?? 0,
            raiFilteredCount: (op.response as Record<string, unknown>)?.raiMediaFilteredCount ?? null,
            raiFilteredReasons: (op.response as Record<string, unknown>)?.raiMediaFilteredReasons ?? null,
        })

        if (!op.done) {
            return { status: 'pending' }
        }

        // 检查操作级错误
        if (op.error) {
            const errRecord = asRecord(op.error)
            const message = (typeof errRecord?.message === 'string' && errRecord.message)
                || (typeof errRecord?.statusMessage === 'string' && errRecord.statusMessage)
                || 'Veo 任务失败'
            logInternal('Veo', 'ERROR', `${logPrefix} 操作级错误`, { operationName, error: op.error })
            return { status: 'failed', error: message }
        }

        const response = op.response
        if (!response) {
            logInternal('Veo', 'ERROR', `${logPrefix} done=true 但 response 为空`, { operationName })
            return { status: 'failed', error: 'Veo 任务完成但响应体为空' }
        }

        // 检查 RAI 内容过滤
        const responseRecord = asRecord(response) || {}
        const raiFilteredCount = responseRecord.raiMediaFilteredCount
        const raiFilteredReasons = responseRecord.raiMediaFilteredReasons

        if (typeof raiFilteredCount === 'number' && raiFilteredCount > 0) {
            const reasons = Array.isArray(raiFilteredReasons)
                ? raiFilteredReasons.join(', ')
                : '未知原因'
            logInternal('Veo', 'ERROR', `${logPrefix} 视频被 RAI 安全策略过滤`, {
                operationName,
                raiFilteredCount,
                raiFilteredReasons: reasons,
            })
            return {
                status: 'failed',
                error: `Veo 视频被安全策略过滤 (${raiFilteredCount} 个视频被过滤, 原因: ${reasons})`,
            }
        }

        // 提取视频 URL
        const generatedVideos = response.generatedVideos
        if (Array.isArray(generatedVideos) && generatedVideos.length > 0) {
            const first = generatedVideos[0]
            const videoUri = first?.video?.uri

            if (videoUri) {
                logInternal('Veo', 'INFO', `${logPrefix} 成功获取视频`, {
                    operationName,
                    videoUri: videoUri.substring(0, 80),
                })
                return { status: 'completed', videoUrl: videoUri }
            }

            // video 对象存在但没有 uri，打印完整结构以便调试
            logInternal('Veo', 'ERROR', `${logPrefix} generatedVideos[0] 存在但无 video.uri`, {
                operationName,
                firstVideo: JSON.stringify(first, null, 2),
            })
            return { status: 'failed', error: 'Veo 视频对象存在但缺少 URI' }
        }

        // generatedVideos 为空或不存在，打印完整 response 以便诊断
        logInternal('Veo', 'ERROR', `${logPrefix} 无 generatedVideos`, {
            operationName,
            responseKeys: Object.keys(responseRecord),
            fullResponse: JSON.stringify(responseRecord, null, 2).substring(0, 2000),
            raiFilteredCount: raiFilteredCount ?? 'N/A',
            raiFilteredReasons: raiFilteredReasons ?? 'N/A',
        })
        return { status: 'failed', error: 'Veo 任务完成但未返回视频 (generatedVideos 为空)' }
    } catch (error: unknown) {
        const message = getErrorMessage(error)
        logInternal('Veo', 'ERROR', `${logPrefix} 查询异常`, { operationName, error: message })
        return { status: 'failed', error: message }
    }
}

/**
 * 查询 Seedance 视频任务状态
 * @param taskId 任务ID
 * @param apiKey 火山引擎 API Key（或兼容网关的 sk-…）
 * @param options.baseUrl 方舟兼容网关根地址（可省略路径，将自动补 `/api/v3`）
 */
export async function querySeedanceVideoStatus(
    taskId: string,
    apiKey: string,
    options?: { baseUrl?: string },
): Promise<TaskStatus> {
    const token = normalizeArkApiKeyForBearer(apiKey)
    if (!token) {
        throw new Error('请配置火山引擎 API Key')
    }

    try {
        const base = resolveArkOpenApiV3BaseUrl(options?.baseUrl)
        const queryResponse = await fetch(
            `${base}/contents/generations/tasks/${taskId}`,
            {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                cache: 'no-store'
            }
        )

        if (!queryResponse.ok) {
            logInternal('Seedance', 'ERROR', `Status query failed: ${queryResponse.status}`)
            return { status: 'pending' }
        }

        const queryData: unknown = await queryResponse.json()
        const phase = classifyArkGenerationTaskPhase(queryData)

        if (phase === 'success') {
            const videoUrl = extractSeedanceTaskVideoUrl(queryData)

            if (videoUrl) {
                return { status: 'completed', videoUrl }
            }

            logInternal('Seedance', 'ERROR', 'Task marked success but no video URL in response', {
                status: asRecord(queryData)?.status,
            })
            return { status: 'failed', error: 'No video URL in response' }
        }

        if (phase === 'failure') {
            const root = asRecord(queryData)
            const errorObj = root?.error && typeof root.error === 'object' ? (root.error as UnknownRecord) : {}
            const errorMessage = typeof errorObj.message === 'string' ? errorObj.message : 'Unknown error'
            return { status: 'failed', error: errorMessage }
        }

        return { status: 'pending' }
    } catch (error: unknown) {
        logInternal('Seedance', 'ERROR', 'Query error', { error: getErrorMessage(error) })
        return { status: 'pending' }
    }
}
