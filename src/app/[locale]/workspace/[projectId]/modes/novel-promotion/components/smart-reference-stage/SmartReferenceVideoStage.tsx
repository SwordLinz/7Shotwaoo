'use client'

import { useCallback, useMemo } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { useTranslations } from 'next-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { apiFetch } from '@/lib/api-fetch'
import { checkApiResponse } from '@/lib/error-handler'
import { useVideoTaskPresentation } from '@/lib/query/hooks/useTaskPresentation'
import { buildPanelVideoTargets } from '@/lib/novel-promotion/stages/video-stage-runtime/task-targets'
import { useWorkspaceProvider } from '../../WorkspaceProvider'
import { useWorkspaceEpisodeStageData } from '../../hooks/useWorkspaceEpisodeStageData'
import type { NovelPromotionPanel, NovelPromotionStoryboard } from '@/types/project'
import type { Storyboard, Panel } from '../video'
import SmartRefPanelCard from './SmartRefPanelCard'

interface FlatPanel {
  panel: NovelPromotionPanel
  storyboardId: string
  clipId: string
  targetKey: string
}

function toVideoStoryboards(raw: NovelPromotionStoryboard[]): Storyboard[] {
  return raw.map((sb) => ({
    id: sb.id,
    clipId: sb.clipId,
    panels: (sb.panels || []).map((p): Panel => ({
      id: p.id,
      panelIndex: p.panelIndex,
      panelNumber: p.panelNumber,
      description: p.description,
      videoPrompt: p.videoPrompt,
      videoUrl: p.videoUrl,
      videoTaskRunning: p.videoTaskRunning,
      location: p.location,
      characters: p.characters,
      duration: p.duration,
    })),
  }))
}

export default function SmartReferenceVideoStage() {
  const t = useTranslations('novelPromotion')
  const { projectId, episodeId } = useWorkspaceProvider()
  const queryClient = useQueryClient()
  const { storyboards: rawStoryboards } = useWorkspaceEpisodeStageData()

  const storyboards = useMemo(
    () => toVideoStoryboards(rawStoryboards as NovelPromotionStoryboard[]),
    [rawStoryboards],
  )

  const panelVideoTargets = useMemo(
    () => buildPanelVideoTargets(storyboards, true),
    [storyboards],
  )
  const taskPresentation = useVideoTaskPresentation(projectId, panelVideoTargets, {
    enabled: !!projectId && panelVideoTargets.length > 0,
  })

  const flatPanels = useMemo<FlatPanel[]>(() => {
    const result: FlatPanel[] = []
    for (const sb of rawStoryboards as NovelPromotionStoryboard[]) {
      if (!sb.panels) continue
      for (const panel of sb.panels) {
        result.push({
          panel,
          storyboardId: sb.id,
          clipId: sb.clipId,
          targetKey: `panel-video:${panel.id}`,
        })
      }
    }
    return result
  }, [rawStoryboards])

  const completedCount = flatPanels.filter((fp) => !!fp.panel.videoUrl).length
  const pendingCount = flatPanels.filter((fp) => !fp.panel.videoUrl && fp.panel.videoPrompt).length

  const generateSingle = useMutation({
    mutationFn: async (panelId: string) => {
      const res = await apiFetch(`/api/novel-promotion/${projectId}/generate-smart-ref-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ panelId }),
      })
      await checkApiResponse(res)
      return res.json()
    },
    onSettled: () => {
      if (episodeId && projectId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, episodeId) })
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId) })
      }
    },
  })

  const generateAll = useMutation({
    mutationFn: async () => {
      if (!episodeId) throw new Error('No episode')
      const res = await apiFetch(`/api/novel-promotion/${projectId}/generate-smart-ref-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true, episodeId }),
      })
      await checkApiResponse(res)
      return res.json()
    },
    onSettled: () => {
      if (episodeId && projectId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, episodeId) })
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId) })
      }
    },
  })

  const handleGenerate = useCallback((panelId: string) => {
    generateSingle.mutate(panelId)
  }, [generateSingle])

  const handleGenerateAll = useCallback(() => {
    generateAll.mutate()
  }, [generateAll])

  if (flatPanels.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4">
        <div className="glass-surface p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/10 to-cyan-500/10 flex items-center justify-center mx-auto mb-4">
            <AppIcon name="video" className="w-8 h-8 text-[var(--glass-tone-info-fg)]" strokeWidth={1.5} />
          </div>
          <h2 className="text-xl font-bold text-[var(--glass-text-primary)] mb-2">
            {t('smartRefStage.title')}
          </h2>
          <p className="text-sm text-[var(--glass-text-secondary)] max-w-md mx-auto leading-relaxed">
            {t('smartRefStage.noPanels')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-[var(--glass-text-primary)]">
            {t('smartRefStage.title')}
          </h2>
          <p className="text-xs text-[var(--glass-text-tertiary)] mt-1">
            {completedCount > 0
              ? t('smartRefStage.completedCount', { count: completedCount, total: flatPanels.length })
              : t('smartRefStage.pendingCount', { count: pendingCount })}
          </p>
        </div>
        <button
          onClick={handleGenerateAll}
          disabled={generateAll.isPending || pendingCount === 0}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-all
            bg-gradient-to-r from-blue-600 to-cyan-600 text-white
            hover:from-blue-500 hover:to-cyan-500
            disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {generateAll.isPending ? t('smartRefStage.generating') : t('smartRefStage.generateAll')}
        </button>
      </div>

      {/* Panel Grid */}
      <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {flatPanels.map((fp) => {
          const presentationState = taskPresentation.getState(fp.targetKey)
          const isRunning = presentationState?.phase === 'queued' || presentationState?.phase === 'processing'
          return (
            <SmartRefPanelCard
              key={fp.panel.id}
              panel={fp.panel}
              isGenerating={isRunning || !!fp.panel.videoTaskRunning}
              onGenerate={handleGenerate}
              t={t}
            />
          )
        })}
      </div>
    </div>
  )
}
