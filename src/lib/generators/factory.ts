/**
 * 生成器工厂（增强版）
 * 
 * 支持：
 * - 根据 provider 创建生成器
 */

import { ImageGenerator, VideoGenerator, AudioGenerator } from './base'
import { FalBananaGenerator } from './fal'
import { ArkSeedreamGenerator, ArkSeedanceVideoGenerator } from './ark'
import { FalVideoGenerator } from './fal'
import {
    GoogleGeminiImageGenerator,
    GoogleImagenGenerator,
    GoogleGeminiBatchImageGenerator,
    GeminiCompatibleImageGenerator,
    OpenAICompatibleImageGenerator,
} from './image'
import { GoogleVeoVideoGenerator } from './video/google'
import { OpenAICompatibleVideoGenerator } from './video'
import { MinimaxVideoGenerator } from './minimax'
import { ViduVideoGenerator } from './vidu'
import { KlingVideoGenerator } from './kling'
import { RunningHubVideoGenerator } from './runninghub'
import { getProviderKey } from '@/lib/api-config'
import {
    BailianAudioGenerator,
    BailianImageGenerator,
    BailianVideoGenerator,
    SiliconFlowAudioGenerator,
    SiliconFlowImageGenerator,
    SiliconFlowVideoGenerator,
} from './official'
import { YouchuanImageGenerator } from './youchuan'

/** 与配置中心一致：去掉首尾空白，避免 provider 带空格导致 switch 不匹配（如 niuniu） */
function normalizeFactoryProviderKey(provider: string): string {
    const trimmed = typeof provider === 'string' ? provider.trim() : ''
    return getProviderKey(trimmed).toLowerCase()
}

/**
 * 根据 provider 创建图片生成器
 */
export function createImageGenerator(provider: string, modelId?: string): ImageGenerator {
    const normalizeModelId = (rawModelId?: string): string | undefined => {
        if (!rawModelId) return rawModelId
        const delimiterIndex = rawModelId.indexOf('::')
        return delimiterIndex === -1 ? rawModelId : rawModelId.slice(delimiterIndex + 2)
    }

    const actualModelId = normalizeModelId(modelId)
    const providerKey = normalizeFactoryProviderKey(provider)
    switch (providerKey) {
        case 'fal':
            return new FalBananaGenerator()
        case 'google':
            if (actualModelId === 'gemini-3-pro-image-preview-batch') {
                return new GoogleGeminiBatchImageGenerator()
            }
            if (actualModelId && actualModelId.startsWith('imagen-')) {
                return new GoogleImagenGenerator(actualModelId)
            }
            return new GoogleGeminiImageGenerator(actualModelId)
        case 'google-batch':  // 🔥 Gemini Batch 异步模式
            return new GoogleGeminiBatchImageGenerator()
        case 'imagen':
            return new GoogleImagenGenerator(actualModelId)
        case 'ark':
            return new ArkSeedreamGenerator()
        case 'gemini-compatible':
            return new GeminiCompatibleImageGenerator(actualModelId, provider)
        case 'openai-compatible':
            return new OpenAICompatibleImageGenerator(actualModelId, provider)
        case 'bailian':
            return new BailianImageGenerator()
        case 'siliconflow':
            return new SiliconFlowImageGenerator()
        case 'youchuan':
            return new YouchuanImageGenerator()
        default:
            throw new Error(`Unknown image generator provider: ${provider}`)
    }
}

/**
 * 根据 provider 创建视频生成器
 */
export function createVideoGenerator(provider: string, modelId?: string): VideoGenerator {
    const providerKey = normalizeFactoryProviderKey(provider)
    const videoModelId = typeof modelId === 'string' ? modelId.trim() : ''
    if (providerKey === 'gemini-compatible' && videoModelId.startsWith('doubao-seedance')) {
        return new ArkSeedanceVideoGenerator()
    }
    switch (providerKey) {
        case 'fal':
            return new FalVideoGenerator()
        case 'ark':
        case 'niuniu':
            return new ArkSeedanceVideoGenerator()
        case 'google':
            return new GoogleVeoVideoGenerator()
        case 'gemini-compatible':
            return new GoogleVeoVideoGenerator(provider)
        case 'minimax':
            return new MinimaxVideoGenerator()
        case 'vidu':
            return new ViduVideoGenerator()
        case 'kling':
            return new KlingVideoGenerator()
        case 'runninghub':
            return new RunningHubVideoGenerator()
        case 'openai-compatible':
            return new OpenAICompatibleVideoGenerator(provider)
        case 'bailian':
            return new BailianVideoGenerator()
        case 'siliconflow':
            return new SiliconFlowVideoGenerator()
        default:
            throw new Error(`Unknown video generator provider: ${provider}`)
    }
}

/**
 * 创建语音生成器
 */
export function createAudioGenerator(provider: string): AudioGenerator {
    const providerKey = normalizeFactoryProviderKey(provider)
    switch (providerKey) {
        case 'bailian':
            return new BailianAudioGenerator()
        case 'siliconflow':
            return new SiliconFlowAudioGenerator()
        default:
            throw new Error(`Unknown audio generator provider: ${provider}`)
    }
}
