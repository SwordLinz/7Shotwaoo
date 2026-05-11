import { logError as _ulogError } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { attachMediaFieldsToGlobalCharacter } from '@/lib/media/attach'
import { resolveMediaRefFromLegacyValue } from '@/lib/media/service'
import { PRIMARY_APPEARANCE_INDEX, isArtStyleValue } from '@/lib/constants'
import { encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { resolveTaskLocale } from '@/lib/task/resolve-locale'
import { normalizeImageGenerationCount } from '@/lib/image-generation/count'

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
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
    characters.map((char) => attachMediaFieldsToGlobalCharacter(char)),
  )

  return NextResponse.json({ characters: signedCharacters })
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json()
  const taskLocale = resolveTaskLocale(request, body)
  const bodyMeta = toObject((body as Record<string, unknown>).meta)
  const acceptLanguage = request.headers.get('accept-language') || ''
  const {
    name,
    description,
    folderId,
    initialImageUrl,
    initialImageUrls,
    referenceImageUrl,
    referenceImageUrls,
    generateFromReference,
    artStyle,
    customDescription,
    useReferenceImagesWithCustomDescription,
  } = body
  const count = normalizeImageGenerationCount('reference-to-character', (body as Record<string, unknown>).count)

  if (!name) {
    throw new ApiError('INVALID_PARAMS')
  }

  const normalizedArtStyle = typeof artStyle === 'string' ? artStyle.trim() : ''
  if (!isArtStyleValue(normalizedArtStyle)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVALID_ART_STYLE',
      message: 'artStyle is required and must be a supported value',
    })
  }

  let allReferenceImages: string[] = []
  if (referenceImageUrls && Array.isArray(referenceImageUrls)) {
    allReferenceImages = referenceImageUrls
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .slice(0, 5)
  } else if (typeof referenceImageUrl === 'string' && referenceImageUrl.trim()) {
    allReferenceImages = [referenceImageUrl.trim()]
  }

  const initialImageList = Array.isArray(initialImageUrls)
    ? initialImageUrls
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .slice(0, 3)
    : []
  const initialAppearanceImages = initialImageList.length > 0
    ? initialImageList
    : (typeof initialImageUrl === 'string' && initialImageUrl.trim().length > 0 ? [initialImageUrl.trim()] : [])

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
      name: name.trim(),
      aliases: null,
    },
  })

  const descText = description?.trim() || `${name.trim()} 的角色设定`
  const primaryInitialImageUrl = initialAppearanceImages[0] || null
  const imageMedia = await resolveMediaRefFromLegacyValue(primaryInitialImageUrl)
  const appearance = await prisma.globalCharacterAppearance.create({
    data: {
      characterId: character.id,
      appearanceIndex: PRIMARY_APPEARANCE_INDEX,
      changeReason: '初始形象',
      artStyle: normalizedArtStyle,
      description: descText,
      descriptions: JSON.stringify([descText]),
      imageUrl: primaryInitialImageUrl,
      imageMediaId: imageMedia?.id || null,
      imageUrls: encodeImageUrls(initialAppearanceImages),
      selectedIndex: initialAppearanceImages.length > 0 ? 0 : null,
      previousImageUrls: encodeImageUrls([]),
    },
  })

  if (generateFromReference && allReferenceImages.length > 0 && initialAppearanceImages.length === 0) {
    const { getBaseUrl } = await import('@/lib/env')
    const baseUrl = getBaseUrl()
    fetch(`${baseUrl}/api/asset-hub/reference-to-character`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: request.headers.get('cookie') || '',
        ...(acceptLanguage ? { 'Accept-Language': acceptLanguage } : {}),
      },
      body: JSON.stringify({
        referenceImageUrls: allReferenceImages,
        characterName: name.trim(),
        characterId: character.id,
        appearanceId: appearance.id,
        count,
        isBackgroundJob: true,
        artStyle: normalizedArtStyle,
        customDescription: customDescription || undefined,
        useReferenceImagesWithCustomDescription: useReferenceImagesWithCustomDescription === true,
        locale: taskLocale || undefined,
        meta: {
          ...bodyMeta,
          locale: taskLocale || bodyMeta.locale || undefined,
        },
      }),
    }).catch((err) => {
      _ulogError('[Characters API] 后台生成任务触发失败:', err)
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
