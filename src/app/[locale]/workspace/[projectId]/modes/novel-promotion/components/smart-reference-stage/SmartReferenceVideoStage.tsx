'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { useTranslations } from 'next-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useUpdateProjectPanel } from '@/lib/query/hooks'
import { useProjectAssets } from '@/lib/query/hooks/useProjectAssets'
import { apiFetch } from '@/lib/api-fetch'
import { checkApiResponse } from '@/lib/error-handler'
import { useVideoTaskPresentation } from '@/lib/query/hooks/useTaskPresentation'
import { buildPanelVideoTargets } from '@/lib/novel-promotion/stages/video-stage-runtime/task-targets'
import {
  buildSelectedAssetsForSmartRefPanel,
  panelUpdateFromSelectedAssets,
} from '@/lib/novel-promotion/smart-reference/smart-ref-panel-assets'
import ImagePreviewModal from '@/components/ui/ImagePreviewModal'
import { useWorkspaceProvider } from '../../WorkspaceProvider'
import { useWorkspaceEpisodeStageData } from '../../hooks/useWorkspaceEpisodeStageData'
import type { NovelPromotionPanel, NovelPromotionStoryboard, ReferenceAsset } from '@/types/project'
import type { Storyboard, Panel } from '../video'
import ImageEditModalAssetPicker from '../storyboard/ImageEditModalAssetPicker'
import type { SelectedAsset } from '../storyboard/hooks/useImageGeneration'
import SmartRefPanelCard, { type SmartRefPanelSavePayload } from './SmartRefPanelCard'

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

type AssetPickerState = {
  storyboardId: string
  panel: NovelPromotionPanel
  selectedAssets: SelectedAsset[]
}

