import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireAutomationAuth } from '@/lib/automation/auth'
import { createAutomationJob } from '@/lib/automation/orchestrator'

export const runtime = 'nodejs'

export const POST = apiHandler(async (request: NextRequest) => {
  const denied = requireAutomationAuth(request)
  if (denied) return denied

  const body = await request.json().catch(() => ({}))
  const script = typeof body?.script === 'string' ? body.script : ''
  const name = typeof body?.name === 'string' ? body.name : undefined

  if (!script.trim()) {
    throw new ApiError('INVALID_PARAMS', { message: 'script is required' })
  }

  const job = await createAutomationJob({ script, name })

  return NextResponse.json(
    {
      job: {
        id: job.id,
        projectId: job.projectId,
        episodeId: job.episodeId,
        status: job.status,
        phase: job.phase,
        localPath: job.localPath,
        errorCode: job.errorCode,
        errorMessage: job.errorMessage,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
      },
    },
    { status: 201 },
  )
})
