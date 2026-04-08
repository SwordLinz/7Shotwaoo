import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

/**
 * POST /api/novel-promotion/[projectId]/editor/render
 *
 * Triggers a video render for an editor project.
 * Accepts either episodeId or editorProjectId to locate the record.
 */
export const POST = apiHandler(async (
    request: NextRequest,
    { params }: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await params
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult

    const body = await request.json()
    const { episodeId, editorProjectId, format = 'mp4', quality = 'high' } = body

    if (!episodeId && !editorProjectId) {
        throw new ApiError('INVALID_PARAMS')
    }

    const editorProject = episodeId
        ? await prisma.videoEditorProject.findUnique({ where: { episodeId } })
        : await prisma.videoEditorProject.findUnique({ where: { id: editorProjectId } })

    if (!editorProject) {
        throw new ApiError('NOT_FOUND')
    }

    const renderTaskId = `render_${Date.now()}`

    await prisma.videoEditorProject.update({
        where: { id: editorProject.id },
        data: {
            renderStatus: 'pending',
            renderTaskId,
        },
    })

    return NextResponse.json({
        status: 'pending',
        format,
        quality,
        renderTaskId,
    })
})

/**
 * GET /api/novel-promotion/[projectId]/editor/render?episodeId=<id>
 */
export const GET = apiHandler(async (
    request: NextRequest,
    { params }: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await params
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult

    const episodeId = request.nextUrl.searchParams.get('episodeId')
    const id = request.nextUrl.searchParams.get('id')

    if (!episodeId && !id) {
        throw new ApiError('INVALID_PARAMS')
    }

    const editorProject = episodeId
        ? await prisma.videoEditorProject.findUnique({
            where: { episodeId },
            select: { renderStatus: true, renderTaskId: true, outputUrl: true },
        })
        : await prisma.videoEditorProject.findUnique({
            where: { id: id! },
            select: { renderStatus: true, renderTaskId: true, outputUrl: true },
        })

    if (!editorProject) {
        throw new ApiError('NOT_FOUND')
    }

    return NextResponse.json({
        status: editorProject.renderStatus || 'none',
        outputUrl: editorProject.outputUrl,
        renderTaskId: editorProject.renderTaskId,
    })
})
