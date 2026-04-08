'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { VideoEditorStage } from '@/features/video-editor'
import { useEditorActions, createProjectFromPanels } from '@/features/video-editor'
import type { VideoEditorProject } from '@/features/video-editor'
import { useWorkspaceEpisodeStageData } from '../hooks/useWorkspaceEpisodeStageData'

interface EditorStageRouteProps {
  projectId: string
  episodeId: string
  onBack?: () => void
}

export default function EditorStageRoute({ projectId, episodeId, onBack }: EditorStageRouteProps) {
  const t = useTranslations('video')
  const { storyboards } = useWorkspaceEpisodeStageData()
  const { loadProject, saveProject } = useEditorActions({ projectId, episodeId })
  const [initialProject, setInitialProject] = useState<VideoEditorProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const initEditor = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const saved = await loadProject()
      if (saved) {
        setInitialProject(saved)
        return
      }

      const panels = storyboards.flatMap((sb) =>
        (sb.panels ?? []).map((panel, idx) => ({
          id: panel.id ?? `${sb.id}-${idx}`,
          panelIndex: idx,
          storyboardId: sb.id,
          videoUrl: panel.videoUrl || panel.lipSyncVideoUrl || undefined,
          description: panel.description ?? undefined,
          duration: panel.duration ?? undefined,
        })),
      )

      if (panels.some((p) => p.videoUrl)) {
        const project = createProjectFromPanels(episodeId, panels)
        try {
          await saveProject(project)
        } catch {
          // non-critical
        }
        setInitialProject(project)
      } else {
        const project = createProjectFromPanels(episodeId, [])
        setInitialProject(project)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [loadProject, saveProject, storyboards, episodeId])

  useEffect(() => {
    void initEditor()
  // only run on mount / episodeId change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-[var(--glass-text-secondary)]">{t('editor.preview.emptyStartEditing')}</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-[var(--glass-tone-danger-fg)]">{error}</div>
      </div>
    )
  }

  if (!initialProject) return null

  return (
    <VideoEditorStage
      projectId={projectId}
      episodeId={episodeId}
      initialProject={initialProject}
      onBack={onBack}
    />
  )
}
