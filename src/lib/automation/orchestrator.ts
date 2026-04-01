import fs from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '@/lib/prisma'
import { submitTask } from '@/lib/task/submitter'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import { ApiError } from '@/lib/api-errors'
import { isArtStyleValue } from '@/lib/constants'
import { getExportRoot, getAutomationUserId, getInternalBaseUrl } from '@/lib/automation/config'
import { toFetchableUrl } from '@/lib/storage'
import type { AutomationJob } from '@prisma/client'
import type { Locale } from '@/i18n/routing'
import { defaultLocale } from '@/i18n/routing'

const PHASE = {
  STORY_TO_SCRIPT: 'story_to_script',
  SCRIPT_TO_STORYBOARD: 'script_to_storyboard',
  STORYBOARD_READY: 'storyboard_ready',
  EXPORTED: 'exported',
} as const

const AUTOMATION_LOCALE: Locale = defaultLocale

function resolveAbsoluteMediaUrl(raw: string): string {
  const fetchable = toFetchableUrl(raw)
  if (fetchable.startsWith('http://') || fetchable.startsWith('https://')) return fetchable
  const base = getInternalBaseUrl()
  const pathPart = fetchable.startsWith('/') ? fetchable : `/${fetchable}`
  return `${base}${pathPart}`
}

