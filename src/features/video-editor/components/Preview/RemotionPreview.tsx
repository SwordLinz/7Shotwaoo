'use client'

import React, { useMemo, useRef, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Player, PlayerRef } from '@remotion/player'
import { AppIcon } from '@/components/ui/icons'
import { VideoComposition } from '../../remotion/VideoComposition'
import { VideoEditorProject } from '../../types/editor.types'
import { calculateTimelineDuration } from '../../utils/time-utils'

interface RemotionPreviewProps {
    project: VideoEditorProject
    currentFrame: number
    playing: boolean
    onFrameChange?: (frame: number) => void
    onPlayingChange?: (playing: boolean) => void
}

export const RemotionPreview: React.FC<RemotionPreviewProps> = ({
    project,
    currentFrame,
    playing,
    onFrameChange,
    onPlayingChange
}) => {
    const t = useTranslations('video')
    const playerRef = useRef<PlayerRef>(null)
    const lastSyncedFrame = useRef<number>(0)

    const totalDuration = useMemo(
        () => calculateTimelineDuration(project.timeline),
        [project.timeline]
    )

    // Auto-detect actual video dimensions from the first clip
    const [detectedSize, setDetectedSize] = useState<{ w: number; h: number } | null>(null)

    useEffect(() => {
        const firstSrc = project.timeline[0]?.src
        if (!firstSrc) { setDetectedSize(null); return }

        const video = document.createElement('video')
        video.crossOrigin = 'anonymous'
        video.muted = true
        video.preload = 'metadata'

        const timeout = setTimeout(() => { video.remove() }, 8000)

        video.onloadedmetadata = () => {
            clearTimeout(timeout)
            if (video.videoWidth > 0 && video.videoHeight > 0) {
                setDetectedSize({ w: video.videoWidth, h: video.videoHeight })
            }
            video.remove()
        }
        video.onerror = () => { clearTimeout(timeout); video.remove() }
        video.src = firstSrc
    }, [project.timeline[0]?.src])

    const compWidth = detectedSize?.w || project.config.width
    const compHeight = detectedSize?.h || project.config.height

    useEffect(() => {
        const player = playerRef.current
        if (!player) return
        if (Math.abs(currentFrame - lastSyncedFrame.current) > 1) {
            player.seekTo(currentFrame)
            lastSyncedFrame.current = currentFrame
        }
    }, [currentFrame])

    useEffect(() => {
        const player = playerRef.current
        if (!player) return
        if (playing) player.play()
        else player.pause()
    }, [playing])

    useEffect(() => {
        const player = playerRef.current
        if (!player) return
        const handleFrameUpdate = () => {
            const frame = player.getCurrentFrame()
            lastSyncedFrame.current = frame
            onFrameChange?.(frame)
        }
        player.addEventListener('frameupdate', handleFrameUpdate)
        return () => player.removeEventListener('frameupdate', handleFrameUpdate)
    }, [onFrameChange])

    useEffect(() => {
        const player = playerRef.current
        if (!player) return
        const handlePlay = () => onPlayingChange?.(true)
        const handlePause = () => onPlayingChange?.(false)
        const handleEnded = () => onPlayingChange?.(false)
        player.addEventListener('play', handlePlay)
        player.addEventListener('pause', handlePause)
        player.addEventListener('ended', handleEnded)
        return () => {
            player.removeEventListener('play', handlePlay)
            player.removeEventListener('pause', handlePause)
            player.removeEventListener('ended', handleEnded)
        }
    }, [onPlayingChange])

    if (project.timeline.length === 0) {
        return (
            <div style={{
                width: '100%',
                aspectRatio: `${compWidth} / ${compHeight}`,
                maxHeight: '100%',
                background: 'var(--glass-bg-surface)',
                border: '1px solid var(--glass-stroke-base)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: '8px', color: 'var(--glass-text-tertiary)'
            }}>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'center' }}>
                        <AppIcon name="image" className="w-12 h-12" />
                    </div>
                    <span>{t('editor.preview.emptyStartEditing')}</span>
                </div>
            </div>
        )
    }

    return (
        <div style={{
            width: '100%',
            aspectRatio: `${compWidth} / ${compHeight}`,
            maxHeight: '100%',
            background: 'var(--glass-overlay-strong)',
            borderRadius: '8px',
            overflow: 'hidden'
        }}>
            <Player
                ref={playerRef}
                component={VideoComposition}
                inputProps={{
                    clips: project.timeline,
                    bgmTrack: project.bgmTrack,
                    config: { ...project.config, width: compWidth, height: compHeight }
                }}
                durationInFrames={Math.max(1, totalDuration)}
                fps={project.config.fps}
                compositionWidth={compWidth}
                compositionHeight={compHeight}
                style={{ width: '100%', height: '100%' }}
                controls={false}
                loop={false}
                clickToPlay={false}
            />
        </div>
    )
}

export default RemotionPreview
