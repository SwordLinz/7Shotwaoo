import { logError as _ulogError } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { attachMediaFieldsToGlobalCharacter } from '@/lib/media/attach'
import {
  resolveMediaRefFromLegacyValue,
  resolveStorageKeyFromMediaValue,
} from '@/lib/media/service'
import { PRIMARY_APPEARANCE_INDEX, isArtStyleValue } from '@/lib/constants'
import { encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { resolveTaskLocale } from '@/lib/task/resolve-locale'
import { normalizeImageGenerationCount } from '@/lib/image-generation/count'

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => normalizeString(item))
    .filter(Boolean)
    .slice(0, limit)
}

async function normalizeMediaValues(values: string[]): Promise<string[]> {
  const normalizedValues = await Promise.all(
    values.map(async (value) => (await resolveStorageKeyFromMediaValue(value)) || value),
  )
  return normalizedValues.filter(Boolean)
}

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const { searchParams } = new URL(request.url)
  const folderId = searchParams.get('folderId')

  const where: Record<string, unknown> = { userId: session.user.id }
  if (folderId === 'null') {
    where.folderId = null
  } else if (folderId) {
    where.folderId = folderId
  }

  const characters = await prisma.globalCharacter.findMany({
    where,
    include: { appearances: true },
    orderBy: { createdAt: 'desc' },
  })

  const signedCharacters = await Promise.all(
    characters.map((character) => attachMediaFieldsToGlobalCharacter(character)),
  )

  return NextResponse.json({ characters: signedCharacters })
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const rawBody = await request.json().catch(() => ({}))
  const body = toObject(rawBody)
  const taskLocale = resolveTaskLocale(request, body)
  const bodyMeta = toObject(body.meta)
  const acceptLanguage = request.headers.get('accept-language') || ''

  const name = normalizeString(body.name)
  const description = normalizeString(body.description)
  const folderId = normalizeString(body.folderId)
  const initialImageUrl = normalizeString(body.initialImageUrl)
  const initialImageUrls = normalizeStringArray(body.initialImageUrls, 3)
  const referenceImageUrl = normalizeString(body.referenceImageUrl)
  const referenceImageUrls = normalizeStringArray(body.referenceImageUrls, 5)
  const generateFromReference = body.generateFromReference === true
  const artStyle = normalizeString(body.artStyle)
  const customDescription = normalizeString(body.customDescription)
  const count = normalizeImageGenerationCount('reference-to-character', body.count)

  if (!name) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (!isArtStyleValue(artStyle)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVALID_ART_STYLE',
      message: 'artStyle is required and must be a supported value',
    })
  }

  const allReferenceImages = referenceImageUrls.length > 0
    ? referenceImageUrls
    : (referenceImageUrl ? [referenceImageUrl] : [])
  const rawInitialImages = initialImageUrls.length > 0
    ? initialImageUrls
    : (initialImageUrl ? [initialImageUrl] : [])
  const normalizedInitialImages = await normalizeMediaValues(rawInitialImages)
  const selectedInitialImage = normalizedInitialImages[0] || null
  const selectedImageMedia = selectedInitialImage
    ? await resolveMediaRefFromLegacyValue(selectedInitialImage)
    : null

  if (folderId) {
    const folder = await prisma.globalAssetFolder.findUnique({
      where: { id: folderId },
    })
    if (!folder || folder.userId !== session.user.id) {
      throw new ApiError('INVALID_PARAMS')
    }
  }

  const character = await prisma.globalCharacter.create({
    data: {
      userId: session.user.id,
      folderId: folderId || null,
      name,
      aliases: null,
    },
  })

  const descText = description || `${name} 的角色设定`
  const appearance = await prisma.globalCharacterAppearance.create({
    data: {
      characterId: character.id,
      appearanceIndex: PRIMARY_APPEARANCE_INDEX,
      changeReason: '初始形象',
      artStyle,
      description: descText,
      descriptions: JSON.stringify([descText]),
      imageUrl: selectedInitialImage,
      imageMediaId: selectedImageMedia?.id || null,
      imageUrls: encodeImageUrls(normalizedInitialImages),
      selectedIndex: normalizedInitialImages.length > 0 ? 0 : null,
      previousImageUrls: encodeImageUrls([]),
    },
  })

  if (generateFromReference && allReferenceImages.length > 0) {
    const { getBaseUrl } = await import('@/lib/env')
    const baseUrl = getBaseUrl()
    fetch(`${baseUrl}/api/asset-hub/reference-to-character`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': request.headers.get('cookie') || '',
        ...(acceptLanguage ? { 'Accept-Language': acceptLanguage } : {}),
      },
      body: JSON.stringify({
        referenceImageUrls: allReferenceImages,
        characterName: name,
        characterId: character.id,
        appearanceId: appearance.id,
        count,
        isBackgroundJob: true,
        artStyle,
        customDescription: customDescription || undefined,
        locale: taskLocale || undefined,
        meta: {
          ...bodyMeta,
          locale: taskLocale || bodyMeta.locale || undefined,
        },
      }),
    }).catch((error) => {
      _ulogError('[Characters API] Failed to trigger reference character generation:', error)
    })
  }

  const characterWithAppearances = await prisma.globalCharacter.findUnique({
    where: { id: character.id },
    include: { appearances: true },
  })

  const withMedia = characterWithAppearances
    ? await attachMediaFieldsToGlobalCharacter(characterWithAppearances)
    : characterWithAppearances

  return NextResponse.json({ success: true, character: withMedia })
})