async function fetchVideoToBuffer(url: string): Promise<Buffer> {
  const absolute = resolveAbsoluteMediaUrl(url)
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/i.test(absolute)
  const fetchOpts: RequestInit = {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WacooAutomation/1.0)' },
  }
  const { fetchDirect } = await import('../../../lib/prompts/proxy')
  const response = isLocal
    ? await fetchDirect(absolute, fetchOpts)
    : await fetch(absolute, fetchOpts)
  if (!response.ok) {
    throw new Error(`download failed: ${response.status} ${response.statusText}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

async function tryExportFirstPanelVideo(job: AutomationJob): Promise<string | null> {
  const root = getExportRoot()
  if (!root) return null

  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: job.episodeId },
    include: {
      storyboards: {
        include: {
          panels: { orderBy: { panelIndex: 'asc' } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!episode) return null

  let sourceUrl: string | null = null
  for (const sb of episode.storyboards) {
    for (const panel of sb.panels) {
      const u = panel.lipSyncVideoUrl || panel.videoUrl
      if (u && String(u).trim()) {
        sourceUrl = String(u).trim()
        break
      }
    }
    if (sourceUrl) break
  }
  if (!sourceUrl) return null

  await fs.mkdir(root, { recursive: true })
  const outPath = path.join(root, `${job.id}.mp4`)
  const buf = await fetchVideoToBuffer(sourceUrl)
  await fs.writeFile(outPath, buf)
  return outPath
}

async function findLatestEpisodeTask(projectId: string, episodeId: string, type: string) {
  return prisma.task.findFirst({
    where: { projectId, episodeId, type },
    orderBy: { createdAt: 'desc' },
  })
}

async function submitStoryToScript(userId: string, projectId: string, episodeId: string, script: string) {
  return submitTask({
    userId,
    locale: AUTOMATION_LOCALE,
    requestId: undefined,
    projectId,
    episodeId,
    type: TASK_TYPE.STORY_TO_SCRIPT_RUN,
    targetType: 'NovelPromotionEpisode',
    targetId: episodeId,
    payload: {
      episodeId,
      content: script,
      displayMode: 'detail',
      meta: { locale: AUTOMATION_LOCALE },
    },
    dedupeKey: `story_to_script_run:${episodeId}`,
    priority: 2,
  })
}

async function submitScriptToStoryboard(userId: string, projectId: string, episodeId: string) {
  return submitTask({
    userId,
    locale: AUTOMATION_LOCALE,
    requestId: undefined,
    projectId,
    episodeId,
    type: TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN,
    targetType: 'NovelPromotionEpisode',
    targetId: episodeId,
    payload: {
      episodeId,
      displayMode: 'detail',
      meta: { locale: AUTOMATION_LOCALE },
    },
    dedupeKey: `script_to_storyboard_run:${episodeId}`,
    priority: 2,
  })
}

export async function createAutomationJob(params: { script: string; name?: string }) {
  const userId = getAutomationUserId()
  if (!userId) {
    throw new ApiError('INVALID_PARAMS', { message: 'WACOO_AUTOMATION_USER_ID is not set' })
  }

  const script = params.script.trim()
  if (!script) {
    throw new ApiError('INVALID_PARAMS', { message: 'script is required' })
  }

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) {
    throw new ApiError('INVALID_PARAMS', { message: 'automation user not found' })
  }

  const userPreference = await prisma.userPreference.findUnique({
    where: { userId },
  })

  const projectName = (params.name?.trim() || `Automation ${new Date().toISOString().slice(0, 19)}`).slice(0, 100)

  const project = await prisma.project.create({
    data: {
      name: projectName,
      description: 'Created by automation API',
      mode: 'novel-promotion',
      userId,
    },
  })

  await prisma.novelPromotionProject.create({
    data: {
      projectId: project.id,
      ...(userPreference && {
        analysisModel: userPreference.analysisModel,
        characterModel: userPreference.characterModel,
        locationModel: userPreference.locationModel,
        storyboardModel: userPreference.storyboardModel,
        editModel: userPreference.editModel,
        videoModel: userPreference.videoModel,
        audioModel: userPreference.audioModel,
        videoRatio: userPreference.videoRatio,
        artStyle: isArtStyleValue(userPreference.artStyle) ? userPreference.artStyle : 'american-comic',
        ttsRate: userPreference.ttsRate,
      }),
    },
  })

  const novelData = await prisma.novelPromotionProject.findUnique({
    where: { projectId: project.id },
  })
  if (!novelData) {
    throw new ApiError('INTERNAL_ERROR', { message: 'novel promotion create failed' })
  }

  const episode = await prisma.novelPromotionEpisode.create({
    data: {
      novelPromotionProjectId: novelData.id,
      episodeNumber: 1,
      name: '第1集',
      novelText: script,
    },
  })

  await prisma.novelPromotionProject.update({
    where: { id: novelData.id },
    data: { lastEpisodeId: episode.id },
  })

  const job = await prisma.automationJob.create({
    data: {
      userId,
      projectId: project.id,
      episodeId: episode.id,
      status: 'running',
      phase: PHASE.STORY_TO_SCRIPT,
    },
  })

  try {
    await submitStoryToScript(userId, project.id, episode.id, script)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await prisma.automationJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        phase: PHASE.STORY_TO_SCRIPT,
        errorCode: e instanceof ApiError ? 'TASK_SUBMIT_FAILED' : 'INTERNAL_ERROR',
        errorMessage: message.slice(0, 2000),
      },
    })
    throw e
  }

  return job
}

async function markJobFailed(jobId: string, code: string, message: string) {
  await prisma.automationJob.update({
    where: { id: jobId },
    data: {
      status: 'failed',
      errorCode: code,
      errorMessage: message.slice(0, 2000),
    },
  })
}

export async function advanceAutomationJob(jobId: string): Promise<AutomationJob> {
  const job = await prisma.automationJob.findUnique({ where: { id: jobId } })
  if (!job) {
    throw new ApiError('NOT_FOUND', { message: 'job not found' })
  }

  if (job.status === 'failed') {
    return job
  }
  if (job.status === 'completed') {
    return job
  }

  if (job.phase === PHASE.STORY_TO_SCRIPT) {
    const task = await findLatestEpisodeTask(job.projectId, job.episodeId, TASK_TYPE.STORY_TO_SCRIPT_RUN)
    if (!task) {
      return job
    }
    if (task.status === TASK_STATUS.FAILED) {
      await markJobFailed(job.id, task.errorCode || 'TASK_FAILED', task.errorMessage || 'story_to_script failed')
      return (await prisma.automationJob.findUnique({ where: { id: jobId } }))!
    }
    if (task.status === TASK_STATUS.COMPLETED) {
      try {
        await submitScriptToStoryboard(job.userId, job.projectId, job.episodeId)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        await markJobFailed(job.id, 'TASK_SUBMIT_FAILED', message)
        throw e
      }
      return prisma.automationJob.update({
        where: { id: job.id },
        data: { phase: PHASE.SCRIPT_TO_STORYBOARD },
      })
    }
    return job
  }

  if (job.phase === PHASE.SCRIPT_TO_STORYBOARD) {
    const task = await findLatestEpisodeTask(job.projectId, job.episodeId, TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN)
    if (!task) {
      return job
    }
    if (task.status === TASK_STATUS.FAILED) {
      await markJobFailed(job.id, task.errorCode || 'TASK_FAILED', task.errorMessage || 'script_to_storyboard failed')
      return (await prisma.automationJob.findUnique({ where: { id: jobId } }))!
    }
    if (task.status === TASK_STATUS.COMPLETED) {
      let localPath: string | null = null
      try {
        localPath = await tryExportFirstPanelVideo(job)
      } catch {
        localPath = null
      }

      if (localPath) {
        return prisma.automationJob.update({
          where: { id: job.id },
          data: {
            status: 'completed',
            phase: PHASE.EXPORTED,
            localPath,
            errorMessage: null,
          },
        })
      }

      return prisma.automationJob.update({
        where: { id: job.id },
        data: {
          status: 'running',
          phase: PHASE.STORYBOARD_READY,
          errorMessage:
            '分镜已生成；尚未检测到成片视频（需在 Wacoo 内继续生成分镜图与视频）。配置 WACOO_EXPORT_ROOT 后，生成视频后可再次 GET 本任务以尝试导出到本地目录。',
        },
      })
    }
    return job
  }

  if (job.phase === PHASE.STORYBOARD_READY && !job.localPath) {
    try {
      const localPath = await tryExportFirstPanelVideo(job)
      if (localPath) {
        return prisma.automationJob.update({
          where: { id: job.id },
          data: {
            status: 'completed',
            phase: PHASE.EXPORTED,
            localPath,
            errorMessage: null,
          },
        })
      }
    } catch {
      // keep storyboard_ready
    }
  }

  return job
}
