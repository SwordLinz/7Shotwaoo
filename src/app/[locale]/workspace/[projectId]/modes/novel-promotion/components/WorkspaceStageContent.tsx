'use client'

import type { WorkflowMode } from '@/types/project'
import ConfigStage from './ConfigStage'
import ScriptStage from './ScriptStage'
import StoryboardStage from './StoryboardStage'
import VideoStageRoute from './VideoStageRoute'
import VoiceStageRoute from './VoiceStageRoute'
import SmartReferenceVideoStage from './smart-reference-stage/SmartReferenceVideoStage'
import EditorStageRoute from './EditorStageRoute'

interface WorkspaceStageContentProps {
  currentStage: string
  workflowMode: WorkflowMode
  projectId?: string
  episodeId?: string
}

export default function WorkspaceStageContent({
  currentStage,
  workflowMode,
  projectId,
  episodeId,
}: WorkspaceStageContentProps) {
  const isSmartRef = workflowMode === 'smart-reference'

  return (
    <div key={currentStage} className="animate-page-enter">
      {currentStage === 'config' && <ConfigStage />}

      {(currentStage === 'script' || currentStage === 'assets') && <ScriptStage />}

      {currentStage === 'storyboard' && !isSmartRef && <StoryboardStage />}

      {currentStage === 'videos' && (isSmartRef ? <SmartReferenceVideoStage /> : <VideoStageRoute />)}

      {currentStage === 'voice' && <VoiceStageRoute />}

      {currentStage === 'editor' && projectId && episodeId && (
        <EditorStageRoute projectId={projectId} episodeId={episodeId} />
      )}
    </div>
  )
}
