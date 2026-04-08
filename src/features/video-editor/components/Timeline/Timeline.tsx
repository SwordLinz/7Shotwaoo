'use client'

import React, { useRef, useCallback, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
    DndContext, closestCenter, KeyboardSensor, PointerSensor,
    useSensor, useSensors, DragEndEvent
} from '@dnd-kit/core'
import {
    SortableContext, sortableKeyboardCoordinates,
    horizontalListSortingStrategy, useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { VideoClip, BgmClip, TimelineState, EditorConfig } from '../../types/editor.types'
import { framesToTime } from '../../utils/time-utils'

interface TimelineProps {
    clips: VideoClip[]
    bgmTrack?: BgmClip[]
    timelineState: TimelineState
    config: EditorConfig
    onReorder: (fromIndex: number, toIndex: number) => void
    onSelectClip: (clipId: string | null) => void
    onZoomChange: (zoom: number) => void
    onSeek?: (frame: number) => void
    onUpdateBgm?: (bgmId: string, updates: Partial<BgmClip>) => void
    onSelectBgm?: (bgmId: string | null) => void
}

const TRACK_LABEL_W = 60
const PX_PER_FRAME_BASE = 2

export const Timeline: React.FC<TimelineProps> = ({
    clips, bgmTrack = [], timelineState, config,
    onReorder, onSelectClip, onZoomChange, onSeek, onUpdateBgm, onSelectBgm
}) => {
    const t = useTranslations('video')
    const totalDuration = clips.reduce((sum, clip) => sum + clip.durationInFrames, 0)
    const scale = timelineState.zoom * PX_PER_FRAME_BASE
    const totalPx = totalDuration * scale
    const playheadPx = timelineState.currentFrame * scale

    const scrollRef = useRef<HTMLDivElement>(null)

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    )

    const handleDragEnd = useCallback((event: DragEndEvent) => {
        const { active, over } = event
        if (over && active.id !== over.id) {
            onReorder(
                clips.findIndex(c => c.id === active.id),
                clips.findIndex(c => c.id === over.id),
            )
        }
    }, [clips, onReorder])

    const handleRulerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (!onSeek || totalDuration === 0) return
        const rect = e.currentTarget.getBoundingClientRect()
        const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0)
        onSeek(Math.max(0, Math.min(totalDuration, Math.round(x / scale))))
    }, [onSeek, totalDuration, scale])

    const rulerTicks = generateRulerTicks(totalDuration, config.fps, scale)
    const trackWidth = `${Math.max(totalPx, 600)}px`

    const playheadLine = (
        <div style={{
            position: 'absolute', left: `${playheadPx}px`,
            top: 0, bottom: 0, width: '2px',
            background: 'var(--glass-accent-from)',
            transform: 'translateX(-1px)', pointerEvents: 'none', zIndex: 10,
        }} />
    )

    return (
        <div style={{
            display: 'flex', flexDirection: 'column',
            height: '100%', color: 'var(--glass-text-primary)',
            background: 'var(--glass-bg-surface-strong)',
            userSelect: 'none',
        }}>
            {/* Time ruler */}
            <div style={{ display: 'flex', height: '24px', flexShrink: 0, borderBottom: '1px solid var(--glass-stroke-soft)' }}>
                <div style={{ width: TRACK_LABEL_W, flexShrink: 0, borderRight: '1px solid var(--glass-stroke-soft)' }} />
                <div
                    ref={scrollRef}
                    onClick={handleRulerClick}
                    style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', position: 'relative', cursor: 'pointer' }}
                >
                    <div style={{ width: trackWidth, height: '100%', position: 'relative' }}>
                        {rulerTicks.map((tick, i) => (
                            <div key={i} style={{
                                position: 'absolute', left: `${tick.px}px`, bottom: 0,
                                display: 'flex', flexDirection: 'column', alignItems: 'center',
                            }}>
                                {tick.label && (
                                    <span style={{ fontSize: '9px', color: 'var(--glass-text-tertiary)', whiteSpace: 'nowrap', transform: 'translateX(-50%)' }}>
                                        {tick.label}
                                    </span>
                                )}
                                <div style={{ width: '1px', height: tick.major ? '8px' : '4px', background: 'var(--glass-stroke-soft)' }} />
                            </div>
                        ))}
                        <div style={{
                            position: 'absolute', left: `${playheadPx}px`,
                            top: 0, bottom: 0, width: '2px',
                            background: 'var(--glass-accent-from)', transform: 'translateX(-1px)', zIndex: 5,
                        }} />
                    </div>
                </div>
            </div>

            {/* Tracks */}
            <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0 }}>

                {/* Video track */}
                <TrackRow label={t('editor.timeline.videoTrack')} color="var(--glass-accent-from)">
                    <div style={{ width: trackWidth, position: 'relative', height: '100%' }}>
                        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                            <SortableContext items={clips.map(c => c.id)} strategy={horizontalListSortingStrategy}>
                                <div style={{ display: 'flex', height: '100%', alignItems: 'center' }}>
                                    {clips.map((clip, index) => (
                                        <SortableClip
                                            key={clip.id} clip={clip} index={index}
                                            isSelected={timelineState.selectedClipId === clip.id}
                                            scale={scale} fps={config.fps}
                                            onClick={() => onSelectClip(clip.id)}
                                        />
                                    ))}
                                    {clips.length === 0 && (
                                        <span style={{ fontSize: '12px', color: 'var(--glass-text-tertiary)', paddingLeft: '12px' }}>
                                            {t('editor.timeline.emptyHint')}
                                        </span>
                                    )}
                                </div>
                            </SortableContext>
                        </DndContext>
                        {playheadLine}
                    </div>
                </TrackRow>

                {/* Audio / voice track */}
                <TrackRow label={t('editor.timeline.audioTrack')} color="var(--glass-tone-info-fg)">
                    <div style={{ width: trackWidth, position: 'relative', height: '100%', display: 'flex', alignItems: 'center' }}>
                        {clips.filter(c => c.attachment?.audio).map((clip) => (
                            <div
                                key={`audio-${clip.id}`}
                                style={{
                                    width: `${clip.durationInFrames * scale}px`,
                                    height: '24px',
                                    background: 'var(--glass-tone-info-bg)',
                                    borderRadius: 'var(--glass-radius-xs)',
                                    border: '1px solid var(--glass-tone-info-fg)',
                                    fontSize: '9px', color: 'var(--glass-tone-info-fg)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                    opacity: 0.8,
                                }}
                            >
                                {t('editor.timeline.audioBadge')}
                            </div>
                        ))}
                        {playheadLine}
                    </div>
                </TrackRow>

                {/* BGM track */}
                <TrackRow label="BGM" color="var(--glass-tone-warning-fg)">
                    <div style={{ width: trackWidth, position: 'relative', height: '100%', display: 'flex', alignItems: 'center' }}>
                        {bgmTrack.map((bgm) => (
                            <DraggableBgmClip
                                key={bgm.id}
                                bgm={bgm}
                                scale={scale}
                                fps={config.fps}
                                isSelected={timelineState.selectedBgmId === bgm.id}
                                onSelect={() => onSelectBgm?.(bgm.id)}
                                onUpdate={onUpdateBgm}
                            />
                        ))}
                        {playheadLine}
                    </div>
                </TrackRow>
            </div>
        </div>
    )
}

