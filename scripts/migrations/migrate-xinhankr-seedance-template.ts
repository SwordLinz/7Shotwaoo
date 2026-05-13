import { prisma } from '@/lib/prisma'
import {
  buildXinhankrSeedance2VideoTemplate,
  isXinhankrBaseUrl,
  isXinhankrSeedance2VideoModel,
} from '@/lib/user-api/model-template/xinhankr-seedance'

const APPLY = process.argv.includes('--apply')

type PreferenceRow = {
  id: string
  userId: string
  customProviders: string | null
  customModels: string | null
}

type MigrationSummary = {
  mode: 'dry-run' | 'apply'
  scanned: number
  updatedRows: number
  updatedModels: number
  xinhankrProviders: number
  skippedInvalidProviderRows: number
  skippedInvalidModelRows: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseJsonArray(raw: string | null): unknown[] | null {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function collectXinhankrProviderBaseUrls(rawProviders: string | null): Map<string, string> | null {
  const providers = parseJsonArray(rawProviders)
  if (!providers) return null

  const result = new Map<string, string>()
  for (const item of providers) {
    if (!isRecord(item)) continue
    const id = readTrimmedString(item.id)
    const baseUrl = readTrimmedString(item.baseUrl)
    if (!id || !isXinhankrBaseUrl(baseUrl)) continue
    result.set(id, baseUrl)
  }
  return result
}

function migrateModels(rawModels: string | null, providerBaseUrls: Map<string, string>): {
  nextRaw: string | null
  changed: boolean
  updatedModels: number
  invalid: boolean
} {
  const models = parseJsonArray(rawModels)
  if (!models) {
    return { nextRaw: rawModels, changed: false, updatedModels: 0, invalid: true }
  }

  let updatedModels = 0
  const template = buildXinhankrSeedance2VideoTemplate()
  const nextModels = models.map((item) => {
    if (!isRecord(item)) return item
    const provider = readTrimmedString(item.provider)
    const modelId = readTrimmedString(item.modelId)
    const type = readTrimmedString(item.type)
    const providerBaseUrl = providerBaseUrls.get(provider)
    if (!isXinhankrSeedance2VideoModel({ modelId, type, providerBaseUrl })) {
      return item
    }
    if (JSON.stringify(item.compatMediaTemplate) === JSON.stringify(template)) {
      return item
    }

    updatedModels += 1
    return {
      ...item,
      compatMediaTemplate: template,
      compatMediaTemplateCheckedAt: new Date().toISOString(),
      compatMediaTemplateSource: 'manual',
    }
  })

  return {
    nextRaw: JSON.stringify(nextModels),
    changed: updatedModels > 0,
    updatedModels,
    invalid: false,
  }
}

async function main() {
  const summary: MigrationSummary = {
    mode: APPLY ? 'apply' : 'dry-run',
    scanned: 0,
    updatedRows: 0,
    updatedModels: 0,
    xinhankrProviders: 0,
    skippedInvalidProviderRows: 0,
    skippedInvalidModelRows: 0,
  }

  const rows = await prisma.userPreference.findMany({
    select: {
      id: true,
      userId: true,
      customProviders: true,
      customModels: true,
    },
  }) as PreferenceRow[]
  summary.scanned = rows.length

  for (const row of rows) {
    const providerBaseUrls = collectXinhankrProviderBaseUrls(row.customProviders)
    if (!providerBaseUrls) {
      summary.skippedInvalidProviderRows += 1
      continue
    }
    summary.xinhankrProviders += providerBaseUrls.size
    if (providerBaseUrls.size === 0) continue

    const result = migrateModels(row.customModels, providerBaseUrls)
    if (result.invalid) {
      summary.skippedInvalidModelRows += 1
      continue
    }
    if (!result.changed) continue

    summary.updatedRows += 1
    summary.updatedModels += result.updatedModels
    if (APPLY) {
      await prisma.userPreference.update({
        where: { id: row.id },
        data: {
          customModels: result.nextRaw,
        },
      })
    }
  }

  console.log(JSON.stringify(summary, null, 2))
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (error: unknown) => {
    console.error('[migrate-xinhankr-seedance-template] failed', error)
    await prisma.$disconnect()
    process.exit(1)
  })