export default function SmartReferenceVideoStage() {
  const t = useTranslations('novelPromotion')
  const { projectId, episodeId } = useWorkspaceProvider()
  const queryClient = useQueryClient()
  const updatePanelMutation = useUpdateProjectPanel(projectId)
  const { data: projectAssets } = useProjectAssets(projectId)
  const { storyboards: rawStoryboards } = useWorkspaceEpisodeStageData()
  const [assetPicker, setAssetPicker] = useState<AssetPickerState | null>(null)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [referenceAssets, setReferenceAssets] = useState<ReferenceAsset[]>([])

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    fetch(`/api/novel-promotion/${projectId}/reference-assets`)
      .then((r) => (r.ok ? r.json() : { referenceAssets: [] }))
      .then((data) => {
        if (!cancelled) setReferenceAssets(data.referenceAssets || [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [projectId])

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

  const handleSavePanel = useCallback(
    async (storyboardId: string, panel: NovelPromotionPanel, payload: SmartRefPanelSavePayload) => {
      await updatePanelMutation.mutateAsync({
        storyboardId,
        panelIndex: panel.panelIndex,
        panelNumber: panel.panelNumber ?? panel.panelIndex + 1,
        shotType: payload.shotType,
        cameraMove: payload.cameraMove,
        description: payload.description,
        location: payload.location,
        characters: payload.characters,
        duration: payload.duration,
        videoPrompt: payload.videoPrompt,
      })
      if (episodeId) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, episodeId) })
      }
    },
    [episodeId, projectId, queryClient, updatePanelMutation],
  )

  const openAssetPicker = useCallback(
    (fp: FlatPanel) => {
      const characters = projectAssets?.characters ?? []
      const locations = projectAssets?.locations ?? []
      const selected = buildSelectedAssetsForSmartRefPanel(fp.panel, characters, locations) as SelectedAsset[]
      setAssetPicker({
        storyboardId: fp.storyboardId,
        panel: fp.panel,
        selectedAssets: selected,
      })
    },
    [projectAssets],
  )

  const handlePickerAddAsset = useCallback((asset: SelectedAsset) => {
    setAssetPicker((p) => {
      if (!p) return p
      const prev = p.selectedAssets
      if (prev.some((item) => item.id === asset.id && item.type === asset.type)) return p
      if (asset.type === 'location') {
        return {
          ...p,
          selectedAssets: [...prev.filter((a) => a.type !== 'location'), asset],
        }
      }
      return { ...p, selectedAssets: [...prev, asset] }
    })
  }, [])

  const handlePickerRemoveAsset = useCallback((assetId: string, assetType: string) => {
    setAssetPicker((pickerState) =>
      pickerState
        ? {
            ...pickerState,
            selectedAssets: pickerState.selectedAssets.filter(
              (item) => !(item.id === assetId && item.type === assetType),
            ),
          }
        : pickerState,
    )
  }, [])

  const handlePickerConfirm = useCallback(async () => {
    if (!assetPicker || !projectAssets) return
    const { location, characters } = panelUpdateFromSelectedAssets(
      assetPicker.selectedAssets,
      projectAssets.characters,
      projectAssets.locations,
    )
    await updatePanelMutation.mutateAsync({
      storyboardId: assetPicker.storyboardId,
      panelIndex: assetPicker.panel.panelIndex,
      panelNumber: assetPicker.panel.panelNumber ?? assetPicker.panel.panelIndex + 1,
      location,
      characters,
    })
    setAssetPicker(null)
    if (episodeId) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, episodeId) })
    }
  }, [assetPicker, projectAssets, updatePanelMutation, episodeId, queryClient, projectId])

  const handlePickerCancel = useCallback(() => setAssetPicker(null), [])

  if (flatPanels.length === 0) {
    return (
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-10 py-8">
        <div className="glass-surface p-8 md:p-10 text-center relative overflow-hidden">
          <div className="absolute inset-0 rounded-[inherit] bg-gradient-to-br from-blue-500/5 via-cyan-500/5 to-blue-600/5 pointer-events-none" />
          <div className="relative z-10">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center mx-auto mb-5 shadow-lg shadow-blue-500/20">
              <AppIcon name="video" className="w-7 h-7 text-white" strokeWidth={1.5} />
            </div>
            <h2 className="text-2xl font-bold text-[var(--glass-text-primary)] mb-2">
              {t('smartRefStage.title')}
            </h2>
            <p className="text-sm text-[var(--glass-text-secondary)] max-w-md mx-auto leading-relaxed">
              {t('smartRefStage.noPanels')}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-10 py-8 pb-10">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-[var(--glass-text-primary)] mb-1">
            {t('smartRefStage.title')}
          </h2>
          <p className="text-sm text-[var(--glass-text-secondary)]">
            {completedCount > 0
              ? t('smartRefStage.completedCount', { count: completedCount, total: flatPanels.length })
              : t('smartRefStage.pendingCount', { count: pendingCount })}
          </p>
        </div>
        <button
          type="button"
          onClick={handleGenerateAll}
          disabled={generateAll.isPending || pendingCount === 0}
          className="glass-btn-base glass-btn-primary px-5 py-2.5 text-sm shrink-0"
        >
          {generateAll.isPending ? t('smartRefStage.generating') : t('smartRefStage.generateAll')}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {flatPanels.map((fp) => {
          const presentationState = taskPresentation.getState(fp.targetKey)
          const isRunning = presentationState?.phase === 'queued' || presentationState?.phase === 'processing'
          return (
            <SmartRefPanelCard
              key={fp.panel.id}
              panel={fp.panel}
              storyboardId={fp.storyboardId}
              isGenerating={isRunning || !!fp.panel.videoTaskRunning}
              onGenerate={handleGenerate}
              onSave={(payload) => handleSavePanel(fp.storyboardId, fp.panel, payload)}
              onOpenAssetPicker={() => openAssetPicker(fp)}
              t={t}
            />
          )
        })}
      </div>

      {assetPicker ? (
        <ImageEditModalAssetPicker
          isOpen
          characters={projectAssets?.characters ?? []}
          locations={projectAssets?.locations ?? []}
          referenceAssets={referenceAssets}
          selectedAssets={assetPicker.selectedAssets}
          onClose={() => void handlePickerConfirm()}
          onCancel={handlePickerCancel}
          onAddAsset={handlePickerAddAsset}
          onRemoveAsset={handlePickerRemoveAsset}
          onPreviewImage={setPreviewImage}
        />
      ) : null}

      {previewImage ? (
        <ImagePreviewModal imageUrl={previewImage} onClose={() => setPreviewImage(null)} />
      ) : null}
    </div>
  )
}
