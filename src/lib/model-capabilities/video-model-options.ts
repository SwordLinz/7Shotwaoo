import { parseModelKeyStrict, type ModelCapabilities } from '@/lib/model-config-contract'

export type WorkflowModeForVideoFilter = 'srt' | 'agent' | 'smart-reference'

interface VideoModelCapabilityCarrier {
  capabilities?: ModelCapabilities
}

/** 与产品约定：智能参考可用的视频模型（目录未带 flag 时仍按 key 识别） */
const SMART_REF_VIDEO_IDS_BY_PROVIDER: Record<string, ReadonlySet<string>> = {
  kling: new Set(['kling-v3-omni', 'kling-video-o1']),
  runninghub: new Set(['sparkvideo-2.0-i2v', 'chaoneng-realpeople-i2v']),
}

function readGenerationModeOptions(model: VideoModelCapabilityCarrier): string[] {
  const options = model.capabilities?.video?.generationModeOptions
  if (!Array.isArray(options)) return []
  return options.filter((value): value is string => typeof value === 'string')
}

export function supportsFirstLastFrame(model: VideoModelCapabilityCarrier): boolean {
  return model.capabilities?.video?.firstlastframe === true
}

export function isFirstLastFrameOnlyModel(model: VideoModelCapabilityCarrier): boolean {
  const generationModeOptions = readGenerationModeOptions(model)
  if (generationModeOptions.length === 0) return false
  return generationModeOptions.every((mode) => mode === 'firstlastframe')
}

export function filterNormalVideoModelOptions<T extends VideoModelCapabilityCarrier>(models: T[]): T[] {
  return models.filter((model) => !isFirstLastFrameOnlyModel(model))
}

export function isSmartReferenceVideoModelKey(modelKey: string | null | undefined): boolean {
  const parsed = parseModelKeyStrict(modelKey)
  if (!parsed) return false
  const allowed = SMART_REF_VIDEO_IDS_BY_PROVIDER[parsed.provider]
  return !!allowed?.has(parsed.modelId)
}

/**
 * 智能参考流程：仅保留支持多参考图的模型（如 Kling Omni/O1、RunningHub 超能视频系列）。
 * 仅以 provider::modelId 白名单为准，避免目录字段被误标导致错误放行。
 */
export function isSmartReferenceVideoModel(
  model: VideoModelCapabilityCarrier & { value: string },
): boolean {
  return isSmartReferenceVideoModelKey(model.value)
}

export function filterSmartReferenceVideoModelOptions<
  T extends VideoModelCapabilityCarrier & { value: string },
>(models: T[]): T[] {
  return models.filter(isSmartReferenceVideoModel)
}

export function resolveVideoModelOptionsForWorkflow<
  T extends VideoModelCapabilityCarrier & { value: string },
>(models: T[], workflowMode: WorkflowModeForVideoFilter | undefined): T[] {
  const base = filterNormalVideoModelOptions(models)
  if (workflowMode === 'smart-reference') {
    return filterSmartReferenceVideoModelOptions(base)
  }
  return base
}
