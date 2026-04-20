import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'

/**
 * DELETE - Remove a reference asset
 */
export const DELETE = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; assetId: string }> },
) => {
  const { projectId, assetId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const novelProject = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: { id: true },
  })
  if (!novelProject) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const asset = await prisma.novelPromotionReferenceAsset.findFirst({
    where: { id: assetId, novelPromotionProjectId: novelProject.id },
  })
  if (!asset) {
    return NextResponse.json({ error: 'Reference asset not found' }, { status: 404 })
  }

  await prisma.novelPromotionReferenceAsset.delete({
    where: { id: assetId },
  })

  return NextResponse.json({ success: true })
})
