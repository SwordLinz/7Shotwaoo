import { parseModelKeyStrict, type CapabilityValue } from '@/lib/model-config-contract'
import { findBuiltinCapabilities } from '@/lib/model-capabilities/catalog'
import { findBuiltinPricingCatalogEntry } from '@/lib/model-pricing/catalog'
import {
  normalizeVideoGenerationSelections,
  resolveEffectiveVideoCapabilityDefinitions,
} from '@/lib/model-capabilities/video-effective'

type AnyPayload = Record<string, unknown>

function isRecord(value: unknown): value is AnyPayload {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isCapabilityValue(value: unknown): value is CapabilityValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function toCapabilitySelections(value: unknown): Record<string, CapabilityValue> {
  if (!isRecord(value)) return {}
  const selections: Record<string, CapabilityValue> = {}
  for (const [field, raw] of Object.entries(value)) {
    if (!isCapabilityValue(raw)) continue
    selections[field] = raw
  }
  return selections
}

export function resolveVideoGenerationModeFromPayload(payload: unknown): 'normal' | 'firstlastframe' {
  if (!isRecord(payload)) return 'normal'
  return isRecord(payload.firstLastFrame) ? 'firstlastframe' : 'normal'
}

export function resolveVideoModelKeyFromPayload(payload: unknown): string | null {
  if (!isRecord(payload)) return null
  const firstLast = isRecord(payload.firstLastFrame) ? payload.firstLastFrame : null
  if (firstLast && typeof firstLast.flModel === 'string' && parseModelKeyStrict(firstLast.flModel)) {
    return firstLast.flModel
  }
  if (typeof payload.videoModel === 'string' && parseModelKeyStrict(payload.videoModel)) {
    return payload.videoModel
  }
  return null
}

export function resolveVideoRuntimeSelectionsFromPayload(payload: unknown): Record<string, CapabilityValue> {
  const selections = isRecord(payload) ? toCapabilitySelections(payload.generationOptions) : {}
  if (!isRecord(payload)) return selections

  if (typeof payload.duration === 'number' && Number.isFinite(payload.duration)) {
    selections.duration = payload.duration
  }
  if (typeof payload.resolution === 'string' && payload.resolution.trim()) {
    selections.resolution = payload.resolution.trim()
  }
  if (typeof payload.aspectRatio === 'string' && payload.aspectRatio.trim()) {
    selections.aspectRatio = payload.aspectRatio.trim()
  }
  if (typeof payload.generateAudio === 'boolean') {
    selections.generateAudio = payload.generateAudio
  }
  selections.generationMode = resolveVideoGenerationModeFromPayload(payload)

  return selections
}

export function resolveCanonicalVideoGenerationOptions(input: {
  modelKey: string
  payload?: unknown
  runtimeSelections?: Record<string, CapabilityValue>
}): Record<string, CapabilityValue> {
  const parsed = parseModelKeyStrict(input.modelKey)
  if (!parsed) return input.runtimeSelections || resolveVideoRuntimeSelectionsFromPayload(input.payload)

  const capabilities = findBuiltinCapabilities('video', parsed.provider, parsed.modelId)
  const pricingEntry = findBuiltinPricingCatalogEntry('video', parsed.provider, parsed.modelId)
  const pricingTiers = pricingEntry?.pricing.mode === 'capability'
    ? pricingEntry.pricing.tiers
    : []
  const definitions = resolveEffectiveVideoCapabilityDefinitions({
    videoCapabilities: capabilities?.video,
    pricingTiers,
  })
  const runtimeSelections = {
    ...resolveVideoRuntimeSelectionsFromPayload(input.payload),
    ...(input.runtimeSelections || {}),
  }

  if (definitions.length === 0) return runtimeSelections

  return normalizeVideoGenerationSelections({
    definitions,
    pricingTiers,
    selection: runtimeSelections,
  })
}

export function buildCanonicalVideoPayload(input: {
  payload: unknown
  modelKey?: string | null
  generationOptions?: Record<string, CapabilityValue> | null
}): unknown {
  if (!isRecord(input.payload)) return input.payload
  const modelKey = input.modelKey || resolveVideoModelKeyFromPayload(input.payload)
  if (!modelKey) return input.payload
  const generationOptions = input.generationOptions || resolveCanonicalVideoGenerationOptions({
    modelKey,
    payload: input.payload,
  })

  return {
    ...input.payload,
    generationOptions: {
      ...toCapabilitySelections(input.payload.generationOptions),
      ...generationOptions,
    },
  }
}
