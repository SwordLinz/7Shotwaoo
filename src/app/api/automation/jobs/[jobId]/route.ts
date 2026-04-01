import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { requireAutomationAuth } from '@/lib/automation/auth'
import { advanceAutomationJob } from '@/lib/automation/orchestrator'

export const runtime = 'nodejs'

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) => {
  const denied = requireAutomationAuth(request)
  if (denied) return denied

  const { jobId } = await context.params
  const job = await advanceAutomationJob(jobId.trim())

  return NextResponse.json({
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
  })
})
