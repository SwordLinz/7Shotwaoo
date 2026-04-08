// ========================================
// Video Editor Module - Public API
// ========================================

// Types
export type {
    VideoEditorProject,
    VideoClip,
    BgmClip,
    ClipAttachment,
    ClipTransition,
    ClipMetadata,
    EditorConfig,
    TimelineState,
    ComputedClip,
    SaveEditorProjectRequest,
    RenderRequest,
    RenderStatus
} from './types/editor.types'

// Utils
export {
    calculateTimelineDuration,
    computeClipPositions,
    framesToTime,
    timeToFrames,
    generateClipId,
    createDefaultProject
} from './utils/time-utils'

export {
    migrateProjectData,
    validateProjectData
} from './utils/migration'

// Components
export { VideoEditorStage } from './components/VideoEditorStage'
export { TransitionPicker } from './components/TransitionPicker'

// Hooks
export { useEditorState } from './hooks/useEditorState'
export { useEditorActions, createProjectFromPanels } from './hooks/useEditorActions'

// Exporters
export { exportToFcpXml } from './exporters/fcpxml-exporter'
export { exportToJianyingDraft, exportJianyingMeta } from './exporters/jianying-exporter'
export { downloadProjectExport } from './exporters'
export type { ExportFormat } from './exporters'
