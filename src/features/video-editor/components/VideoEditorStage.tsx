'use client'
import { logError as _ulogError } from '@/lib/logging/core'
import { useTranslations } from 'next-intl'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { useEditorState } from '../hooks/useEditorState'
import { useEditorActions } from '../hooks/useEditorActions'
import { VideoEditorProject, VideoClip } from '../types/editor.types'
import { calculateTimelineDuration, framesToTime } from '../utils/time-utils'
import { downloadProjectExport, type ExportFormat } from '../exporters'
import { exportVideoBundle } from '../exporters/video-bundle-exporter'
import { exportMergedVideo } from '../exporters/video-merge-exporter'
import { RemotionPreview } from './Preview'
import { Timeline } from './Timeline'
import { TransitionPicker, TransitionType } from './TransitionPicker'

interface VideoEditorStageProps {
    projectId: string
    episodeId: string
    initialProject?: VideoEditorProject
    onBack?: () => void
}

export function VideoEditorStage({
    projectId,
    episodeId,
    initialProject,
    onBack
}: VideoEditorStageProps) {
    const t = useTranslations('video')
    const {
        project,
        timelineState,
        isDirty,
        addBgm,
        removeBgm,
        updateBgm,
        removeClip,
        updateClip,
        reorderClips,
        play,
        pause,
        seek,
        selectClip,
        selectBgm,
        setZoom,
        markSaved
    } = useEditorState({ episodeId, initialProject })

    const { saveProject } = useEditorActions({ projectId, episodeId })

    const totalDuration = calculateTimelineDuration(project.timeline)
    const totalTime = framesToTime(totalDuration, project.config.fps)
    const currentTime = framesToTime(timelineState.currentFrame, project.config.fps)

    const handleSave = useCallback(async () => {
        try {
            await saveProject(project)
            markSaved()
        } catch (error) {
            _ulogError('Save failed:', error)
            alert(t('editor.alert.saveFailed'))
        }
    }, [saveProject, project, markSaved, t])

    // --- export dropdown ---
    const [exportMenuOpen, setExportMenuOpen] = useState(false)
    const [exporting, setExporting] = useState(false)
    const exportMenuRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!exportMenuOpen) return
        const handler = (e: MouseEvent) => {
            if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node))
                setExportMenuOpen(false)
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [exportMenuOpen])

    const handleExportFormat = async (format: ExportFormat) => {
        setExportMenuOpen(false)
        setExporting(true)
        try {
            await downloadProjectExport(project, format)
        } catch (error) {
            _ulogError('Export failed:', error)
            alert(t('editor.alert.exportFailed'))
        } finally {
            setExporting(false)
        }
    }

    const [exportProgress, setExportProgress] = useState<string | null>(null)

    const runExportWithProgress = async (
        label: string,
        fn: (onProgress: (pct: number, msg: string) => void) => Promise<void>,
    ) => {
        setExportMenuOpen(false)
        setExporting(true)
        setExportProgress(label)
        try {
            await saveProject(project)
            markSaved()
            await fn((_, msg) => setExportProgress(msg))
        } catch (error) {
            _ulogError('Export failed:', error)
            alert(t('editor.alert.exportFailed'))
        } finally {
            setExporting(false)
            setExportProgress(null)
        }
    }

    const handleExportAllClips = () =>
        runExportWithProgress(t('editor.export.videoDownloading'), (onP) => exportVideoBundle(project, onP))

    const handleExportMerged = () =>
        runExportWithProgress(t('editor.export.merging'), (onP) => exportMergedVideo(project, onP))

    // --- BGM upload ---
    const bgmInputRef = useRef<HTMLInputElement>(null)
    const handleBgmUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        const url = URL.createObjectURL(file)
        const audio = new Audio(url)
        audio.addEventListener('loadedmetadata', () => {
            const durationFrames = Math.round(audio.duration * project.config.fps)
            addBgm({
                src: url,
                startFrame: 0,
                durationInFrames: durationFrames,
                volume: 0.6,
                fadeIn: 30,
                fadeOut: 30,
            })
        })
        audio.addEventListener('error', () => {
            URL.revokeObjectURL(url)
            alert(t('editor.alert.audioLoadFailed'))
        })
        e.target.value = ''
    }, [addBgm, project.config.fps, t])

    // --- Voice upload for selected clip ---
    const voiceInputRef = useRef<HTMLInputElement>(null)
    const handleVoiceUpload = useCallback((clipId: string) => {
        if (!voiceInputRef.current) return
        voiceInputRef.current.dataset.clipId = clipId
        voiceInputRef.current.click()
    }, [])

    const onVoiceFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        const clipId = e.target.dataset.clipId
        if (!file || !clipId) return
        const url = URL.createObjectURL(file)
        updateClip(clipId, {
            attachment: {
                audio: { src: url, volume: 1 },
            }
        })
        e.target.value = ''
    }, [updateClip])

    const mediaClips = project.timeline
    const selectedClip = project.timeline.find(c => c.id === timelineState.selectedClipId)
    const selectedBgm = project.bgmTrack.find(b => b.id === timelineState.selectedBgmId)

    // --- split panel dragging ---
    const [topRatio, setTopRatio] = useState(0.55)
    const containerRef = useRef<HTMLDivElement>(null)
    const draggingRef = useRef(false)

    const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        draggingRef.current = true
        const onMove = (ev: MouseEvent) => {
            if (!draggingRef.current || !containerRef.current) return
            const rect = containerRef.current.getBoundingClientRect()
            setTopRatio(Math.min(0.75, Math.max(0.3, (ev.clientY - rect.top) / rect.height)))
        }
        const onUp = () => {
            draggingRef.current = false
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
    }, [])

    return (
        <div
            ref={containerRef}
            className="video-editor-stage"
            style={{
                display: 'flex',
                flexDirection: 'column',
                height: 'calc(100vh - 100px)',
                background: 'var(--glass-bg-canvas)',
                color: 'var(--glass-text-primary)',
                borderRadius: 'var(--glass-radius-lg)',
                overflow: 'hidden',
                border: '1px solid var(--glass-stroke-base)',
            }}
        >
            {/* Hidden file inputs */}
            <input ref={bgmInputRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={handleBgmUpload} />
            <input ref={voiceInputRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={onVoiceFileChange} />

            {/* ===== TOP HALF ===== */}
            <div style={{ flex: `0 0 ${topRatio * 100}%`, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

                {/* LEFT: Media Library */}
                <div style={{
                    width: '38%', minWidth: '280px', maxWidth: '480px',
                    display: 'flex', flexDirection: 'column',
                    borderRight: '1px solid var(--glass-stroke-base)',
                    background: 'var(--glass-bg-surface)',
                }}>
                    <div style={{
                        padding: '10px 14px',
                        borderBottom: '1px solid var(--glass-stroke-soft)',
                        display: 'flex', alignItems: 'center', gap: '8px',
                    }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--glass-text-primary)' }}>
                            {t('editor.left.title')}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--glass-text-tertiary)', marginLeft: 'auto' }}>
                            {mediaClips.length} {t('editor.media.clipCount')}
                        </span>
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
                        {mediaClips.length === 0 ? (
                            <div style={{
                                display: 'flex', flexDirection: 'column',
                                alignItems: 'center', justifyContent: 'center',
                                height: '100%', gap: '12px', color: 'var(--glass-text-tertiary)',
                            }}>
                                <AppIcon name="image" className="w-10 h-10" />
                                <span style={{ fontSize: '12px', textAlign: 'center' }}>
                                    {t('editor.left.description')}
                                </span>
                            </div>
                        ) : (
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                                gap: '6px',
                            }}>
                                {mediaClips.map((clip, idx) => (
                                    <MediaThumbnail
                                        key={clip.id}
                                        clip={clip}
                                        index={idx}
                                        fps={project.config.fps}
                                        isSelected={timelineState.selectedClipId === clip.id}
                                        onClick={() => selectClip(clip.id)}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* RIGHT: Preview Player */}
                <div style={{
                    flex: 1, display: 'flex', flexDirection: 'column',
                    background: 'var(--glass-bg-muted)', minWidth: 0,
                }}>
                    <div style={{
                        padding: '8px 14px',
                        borderBottom: '1px solid var(--glass-stroke-soft)',
                        display: 'flex', alignItems: 'center', gap: '8px',
                        fontSize: '12px', color: 'var(--glass-text-secondary)',
                    }}>
                        <span>{t('editor.preview.title')}</span>
                        <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
                            {currentTime} / {totalTime}
                        </span>
                    </div>

                    <div style={{
                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: '12px', overflow: 'hidden', minHeight: 0,
                    }}>
                        <RemotionPreview
                            project={project}
                            currentFrame={timelineState.currentFrame}
                            playing={timelineState.playing}
                            onFrameChange={seek}
                            onPlayingChange={(p) => p ? play() : pause()}
                        />
                    </div>

                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        gap: '12px', padding: '8px 12px',
                        background: 'var(--glass-bg-surface)',
                        borderTop: '1px solid var(--glass-stroke-soft)',
                    }}>
                        <button onClick={() => seek(0)} className="glass-btn-base glass-btn-ghost px-2 py-1">
                            <AppIcon name="chevronLeft" className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => timelineState.playing ? pause() : play()}
                            style={{
                                width: '36px', height: '36px', borderRadius: '50%',
                                background: 'linear-gradient(135deg, var(--glass-accent-from), var(--glass-accent-to))',
                                border: 'none', color: 'var(--glass-text-on-accent)',
                                cursor: 'pointer', display: 'flex',
                                alignItems: 'center', justifyContent: 'center',
                            }}
                        >
                            {timelineState.playing
                                ? <AppIcon name="pause" className="w-4 h-4" />
                                : <AppIcon name="play" className="w-4 h-4" />}
                        </button>
                        <button onClick={() => seek(totalDuration)} className="glass-btn-base glass-btn-ghost px-2 py-1">
                            <AppIcon name="chevronRight" className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* FAR RIGHT: Properties */}
                {selectedClip && (
                    <div style={{
                        width: '240px',
                        borderLeft: '1px solid var(--glass-stroke-base)',
                        background: 'var(--glass-bg-surface)',
                        padding: '12px', overflowY: 'auto',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
                            <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--glass-text-secondary)' }}>
                                {t('editor.right.title')}
                            </h3>
                            <button
                                onClick={() => selectClip(null)}
                                className="glass-btn-base glass-btn-ghost px-1 py-0.5"
                                style={{ marginLeft: 'auto', fontSize: '14px' }}
                            >×</button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            <div style={{ fontSize: '12px', color: 'var(--glass-text-secondary)' }}>
                                <p style={{ margin: '0 0 6px' }}>
                                    <span style={{ color: 'var(--glass-text-tertiary)' }}>{t('editor.right.clipLabel')}</span>{' '}
                                    {selectedClip.metadata?.description ||
                                        t('editor.right.clipFallback', { index: project.timeline.findIndex(c => c.id === selectedClip.id) + 1 })}
                                </p>
                                <p style={{ margin: 0 }}>
                                    <span style={{ color: 'var(--glass-text-tertiary)' }}>{t('editor.right.durationLabel')}</span>{' '}
                                    {framesToTime(selectedClip.durationInFrames, project.config.fps)}
                                </p>
                            </div>

                            {/* Voice upload for this clip */}
                            <div>
                                <h4 style={{ margin: '0 0 6px', fontSize: '12px', color: 'var(--glass-text-tertiary)' }}>
                                    {t('editor.right.voiceLabel')}
                                </h4>
                                {selectedClip.attachment?.audio ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span style={{ fontSize: '11px', color: 'var(--glass-tone-success-fg)' }}>
                                            {t('editor.right.voiceAttached')}
                                        </span>
                                        <button
                                            onClick={() => updateClip(selectedClip.id, { attachment: undefined })}
                                            className="glass-btn-base glass-btn-ghost px-1 py-0.5"
                                            style={{ fontSize: '11px', color: 'var(--glass-tone-danger-fg)' }}
                                        >×</button>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => handleVoiceUpload(selectedClip.id)}
                                        className="glass-btn-base glass-btn-secondary px-3 py-1.5"
                                        style={{ fontSize: '11px', width: '100%' }}
                                    >
                                        {t('editor.right.uploadVoice')}
                                    </button>
                                )}
                            </div>

                            <div>
                                <h4 style={{ margin: '0 0 6px', fontSize: '12px', color: 'var(--glass-text-tertiary)' }}>
                                    {t('editor.right.transitionLabel')}
                                </h4>
                                <TransitionPicker
                                    value={(selectedClip.transition?.type as TransitionType) || 'none'}
                                    duration={selectedClip.transition?.durationInFrames || 15}
                                    onChange={(type, dur) => {
                                        updateClip(selectedClip.id, {
                                            transition: type === 'none' ? undefined : { type, durationInFrames: dur }
                                        })
                                    }}
                                />
                            </div>

                            <button
                                onClick={() => {
                                    if (confirm(t('editor.right.deleteConfirm'))) {
                                        removeClip(selectedClip.id)
                                        selectClip(null)
                                    }
                                }}
                                className="glass-btn-base glass-btn-tone-danger px-3 py-1.5"
                                style={{ fontSize: '12px' }}
                            >
                                {t('editor.right.deleteClip')}
                            </button>
                        </div>
                    </div>
                )}

                {/* FAR RIGHT: BGM Properties */}
                {selectedBgm && !selectedClip && (
                    <div style={{
                        width: '240px',
                        borderLeft: '1px solid var(--glass-stroke-base)',
                        background: 'var(--glass-bg-surface)',
                        padding: '12px', overflowY: 'auto',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
                            <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--glass-text-secondary)' }}>
                                {t('editor.bgm.title')}
                            </h3>
                            <button
                                onClick={() => selectBgm(null)}
                                className="glass-btn-base glass-btn-ghost px-1 py-0.5"
                                style={{ marginLeft: 'auto', fontSize: '14px' }}
                            >×</button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            {/* Duration */}
                            <div style={{ fontSize: '12px', color: 'var(--glass-text-secondary)' }}>
                                <span style={{ color: 'var(--glass-text-tertiary)' }}>{t('editor.right.durationLabel')}</span>{' '}
                                {framesToTime(selectedBgm.durationInFrames, project.config.fps)}
                            </div>

                            {/* Volume */}
                            <div>
                                <h4 style={{ margin: '0 0 6px', fontSize: '12px', color: 'var(--glass-text-tertiary)' }}>
                                    {t('editor.bgm.volume')}
                                </h4>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <input
                                        type="range" min="0" max="1" step="0.05"
                                        value={selectedBgm.volume}
                                        onChange={(e) => updateBgm(selectedBgm.id, { volume: parseFloat(e.target.value) })}
                                        style={{ flex: 1, accentColor: 'var(--glass-accent-from)' }}
                                    />
                                    <span style={{ fontSize: '11px', color: 'var(--glass-text-tertiary)', minWidth: '30px' }}>
                                        {Math.round(selectedBgm.volume * 100)}%
                                    </span>
                                </div>
                            </div>

                            {/* Speed */}
                            <div>
                                <h4 style={{ margin: '0 0 6px', fontSize: '12px', color: 'var(--glass-text-tertiary)' }}>
                                    {t('editor.bgm.speed')}
                                </h4>
                                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                    {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((spd) => (
                                        <button
                                            key={spd}
                                            onClick={() => updateBgm(selectedBgm.id, { speed: spd })}
                                            className={`glass-btn-base px-2 py-1 ${(selectedBgm.speed ?? 1) === spd ? 'glass-btn-primary' : 'glass-btn-ghost'}`}
                                            style={{ fontSize: '11px' }}
                                        >
                                            {spd}x
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Fade In/Out */}
                            <div>
                                <h4 style={{ margin: '0 0 6px', fontSize: '12px', color: 'var(--glass-text-tertiary)' }}>
                                    {t('editor.bgm.fadeIn')}
                                </h4>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <input
                                        type="range" min="0" max="90" step="5"
                                        value={selectedBgm.fadeIn ?? 0}
                                        onChange={(e) => updateBgm(selectedBgm.id, { fadeIn: parseInt(e.target.value) })}
                                        style={{ flex: 1, accentColor: 'var(--glass-accent-from)' }}
                                    />
                                    <span style={{ fontSize: '11px', color: 'var(--glass-text-tertiary)', minWidth: '30px' }}>
                                        {framesToTime(selectedBgm.fadeIn ?? 0, project.config.fps)}
                                    </span>
                                </div>
                            </div>
                            <div>
                                <h4 style={{ margin: '0 0 6px', fontSize: '12px', color: 'var(--glass-text-tertiary)' }}>
                                    {t('editor.bgm.fadeOut')}
                                </h4>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <input
                                        type="range" min="0" max="90" step="5"
                                        value={selectedBgm.fadeOut ?? 0}
                                        onChange={(e) => updateBgm(selectedBgm.id, { fadeOut: parseInt(e.target.value) })}
                                        style={{ flex: 1, accentColor: 'var(--glass-accent-from)' }}
                                    />
                                    <span style={{ fontSize: '11px', color: 'var(--glass-text-tertiary)', minWidth: '30px' }}>
                                        {framesToTime(selectedBgm.fadeOut ?? 0, project.config.fps)}
                                    </span>
                                </div>
                            </div>

                            {/* Delete */}
                            <button
                                onClick={() => {
                                    removeBgm(selectedBgm.id)
                                    selectBgm(null)
                                }}
                                className="glass-btn-base glass-btn-tone-danger px-3 py-1.5"
                                style={{ fontSize: '12px' }}
                            >
                                {t('editor.bgm.delete')}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* DRAG DIVIDER */}
            <div
                onMouseDown={onDividerMouseDown}
                style={{
                    height: '5px', cursor: 'row-resize', flexShrink: 0,
                    background: 'var(--glass-stroke-base)', position: 'relative',
                }}
            >
                <div style={{
                    position: 'absolute', left: '50%', top: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: '40px', height: '3px', borderRadius: '2px',
                    background: 'var(--glass-text-tertiary)', opacity: 0.5,
                }} />
            </div>

            {/* TOOLBAR STRIP */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '6px 12px', flexShrink: 0,
                background: 'var(--glass-bg-surface)',
                borderBottom: '1px solid var(--glass-stroke-soft)',
            }}>
                {onBack && (
                    <button onClick={onBack} className="glass-btn-base glass-btn-ghost px-3 py-1" style={{ fontSize: '12px' }}>
                        {t('editor.toolbar.back')}
                    </button>
                )}

                <button
                    onClick={handleSave}
                    className={`glass-btn-base px-3 py-1 ${isDirty ? 'glass-btn-primary' : 'glass-btn-ghost'}`}
                    style={{ fontSize: '12px' }}
                >
                    {isDirty ? t('editor.toolbar.saveDirty') : t('editor.toolbar.saved')}
                </button>

                {/* Export */}
                <div ref={exportMenuRef} style={{ position: 'relative' }}>
                    <button
                        onClick={() => setExportMenuOpen(p => !p)}
                        disabled={exporting || project.timeline.length === 0}
                        className="glass-btn-base glass-btn-secondary px-3 py-1 disabled:opacity-40"
                        style={{ fontSize: '12px' }}
                    >
                        {exportProgress || (exporting ? t('editor.toolbar.exporting') : t('editor.toolbar.exportProject'))}
                        {!exporting && <span style={{ marginLeft: '4px', fontSize: '9px' }}>▼</span>}
                    </button>
                    {exportMenuOpen && (
                        <div style={{
                            position: 'absolute', bottom: '100%', left: 0,
                            marginBottom: '4px', minWidth: '260px',
                            background: 'var(--glass-bg-surface-modal)',
                            border: '1px solid var(--glass-stroke-base)',
                            borderRadius: 'var(--glass-radius-md)',
                            boxShadow: 'var(--glass-shadow-modal)',
                            zIndex: 200, overflow: 'hidden',
                        }}>
                            {/* Video export group */}
                            <div style={{
                                padding: '8px 14px 4px',
                                fontSize: '11px', fontWeight: 600,
                                color: 'var(--glass-text-tertiary)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px',
                            }}>
                                {t('editor.export.videoGroup')}
                            </div>
                            <ExportMenuItem
                                label={t('editor.export.mergedVideo')}
                                hint={t('editor.export.mergedVideoHint')}
                                onClick={handleExportMerged}
                            />
                            <ExportMenuItem
                                label={t('editor.export.allClips')}
                                hint={t('editor.export.allClipsHint')}
                                onClick={handleExportAllClips}
                            />
                            {/* NLE project group */}
                            <div style={{
                                padding: '8px 14px 4px',
                                fontSize: '11px', fontWeight: 600,
                                color: 'var(--glass-text-tertiary)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px',
                                borderTop: '1px solid var(--glass-stroke-soft)',
                            }}>
                                {t('editor.export.projectGroup')}
                            </div>
                            <ExportMenuItem
                                label={t('editor.export.fcpxml')}
                                hint={t('editor.export.fcpxmlHint')}
                                onClick={() => handleExportFormat('fcpxml')}
                            />
                            <ExportMenuItem
                                label={t('editor.export.jianying')}
                                hint={t('editor.export.jianyingHint')}
                                onClick={() => handleExportFormat('jianying')}
                                last
                            />
                        </div>
                    )}
                </div>

                <span style={{ width: '1px', height: '16px', background: 'var(--glass-stroke-soft)', margin: '0 4px' }} />

                {/* BGM upload */}
                <button
                    onClick={() => bgmInputRef.current?.click()}
                    className="glass-btn-base glass-btn-ghost px-3 py-1"
                    style={{ fontSize: '12px' }}
                >
                    {t('editor.toolbar.uploadBgm')}
                </button>

                {project.bgmTrack.length > 0 && (
                    <button
                        onClick={() => {
                            const bgm = project.bgmTrack[0]
                            if (bgm) removeBgm(bgm.id)
                        }}
                        className="glass-btn-base glass-btn-ghost px-2 py-1"
                        style={{ fontSize: '11px', color: 'var(--glass-tone-danger-fg)' }}
                    >
                        {t('editor.toolbar.removeBgm')}
                    </button>
                )}

                <div style={{ flex: 1 }} />

                {/* Zoom */}
                <span style={{ fontSize: '11px', color: 'var(--glass-text-tertiary)' }}>{t('editor.timeline.zoomLabel')}</span>
                <input
                    type="range" min="0.3" max="4" step="0.1"
                    value={timelineState.zoom}
                    onChange={(e) => setZoom(parseFloat(e.target.value))}
                    style={{ width: '80px', accentColor: 'var(--glass-accent-from)' }}
                />
                <span style={{ fontSize: '11px', color: 'var(--glass-text-tertiary)', minWidth: '32px' }}>
                    {Math.round(timelineState.zoom * 100)}%
                </span>
            </div>

            {/* BOTTOM: Timeline */}
            <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
                <Timeline
                    clips={project.timeline}
                    bgmTrack={project.bgmTrack}
                    onUpdateBgm={updateBgm}
                    onSelectBgm={selectBgm}
                    timelineState={timelineState}
                    config={project.config}
                    onReorder={reorderClips}
                    onSelectClip={selectClip}
                    onZoomChange={setZoom}
                    onSeek={seek}
                />
            </div>
        </div>
    )
}

/* ---------- Sub-components ---------- */

function MediaThumbnail({
    clip, index, fps, isSelected, onClick,
}: {
    clip: VideoClip; index: number; fps: number; isSelected: boolean; onClick: () => void
}) {
    const duration = framesToTime(clip.durationInFrames, fps)
    return (
        <div
            onClick={onClick}
            style={{
                position: 'relative', borderRadius: 'var(--glass-radius-sm)',
                overflow: 'hidden', cursor: 'pointer', aspectRatio: '16/9',
                background: 'var(--glass-bg-muted)',
                border: isSelected ? '2px solid var(--glass-accent-from)' : '1px solid var(--glass-stroke-soft)',
            }}
        >
            <video
                src={clip.src} muted preload="metadata"
                style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
            />
            <div style={{
                position: 'absolute', inset: 0,
                background: 'linear-gradient(transparent 50%, rgba(0,0,0,0.7))',
                display: 'flex', alignItems: 'flex-end', padding: '4px 6px',
            }}>
                <span style={{ fontSize: '10px', color: '#fff', fontWeight: 600 }}>{index + 1}</span>
                <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.7)', marginLeft: 'auto' }}>{duration}</span>
            </div>
            {isSelected && (
                <div style={{
                    position: 'absolute', top: '4px', right: '4px',
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: 'var(--glass-accent-from)',
                }} />
            )}
        </div>
    )
}

function ExportMenuItem({ label, hint, onClick, last }: {
    label: string; hint: string; onClick: () => void; last?: boolean
}) {
    return (
        <button
            onClick={onClick}
            className="glass-ghost-hover-bg"
            style={{
                display: 'block', width: '100%', padding: '10px 14px', textAlign: 'left',
                background: 'transparent', border: 'none',
                borderBottom: last ? 'none' : '1px solid var(--glass-stroke-soft)',
                color: 'var(--glass-text-primary)', cursor: 'pointer', fontSize: '13px',
            }}
        >
            <strong>{label}</strong><br />
            <span style={{ fontSize: '11px', color: 'var(--glass-text-tertiary)' }}>{hint}</span>
        </button>
    )
}

export default VideoEditorStage
