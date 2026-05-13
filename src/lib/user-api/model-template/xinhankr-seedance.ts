import type { OpenAICompatMediaTemplate } from '@/lib/openai-compat-media-template'

const XINHANKR_HOST = 'token.xinhankr.com'
const SEEDANCE_2_MODEL_IDS = new Set([
  'doubao-seedance-2-0-260128',
  'doubao-seedance-2-0-fast-260128',
])

export function isXinhankrBaseUrl(baseUrl: string | null | undefined): boolean {
  if (!baseUrl) return false
  try {
    return new URL(baseUrl).hostname.toLowerCase() === XINHANKR_HOST
  } catch {
    return false
  }
}

export function isXinhankrSeedance2VideoModel(input: {
  modelId: string
  type: string
  providerBaseUrl?: string | null
}): boolean {
  return input.type === 'video'
    && SEEDANCE_2_MODEL_IDS.has(input.modelId.trim())
    && isXinhankrBaseUrl(input.providerBaseUrl)
}

export function buildXinhankrSeedance2VideoTemplate(): OpenAICompatMediaTemplate {
  return {
    version: 1,
    mediaType: 'video',
    mode: 'async',
    create: {
      method: 'POST',
      path: '/v1/video/generations',
      contentType: 'application/json',
      bodyTemplate: {
        model: '{{model}}',
        content: [
          { type: 'text', text: '{{prompt}}' },
          { type: 'image_url', image_url: { url: '{{image}}' } },
        ],
        duration: '{{duration}}',
        ratio: '{{aspect_ratio}}',
      },
    },
    status: {
      method: 'GET',
      path: '/v1/video/generations/{{task_id}}',
    },
    content: {
      method: 'GET',
      path: '/v1/video/generations/{{task_id}}',
    },
    response: {
      taskIdPath: '$.id',
      statusPath: '$.status',
      outputUrlPath: '$.data[0].url',
      errorPath: '$.error.message',
    },
    polling: {
      intervalMs: 3000,
      timeoutMs: 600000,
      doneStates: ['completed', 'succeeded'],
      failStates: ['failed', 'error', 'canceled'],
    },
  }
}