/* ---- Draggable & resizable BGM clip ---- */

function DraggableBgmClip({ bgm, scale, fps, isSelected, onSelect, onUpdate }: {
    bgm: BgmClip; scale: number; fps: number
    isSelected?: boolean
    onSelect?: () => void
    onUpdate?: (bgmId: string, updates: Partial<BgmClip>) => void
}) {
    const [dragState, setDragState] = useState<{
        type: 'move' | 'resize-left' | 'resize-right'
        originX: number
        origStart: number
        origDuration: number
    } | null>(null)

    const [liveOffset, setLiveOffset] = useState({ startDelta: 0, durationDelta: 0 })

    const leftPx = (bgm.startFrame + liveOffset.startDelta) * scale
    const widthPx = (bgm.durationInFrames + liveOffset.durationDelta) * scale

    const handlePointerDown = useCallback((e: React.PointerEvent, type: 'move' | 'resize-left' | 'resize-right') => {
        e.preventDefault()
        e.stopPropagation()
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        setDragState({
            type, originX: e.clientX,
            origStart: bgm.startFrame, origDuration: bgm.durationInFrames,
        })
        setLiveOffset({ startDelta: 0, durationDelta: 0 })
    }, [bgm.startFrame, bgm.durationInFrames])

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        if (!dragState) return
        const dx = e.clientX - dragState.originX
        const frameDelta = Math.round(dx / scale)

        if (dragState.type === 'move') {
            const newStart = Math.max(0, dragState.origStart + frameDelta)
            setLiveOffset({ startDelta: newStart - bgm.startFrame, durationDelta: 0 })
        } else if (dragState.type === 'resize-left') {
            const maxShrink = dragState.origDuration - 30 // min 1 second
            const clampedDelta = Math.max(-dragState.origStart, Math.min(maxShrink, frameDelta))
            setLiveOffset({ startDelta: clampedDelta, durationDelta: -clampedDelta })
        } else {
            const minDur = 30
            const newDur = Math.max(minDur, dragState.origDuration + frameDelta)
            setLiveOffset({ startDelta: 0, durationDelta: newDur - bgm.durationInFrames })
        }
    }, [dragState, scale, bgm.startFrame, bgm.durationInFrames])

    const handlePointerUp = useCallback(() => {
        if (!dragState || !onUpdate) return
        const finalStart = bgm.startFrame + liveOffset.startDelta
        const finalDuration = bgm.durationInFrames + liveOffset.durationDelta
        onUpdate(bgm.id, {
            startFrame: Math.max(0, finalStart),
            durationInFrames: Math.max(30, finalDuration),
        })
        setDragState(null)
        setLiveOffset({ startDelta: 0, durationDelta: 0 })
    }, [dragState, onUpdate, bgm.id, bgm.startFrame, bgm.durationInFrames, liveOffset])

    return (
        <div
            style={{
                position: 'absolute',
                left: `${Math.max(0, leftPx)}px`,
                width: `${Math.max(20, widthPx)}px`,
                height: '28px',
                background: isSelected
                    ? 'linear-gradient(135deg, var(--glass-accent-from), var(--glass-accent-to))'
                    : 'var(--glass-tone-warning-bg)',
                borderRadius: 'var(--glass-radius-xs)',
                border: isSelected ? '2px solid var(--glass-stroke-focus)' : '1px solid var(--glass-tone-warning-fg)',
                fontSize: '9px',
                color: isSelected ? 'var(--glass-text-on-accent)' : 'var(--glass-tone-warning-fg)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: dragState?.type === 'move' ? 'grabbing' : 'grab',
                opacity: dragState ? 0.85 : 1,
            }}
            onClick={(e) => { e.stopPropagation(); onSelect?.() }}
            onPointerDown={(e) => handlePointerDown(e, 'move')}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
        >
            {/* Left resize handle */}
            <div
                onPointerDown={(e) => handlePointerDown(e, 'resize-left')}
                style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0, width: '6px',
                    cursor: 'ew-resize', borderRadius: 'var(--glass-radius-xs) 0 0 var(--glass-radius-xs)',
                    background: 'var(--glass-tone-warning-fg)', opacity: 0.4,
                }}
            />
            <span style={{ pointerEvents: 'none', zIndex: 1 }}>
                BGM · {framesToTime(bgm.durationInFrames + liveOffset.durationDelta, fps)}
            </span>
            {/* Right resize handle */}
            <div
                onPointerDown={(e) => handlePointerDown(e, 'resize-right')}
                style={{
                    position: 'absolute', right: 0, top: 0, bottom: 0, width: '6px',
                    cursor: 'ew-resize', borderRadius: '0 var(--glass-radius-xs) var(--glass-radius-xs) 0',
                    background: 'var(--glass-tone-warning-fg)', opacity: 0.4,
                }}
            />
        </div>
    )
}

