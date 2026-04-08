import fs from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '@/lib/prisma'
import { submitTask } from '@/lib/task/submitter'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import { ApiError } from '@/lib/api-errors'
import { isArtStyleValue } from '@/lib/constants'
import { getExportRoot, getAutomationUserId, getInternalBaseUrl } from '@/lib/automation/config'
import { toFetchableUrl, getObjectBuffer } from '@/lib/storage'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { getProjectModelConfig } from '@/lib/config-service'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { BillingOperationError } from '@/lib/billing/errors'
import type { AutomationJob } from '@prisma/client'
import type { Locale } from '@/i18n/routing'
import { defaultLocale } from '@/i18n/routing'
import archiver from 'archiver'
import type { TaskType, TaskBillingInfo } from '@/lib/task/types'

function safeBuildBillingInfo(taskType: TaskType, payload: Record<string, unknown>): TaskBillingInfo | null {
  try {
    return buildDefaultTaskBillingInfo(taskType, payload)
  } catch (err) {
    if (err instanceof BillingOperationError) return null
    return null
  }
}

const PHASE = {
  STORY_TO_SCRIPT: 'story_to_script',
  SCRIPT_TO_STORYBOARD: 'script_to_storyboard',
  STORYBOARD_READY: 'storyboard_ready',
  CONFIRMING_PROFILES: 'confirming_profiles',
  GENERATING_ASSETS: 'generating_assets',
  GENERATING_PANEL_IMAGES: 'generating_panel_images',
  GENERATING_VIDEOS: 'generating_videos',
  VIDEOS_READY: 'videos_ready',
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

async function getEpisodePanels(episodeId: string) {
  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    include: {
      storyboards: {
        include: {
          clip: true,
          panels: { orderBy: { panelIndex: 'asc' } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  return episode
}

async function submitPanelImageTasks(
  userId: string, projectId: string, episodeId: string,
): Promise<{ submitted: number; skipped: number }> {
  const episode = await getEpisodePanels(episodeId)
  if (!episode) return { submitted: 0, skipped: 0 }

  const config = await getProjectModelConfig(projectId, userId)
  if (!config.storyboardModel) {
    throw new Error('storyboardModel not configured on project')
  }

  let submitted = 0
  let skipped = 0

  for (const sb of episode.storyboards) {
    for (const panel of sb.panels) {
      if (panel.imageUrl) {
        skipped++
        continue
      }
      const billingPayload = {
        panelId: panel.id,
        candidateCount: 1,
        imageModel: config.storyboardModel,
        resolution: '1K',
        meta: { locale: AUTOMATION_LOCALE },
      }
      await submitTask({
        userId,
        locale: AUTOMATION_LOCALE,
        requestId: undefined,
        projectId,
        episodeId,
        type: TASK_TYPE.IMAGE_PANEL,
        targetType: 'NovelPromotionPanel',
        targetId: panel.id,
        payload: billingPayload,
        dedupeKey: `automation_image_panel:${panel.id}`,
        billingInfo: safeBuildBillingInfo(TASK_TYPE.IMAGE_PANEL, billingPayload),
      })
      submitted++
    }
  }

  return { submitted, skipped }
}

async function submitVideoPanelTasks(
  userId: string, projectId: string, episodeId: string,
): Promise<{ submitted: number; skipped: number }> {
  const episode = await getEpisodePanels(episodeId)
  if (!episode) return { submitted: 0, skipped: 0 }

  const config = await getProjectModelConfig(projectId, userId)
  if (!config.videoModel) {
    throw new Error('videoModel not configured on project')
  }

  let submitted = 0
  let skipped = 0

  for (const sb of episode.storyboards) {
    for (const panel of sb.panels) {
      if (!panel.imageUrl) {
        skipped++
        continue
      }
      if (panel.videoUrl) {
        skipped++
        continue
      }
      const billingPayload = {
        videoModel: config.videoModel,
        storyboardId: sb.id,
        panelIndex: panel.panelIndex,
        generationMode: 'normal',
        meta: { locale: AUTOMATION_LOCALE },
      }
      await submitTask({
        userId,
        locale: AUTOMATION_LOCALE,
        requestId: undefined,
        projectId,
        episodeId,
        type: TASK_TYPE.VIDEO_PANEL,
        targetType: 'NovelPromotionPanel',
        targetId: panel.id,
        payload: billingPayload,
        dedupeKey: `automation_video_panel:${panel.id}`,
        billingInfo: safeBuildBillingInfo(TASK_TYPE.VIDEO_PANEL, billingPayload),
      })
      submitted++
    }
  }

  return { submitted, skipped }
}

// ─── Helper: resolve NovelPromotionProject.id from Project.id ───

async function getNpProjectId(projectId: string): Promise<string | null> {
  const np = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: { id: true },
  })
  return np?.id || null
}

// ─── Character profile confirmation ───

async function submitProfileConfirmation(
  userId: string, projectId: string,
): Promise<{ submitted: boolean }> {
  const npProjectId = await getNpProjectId(projectId)
  if (!npProjectId) return { submitted: false }

  const unconfirmed = await prisma.novelPromotionCharacter.count({
    where: { novelPromotionProjectId: npProjectId, profileConfirmed: false },
  })
  if (unconfirmed === 0) return { submitted: false }

  await submitTask({
    userId,
    locale: AUTOMATION_LOCALE,
    requestId: undefined,
    projectId,
    type: TASK_TYPE.CHARACTER_PROFILE_BATCH_CONFIRM,
    targetType: 'NovelPromotionProject',
    targetId: projectId,
    payload: { meta: { locale: AUTOMATION_LOCALE } },
    dedupeKey: `automation_profile_confirm:${projectId}`,
  })
  return { submitted: true }
}

async function checkProfilesConfirmed(projectId: string): Promise<{
  ready: boolean; total: number; confirmed: number
}> {
  const npProjectId = await getNpProjectId(projectId)
  if (!npProjectId) return { ready: true, total: 0, confirmed: 0 }

  const total = await prisma.novelPromotionCharacter.count({
    where: { novelPromotionProjectId: npProjectId },
  })
  const confirmed = await prisma.novelPromotionCharacter.count({
    where: { novelPromotionProjectId: npProjectId, profileConfirmed: true },
  })
  return { ready: total === 0 || confirmed === total, total, confirmed }
}

// ─── Asset generation (character appearances + location images) ───

async function submitAssetImageTasks(
  userId: string, projectId: string, episodeId: string,
): Promise<{ characters: number; locations: number }> {
  const npProjectId = await getNpProjectId(projectId)
  if (!npProjectId) return { characters: 0, locations: 0 }

  const config = await getProjectModelConfig(projectId, userId)
  let charSubmitted = 0
  let locSubmitted = 0

  if (config.characterModel) {
    const characters = await prisma.novelPromotionCharacter.findMany({
      where: { novelPromotionProjectId: npProjectId },
      include: { appearances: { orderBy: { appearanceIndex: 'asc' } } },
    })

    for (const char of characters) {
      let appearance = char.appearances[0]
      if (!appearance) {
        appearance = await prisma.characterAppearance.create({
          data: {
            characterId: char.id,
            appearanceIndex: 0,
            changeReason: '默认形象',
            description: char.introduction || char.name,
            descriptions: JSON.stringify([char.introduction || char.name]),
            imageUrls: '[]',
            previousImageUrls: '[]',
          },
        })
      }

      if (appearance.imageUrl) continue

      const billingPayload = {
        imageModel: config.characterModel,
        type: 'character',
        id: char.id,
        appearanceId: appearance.id,
        count: 1,
        meta: { locale: AUTOMATION_LOCALE },
      }
      await submitTask({
        userId,
        locale: AUTOMATION_LOCALE,
        requestId: undefined,
        projectId,
        episodeId,
        type: TASK_TYPE.IMAGE_CHARACTER,
        targetType: 'CharacterAppearance',
        targetId: appearance.id,
        payload: billingPayload,
        dedupeKey: `automation_char_image:${appearance.id}`,
        billingInfo: safeBuildBillingInfo(TASK_TYPE.IMAGE_CHARACTER, billingPayload),
      })
      charSubmitted++
    }
  }

  if (config.locationModel) {
    const locations = await prisma.novelPromotionLocation.findMany({
      where: { novelPromotionProjectId: npProjectId },
      include: { images: { orderBy: { imageIndex: 'asc' } } },
    })

    for (const loc of locations) {
      const firstImage = loc.images[0]
      if (firstImage?.imageUrl) continue

      if (!firstImage) {
        await prisma.locationImage.create({
          data: {
            locationId: loc.id,
            imageIndex: 0,
            description: loc.summary || loc.name,
          },
        })
      }

      const billingPayload = {
        imageModel: config.locationModel,
        type: 'location',
        id: loc.id,
        count: 1,
        meta: { locale: AUTOMATION_LOCALE },
      }
      await submitTask({
        userId,
        locale: AUTOMATION_LOCALE,
        requestId: undefined,
        projectId,
        episodeId,
        type: TASK_TYPE.IMAGE_LOCATION,
        targetType: 'LocationImage',
        targetId: loc.id,
        payload: billingPayload,
        dedupeKey: `automation_loc_image:${loc.id}`,
        billingInfo: safeBuildBillingInfo(TASK_TYPE.IMAGE_LOCATION, billingPayload),
      })
      locSubmitted++
    }
  }

  return { characters: charSubmitted, locations: locSubmitted }
}

async function checkAllAssetImagesReady(projectId: string): Promise<{
  ready: boolean; charTotal: number; charDone: number; locTotal: number; locDone: number; failed: number
}> {
  const npProjectId = await getNpProjectId(projectId)
  if (!npProjectId) return { ready: true, charTotal: 0, charDone: 0, locTotal: 0, locDone: 0, failed: 0 }

  const characters = await prisma.novelPromotionCharacter.findMany({
    where: { novelPromotionProjectId: npProjectId },
    include: { appearances: { orderBy: { appearanceIndex: 'asc' } } },
  })

  let charTotal = 0
  let charDone = 0
  for (const char of characters) {
    const appearance = char.appearances[0]
    if (!appearance) continue
    charTotal++
    if (appearance.imageUrl) charDone++
  }

  const locations = await prisma.novelPromotionLocation.findMany({
    where: { novelPromotionProjectId: npProjectId },
    include: { images: { orderBy: { imageIndex: 'asc' } } },
  })

  let locTotal = 0
  let locDone = 0
  for (const loc of locations) {
    const img = loc.images[0]
    if (!img) continue
    locTotal++
    if (img.imageUrl) locDone++
  }

  const failedTasks = await prisma.task.count({
    where: {
      projectId,
      type: { in: [TASK_TYPE.IMAGE_CHARACTER, TASK_TYPE.IMAGE_LOCATION] },
      status: TASK_STATUS.FAILED,
    },
  })

  const total = charTotal + locTotal
  const done = charDone + locDone
  return { ready: total === 0 || done === total, charTotal, charDone, locTotal, locDone, failed: failedTasks }
}

async function checkAllPanelImagesReady(episodeId: string): Promise<{
  ready: boolean; total: number; done: number; failed: number
}> {
  const episode = await getEpisodePanels(episodeId)
  if (!episode) return { ready: false, total: 0, done: 0, failed: 0 }

  let total = 0
  let done = 0
  for (const sb of episode.storyboards) {
    for (const panel of sb.panels) {
      total++
      if (panel.imageUrl) done++
    }
  }

  const failedTasks = await prisma.task.count({
    where: {
      episodeId,
      type: TASK_TYPE.IMAGE_PANEL,
      status: TASK_STATUS.FAILED,
    },
  })

  return { ready: total > 0 && done === total, total, done, failed: failedTasks }
}

async function checkAllVideosReady(episodeId: string): Promise<{
  ready: boolean; total: number; done: number; failed: number
}> {
  const episode = await getEpisodePanels(episodeId)
  if (!episode) return { ready: false, total: 0, done: 0, failed: 0 }

  let total = 0
  let done = 0
  for (const sb of episode.storyboards) {
    for (const panel of sb.panels) {
      if (!panel.imageUrl) continue
      total++
      if (panel.videoUrl || panel.lipSyncVideoUrl) done++
    }
  }

  const failedTasks = await prisma.task.count({
    where: {
      episodeId,
      type: TASK_TYPE.VIDEO_PANEL,
      status: TASK_STATUS.FAILED,
    },
  })

  return { ready: total > 0 && done === total, total, done, failed: failedTasks }
}

async function tryExportAllVideos(job: AutomationJob): Promise<string | null> {
  const root = getExportRoot()
  if (!root) return null

  const episode = await getEpisodePanels(job.episodeId)
  if (!episode) return null

  interface VideoEntry {
    description: string
    videoUrl: string
    clipIndex: number
    panelIndex: number
  }
  const videos: VideoEntry[] = []

  const clips = await prisma.novelPromotionClip.findMany({
    where: { episodeId: job.episodeId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })

  for (const sb of episode.storyboards) {
    const clipIdx = clips.findIndex(c => c.id === sb.clipId)
    for (const panel of sb.panels) {
      const url = panel.lipSyncVideoUrl || panel.videoUrl
      if (!url || !String(url).trim()) continue
      videos.push({
        description: panel.description || '镜头',
        videoUrl: String(url).trim(),
        clipIndex: clipIdx >= 0 ? clipIdx : 999,
        panelIndex: panel.panelIndex,
      })
    }
  }

  if (videos.length === 0) return null

  videos.sort((a, b) => a.clipIndex !== b.clipIndex
    ? a.clipIndex - b.clipIndex
    : a.panelIndex - b.panelIndex)

  await fs.mkdir(root, { recursive: true })
  const outPath = path.join(root, `${job.id}_videos.zip`)

  const archive = archiver('zip', { zlib: { level: 6 } })
  const chunks: Uint8Array[] = []
  archive.on('data', (chunk) => chunks.push(chunk))

  const archiveFinished = new Promise<void>((resolve, reject) => {
    archive.on('end', resolve)
    archive.on('error', reject)
  })

  for (let i = 0; i < videos.length; i++) {
    const v = videos[i]
    try {
      let buf: Buffer
      const storageKey = await resolveStorageKeyFromMediaValue(v.videoUrl)
      if (v.videoUrl.startsWith('http://') || v.videoUrl.startsWith('https://')) {
        buf = await fetchVideoToBuffer(v.videoUrl)
      } else if (storageKey) {
        buf = await getObjectBuffer(storageKey)
      } else {
        buf = await fetchVideoToBuffer(v.videoUrl)
      }
      const safeDesc = v.description.slice(0, 50).replace(/[\\/:*?"<>|]/g, '_')
      archive.append(buf, { name: `${String(i + 1).padStart(3, '0')}_${safeDesc}.mp4` })
    } catch {
      // skip failed downloads
    }
  }

  await archive.finalize()
  await archiveFinished

  const totalLen = chunks.reduce((acc, c) => acc + c.length, 0)
  const result = new Uint8Array(totalLen)
  let offset = 0
  for (const c of chunks) {
    result.set(c, offset)
    offset += c.length
  }

  await fs.writeFile(outPath, result)
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

  if (job.status === 'failed' || job.status === 'completed') {
    return job
  }

  // Phase 1: story → script
  if (job.phase === PHASE.STORY_TO_SCRIPT) {
    const task = await findLatestEpisodeTask(job.projectId, job.episodeId, TASK_TYPE.STORY_TO_SCRIPT_RUN)
    if (!task) return job
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

  // Phase 2: script → storyboard
  if (job.phase === PHASE.SCRIPT_TO_STORYBOARD) {
    const task = await findLatestEpisodeTask(job.projectId, job.episodeId, TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN)
    if (!task) return job
    if (task.status === TASK_STATUS.FAILED) {
      await markJobFailed(job.id, task.errorCode || 'TASK_FAILED', task.errorMessage || 'script_to_storyboard failed')
      return (await prisma.automationJob.findUnique({ where: { id: jobId } }))!
    }
    if (task.status === TASK_STATUS.COMPLETED) {
      return prisma.automationJob.update({
        where: { id: job.id },
        data: { phase: PHASE.STORYBOARD_READY, errorMessage: null },
      })
    }
    return job
  }

  // Phase 3: storyboard ready → confirm character profiles
  if (job.phase === PHASE.STORYBOARD_READY) {
    try {
      const { submitted } = await submitProfileConfirmation(job.userId, job.projectId)
      if (submitted) {
        return prisma.automationJob.update({
          where: { id: job.id },
          data: { phase: PHASE.CONFIRMING_PROFILES, errorMessage: '角色档案确认中...' },
        })
      }
      // No profiles to confirm, go directly to assets
      const { characters, locations } = await submitAssetImageTasks(job.userId, job.projectId, job.episodeId)
      const total = characters + locations
      if (total === 0) {
        const { submitted: panelSubmitted } = await submitPanelImageTasks(job.userId, job.projectId, job.episodeId)
        return prisma.automationJob.update({
          where: { id: job.id },
          data: { phase: PHASE.GENERATING_PANEL_IMAGES, errorMessage: `分镜图生成中：已提交 ${panelSubmitted} 个` },
        })
      }
      return prisma.automationJob.update({
        where: { id: job.id },
        data: { phase: PHASE.GENERATING_ASSETS, errorMessage: `资产生成中：${characters} 个角色 + ${locations} 个场景` },
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      await markJobFailed(job.id, 'PROFILE_CONFIRM_FAILED', message)
      return (await prisma.automationJob.findUnique({ where: { id: jobId } }))!
    }
  }

  // Phase 3.5: wait for profiles → submit asset images
  if (job.phase === PHASE.CONFIRMING_PROFILES) {
    const profileStatus = await checkProfilesConfirmed(job.projectId)
    if (!profileStatus.ready) {
      const progress = `角色档案确认中：${profileStatus.confirmed}/${profileStatus.total}`
      if (job.errorMessage !== progress) {
        await prisma.automationJob.update({ where: { id: job.id }, data: { errorMessage: progress } })
      }
      return (await prisma.automationJob.findUnique({ where: { id: jobId } }))!
    }
    try {
      const { characters, locations } = await submitAssetImageTasks(job.userId, job.projectId, job.episodeId)
      const total = characters + locations
      if (total === 0) {
        const { submitted: panelSubmitted } = await submitPanelImageTasks(job.userId, job.projectId, job.episodeId)
        return prisma.automationJob.update({
          where: { id: job.id },
          data: { phase: PHASE.GENERATING_PANEL_IMAGES, errorMessage: `分镜图生成中：已提交 ${panelSubmitted} 个` },
        })
      }
      return prisma.automationJob.update({
        where: { id: job.id },
        data: { phase: PHASE.GENERATING_ASSETS, errorMessage: `资产生成中：${characters} 个角色 + ${locations} 个场景` },
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      await markJobFailed(job.id, 'ASSET_IMAGE_SUBMIT_FAILED', message)
      return (await prisma.automationJob.findUnique({ where: { id: jobId } }))!
    }
  }

  // Phase 4: wait for asset images (characters + locations)
  if (job.phase === PHASE.GENERATING_ASSETS) {
    const status = await checkAllAssetImagesReady(job.projectId)
    if (status.ready) {
      try {
        const { submitted, skipped } = await submitPanelImageTasks(job.userId, job.projectId, job.episodeId)
        const msg = `资产就绪（角色 ${status.charDone}/${status.charTotal}，场景 ${status.locDone}/${status.locTotal}），分镜图：已提交 ${submitted} 个，跳过 ${skipped} 个`
        return prisma.automationJob.update({
          where: { id: job.id },
          data: { phase: PHASE.GENERATING_PANEL_IMAGES, errorMessage: msg },
        })
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        await markJobFailed(job.id, 'PANEL_IMAGE_SUBMIT_FAILED', message)
        return (await prisma.automationJob.findUnique({ where: { id: jobId } }))!
      }
    }
    const progress = `资产进度：角色 ${status.charDone}/${status.charTotal}，场景 ${status.locDone}/${status.locTotal}` +
      (status.failed > 0 ? `，失败 ${status.failed}` : '')
    if (job.errorMessage !== progress) {
      await prisma.automationJob.update({ where: { id: job.id }, data: { errorMessage: progress } })
    }
    return (await prisma.automationJob.findUnique({ where: { id: jobId } }))!
  }

  // Phase 5: wait for all panel images
  if (job.phase === PHASE.GENERATING_PANEL_IMAGES) {
    const status = await checkAllPanelImagesReady(job.episodeId)
    if (status.ready) {
      try {
        const { submitted, skipped } = await submitVideoPanelTasks(job.userId, job.projectId, job.episodeId)
        const msg = `视频生成中：已提交 ${submitted} 个，跳过 ${skipped} 个`
        return prisma.automationJob.update({
          where: { id: job.id },
          data: { phase: PHASE.GENERATING_VIDEOS, errorMessage: msg },
        })
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        await markJobFailed(job.id, 'VIDEO_SUBMIT_FAILED', message)
        return (await prisma.automationJob.findUnique({ where: { id: jobId } }))!
      }
    }
    const progress = `分镜图进度：${status.done}/${status.total}` +
      (status.failed > 0 ? `，失败 ${status.failed}` : '')
    if (job.errorMessage !== progress) {
      await prisma.automationJob.update({
        where: { id: job.id },
        data: { errorMessage: progress },
      })
    }
    return (await prisma.automationJob.findUnique({ where: { id: jobId } }))!
  }

  // Phase 5: wait for all videos
  if (job.phase === PHASE.GENERATING_VIDEOS) {
    const status = await checkAllVideosReady(job.episodeId)
    if (status.ready) {
      return prisma.automationJob.update({
        where: { id: job.id },
        data: { phase: PHASE.VIDEOS_READY, errorMessage: `全部 ${status.total} 个视频已生成` },
      })
    }
    const progress = `视频进度：${status.done}/${status.total}` +
      (status.failed > 0 ? `，失败 ${status.failed}` : '')
    if (job.errorMessage !== progress) {
      await prisma.automationJob.update({
        where: { id: job.id },
        data: { errorMessage: progress },
      })
    }
    return (await prisma.automationJob.findUnique({ where: { id: jobId } }))!
  }

  // Phase 6: export videos
  if (job.phase === PHASE.VIDEOS_READY) {
    try {
      const localPath = await tryExportAllVideos(job)
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
          status: 'completed',
          phase: PHASE.VIDEOS_READY,
          errorMessage: '视频已全部生成，但未配置 WACOO_EXPORT_ROOT，跳过本地导出。',
        },
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      await markJobFailed(job.id, 'EXPORT_FAILED', message)
      return (await prisma.automationJob.findUnique({ where: { id: jobId } }))!
    }
  }

  return job
}
