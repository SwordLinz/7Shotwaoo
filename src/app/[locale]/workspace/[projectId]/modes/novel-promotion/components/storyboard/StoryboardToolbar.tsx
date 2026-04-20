'use client'

import { useTranslations } from 'next-intl'
import type { TaskPresentationState } from '@/lib/task/presentation'
import StoryboardHeader, { type StoryboardViewMode } from './StoryboardHeader'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { AppIcon } from '@/components/ui/icons'
import { GlassButton } from '@/components/ui/primitives'

interface StoryboardToolbarProps {
  totalSegments: number
  totalPanels: number
  isDownloadingImages: boolean
  runningCount: number
  pendingPanelCount: number
  isBatchSubmitting: boolean
  addingStoryboardGroup: boolean
  addingStoryboardGroupState: TaskPresentationState | null
  onDownloadAllImages: () => Promise<void>
  onGenerateAllPanels: () => Promise<void>
  onAddStoryboardGroupAtStart: () => void
  onBack: () => void
  viewMode: StoryboardViewMode
  onViewModeChange: (mode: StoryboardViewMode) => void
}

export default function StoryboardToolbar({
  totalSegments,
  totalPanels,
  isDownloadingImages,
  runningCount,
  pendingPanelCount,
  isBatchSubmitting,
  addingStoryboardGroup,
  addingStoryboardGroupState,
  onDownloadAllImages,
  onGenerateAllPanels,
  onAddStoryboardGroupAtStart,
  onBack,
  viewMode,
  onViewModeChange,
}: StoryboardToolbarProps) {
  const t = useTranslations('storyboard')
  return (
    <>
      <StoryboardHeader
        totalSegments={totalSegments}
        totalPanels={totalPanels}
        isDownloadingImages={isDownloadingImages}
        runningCount={runningCount}
        pendingPanelCount={pendingPanelCount}
        isBatchSubmitting={isBatchSubmitting}
        onDownloadAllImages={onDownloadAllImages}
        onGenerateAllPanels={onGenerateAllPanels}
        onBack={onBack}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
      />

      {viewMode === 'panel' && (
        <div className="flex justify-center">
          <GlassButton
            variant="ghost"
            size="sm"
            onClick={onAddStoryboardGroupAtStart}
            disabled={addingStoryboardGroup}
            className="opacity-60 hover:opacity-100"
          >
            {addingStoryboardGroup ? (
              <TaskStatusInline state={addingStoryboardGroupState} />
            ) : (
              <>
                <AppIcon name="plusAlt" className="w-4 h-4" />
                <span>{t('group.addAtStart')}</span>
              </>
            )}
          </GlassButton>
        </div>
      )}
    </>
  )
}