/* ---- Track row wrapper ---- */

function TrackRow({ label, color, children }: { label: string; color: string; children: React.ReactNode }) {
    return (
        <div style={{ display: 'flex', minHeight: '48px', borderBottom: '1px solid var(--glass-stroke-soft)' }}>
            <div style={{
                width: TRACK_LABEL_W, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRight: '1px solid var(--glass-stroke-soft)',
                background: 'var(--glass-bg-surface)',
            }}>
                <span style={{ fontSize: '11px', color, fontWeight: 600 }}>{label}</span>
            </div>
            <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden' }}>
                {children}
            </div>
        </div>
    )
}

/* ---- Sortable video clip ---- */

interface SortableClipProps {
    clip: VideoClip; index: number; isSelected: boolean
    scale: number; fps: number; onClick: () => void
}

const SortableClip: React.FC<SortableClipProps> = ({ clip, index, isSelected, scale, fps, onClick }) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: clip.id })
    const widthPx = Math.max(clip.durationInFrames * scale, 40)

    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform), transition,
        width: `${widthPx}px`, height: '38px',
        background: isSelected
            ? 'linear-gradient(135deg, var(--glass-accent-from), var(--glass-accent-to))'
            : isDragging ? 'var(--glass-bg-muted)' : 'var(--glass-bg-surface)',
        borderRadius: 'var(--glass-radius-xs)',
        display: 'flex', alignItems: 'center', gap: '6px',
        paddingLeft: '8px', paddingRight: '6px', fontSize: '11px',
        color: isSelected ? 'var(--glass-text-on-accent)' : 'var(--glass-text-primary)',
        cursor: isDragging ? 'grabbing' : 'grab', flexShrink: 0,
        border: isSelected ? '1px solid var(--glass-stroke-focus)' : '1px solid var(--glass-stroke-soft)',
        opacity: isDragging ? 0.7 : 1, zIndex: isDragging ? 100 : 1,
        position: 'relative', overflow: 'hidden',
    }

    return (
        <div ref={setNodeRef} style={style} onClick={onClick} {...attributes} {...listeners}>
            <span style={{ fontWeight: 700, fontSize: '12px' }}>{index + 1}</span>
            {widthPx > 80 && (
                <span style={{
                    fontSize: '9px',
                    color: isSelected ? 'rgba(255,255,255,0.7)' : 'var(--glass-text-tertiary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                }}>
                    {clip.metadata?.description || ''}
                </span>
            )}
            <span style={{
                fontSize: '9px', flexShrink: 0,
                color: isSelected ? 'rgba(255,255,255,0.6)' : 'var(--glass-text-tertiary)',
            }}>
                {framesToTime(clip.durationInFrames, fps)}
            </span>
            {clip.transition && clip.transition.type !== 'none' && (
                <div style={{
                    position: 'absolute', right: 0, top: 0, bottom: 0,
                    width: '5px', background: 'var(--glass-tone-warning-fg)', opacity: 0.6,
                }} />
            )}
        </div>
    )
}

/* ---- Ruler ticks ---- */

interface RulerTick { px: number; label: string; major: boolean }

function generateRulerTicks(totalFrames: number, fps: number, scale: number): RulerTick[] {
    if (totalFrames === 0) return []
    const totalSeconds = totalFrames / fps
    let stepSeconds: number
    if (scale > 3) stepSeconds = 0.5
    else if (scale > 1.5) stepSeconds = 1
    else if (scale > 0.8) stepSeconds = 2
    else if (scale > 0.4) stepSeconds = 5
    else stepSeconds = 10

    const ticks: RulerTick[] = []
    for (let s = 0; s <= totalSeconds + stepSeconds; s += stepSeconds) {
        const frame = Math.round(s * fps)
        const px = frame * scale
        const major = s % (stepSeconds * 2) === 0 || stepSeconds >= 5
        const mins = Math.floor(s / 60)
        const secs = Math.floor(s % 60)
        ticks.push({ px, label: major ? `${mins}:${secs.toString().padStart(2, '0')}` : '', major })
    }
    return ticks
}

export default Timeline
