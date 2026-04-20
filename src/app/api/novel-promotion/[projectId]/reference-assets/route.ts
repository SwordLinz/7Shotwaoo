import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'

/**
 * GET - List reference assets for a project
 */
export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const novelProject = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: { id: true },
  })
  if (!novelProject) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const assets = await prisma.novelPromotionReferenceAsset.findMany({
    where: { novelPromotionProjectId: novelProject.id },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({
    referenceAssets: assets.map((a) => ({
      id: a.id,
      name: a.name,
      imageUrl: a.imageUrl,
      sourceType: a.sourceType,
      createdAt: a.createdAt.toISOString(),
    })),
  })
})

/**
 * POST - Create a new reference asset
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const novelProject = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: { id: true },
  })
  if (!novelProject) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const body = await request.json()
  const { name, imageUrl, sourceType } = body

  if (!name || !imageUrl) {
    return NextResponse.json({ error: 'name and imageUrl are required' }, { status: 400 })
  }

  const validSourceTypes = ['pose-screenshot', 'comfyui-output', 'manual-upload']
  const resolvedSourceType = validSourceTypes.includes(sourceType) ? sourceType : 'manual-upload'

  const asset = await prisma.novelPromotionReferenceAsset.create({
    data: {
      novelPromotionProjectId: novelProject.id,
      name,
      imageUrl,
      sourceType: resolvedSourceType,
    },
  })

  return NextResponse.json({
    id: asset.id,
    name: asset.name,
    imageUrl: asset.imageUrl,
    sourceType: asset.sourceType,
    createdAt: asset.createdAt.toISOString(),
  })
})
