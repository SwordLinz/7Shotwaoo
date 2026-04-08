import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { hasPanelVideoOutput } from '@/lib/task/has-output'
import { withTaskUiPayload } from '@/lib/task/ui-payload'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json()
  const locale = resolveRequiredTaskLocale(request, body)
  const isBatch = body?.all === true

  const provider = typeof body?.provider === 'string' ? body.provider : undefined
  const rhAppId = typeof body?.rhAppId === 'string' ? body.rhAppId : undefined
  const resolution = typeof body?.resolution === 'string' ? body.resolution : undefined
  const instanceType = typeof body?.instanceType === 'string' ? body.instanceType : undefined

  if (isBatch) {
    const episodeId = body?.episodeId
    if (!episodeId) {
      throw new ApiError('INVALID_PARAMS')
    }

    const panels = await prisma.novelPromotionPanel.findMany({
      where: {
        storyboard: { episodeId },
        videoPrompt: { not: null },
        OR: [
          { videoUrl: null },
          { videoUrl: '' },
        ],
      },
      select: { id: true },
    })

    if (panels.length === 0) {
      return NextResponse.json({ tasks: [], total: 0 })
    }

    const results = await Promise.all(
      panels.map(async (panel) =>
        submitTask({
          userId: session.user.id,
          locale,
          requestId: getRequestId(request),
          projectId,
          episodeId,
          type: TASK_TYPE.SMART_REF_VIDEO,
          targetType: 'NovelPromotionPanel',
          targetId: panel.id,
          payload: withTaskUiPayload(body, {
            hasOutputAtStart: await hasPanelVideoOutput(panel.id),
            provider,
            rhAppId,
            resolution,
            instanceType,
          }),
          dedupeKey: `smart_ref_video:${panel.id}`,
        }),
      ),
    )

    return NextResponse.json({ tasks: results, total: panels.length })
  }

  const panelId = body?.panelId
  if (!panelId || typeof panelId !== 'string') {
    throw new ApiError('INVALID_PARAMS', { code: 'PANEL_ID_REQUIRED', field: 'panelId' })
  }

  const panel = await prisma.novelPromotionPanel.findUnique({
    where: { id: panelId },
    select: { id: true, videoPrompt: true },
  })
  if (!panel) {
    throw new ApiError('NOT_FOUND')
  }
  if (!panel.videoPrompt) {
    throw new ApiError('INVALID_PARAMS', { code: 'VIDEO_PROMPT_MISSING' })
  }

  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    type: TASK_TYPE.SMART_REF_VIDEO,
    targetType: 'NovelPromotionPanel',
    targetId: panel.id,
    payload: withTaskUiPayload(body, {
      hasOutputAtStart: await hasPanelVideoOutput(panel.id),
      provider,
      rhAppId,
      resolution,
      instanceType,
    }),
    dedupeKey: `smart_ref_video:${panel.id}`,
  })

  return NextResponse.json(result)
})
