import type { VideoEditorProject, VideoClip, BgmClip } from '../types/editor.types'

/**
 * Merge all timeline clips into a single video with audio.
 *
 * Uses Canvas (video) + AudioContext (audio) → combined MediaStream → MediaRecorder.
 * Handles: clip video, clip attachment audio, BGM track.
 */
export async function exportMergedVideo(
    project: VideoEditorProject,
    onProgress?: (pct: number, label: string) => void,
): Promise<void> {
    const clips = project.timeline
    if (clips.length === 0) throw new Error('No clips to export')

    onProgress?.(0, 'Probing video...')

    const { width: srcW, height: srcH } = await probeVideoDimensions(clips[0].src)
    const canvasW = srcW || project.config.width
    const canvasH = srcH || project.config.height
    const fps = project.config.fps

    const canvas = document.createElement('canvas')
    canvas.width = canvasW
    canvas.height = canvasH
    const ctx = canvas.getContext('2d')!

    const audioCtx = new AudioContext()
    const audioDest = audioCtx.createMediaStreamDestination()

    const videoStream = canvas.captureStream(fps)
    const combined = new MediaStream([
        ...videoStream.getVideoTracks(),
        ...audioDest.stream.getAudioTracks(),
    ])

    const mimeType = getPreferredMimeType()
    const recorder = new MediaRecorder(combined, {
        mimeType,
        videoBitsPerSecond: 8_000_000,
        audioBitsPerSecond: 192_000,
    })

    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
    }

    recorder.start(100)

    // Play BGM in background if exists
    const bgmCleanup = startBgmPlayback(project.bgmTrack, audioCtx, audioDest, fps)

    for (let i = 0; i < clips.length; i++) {
        onProgress?.(
            Math.round((i / clips.length) * 95),
            `${i + 1}/${clips.length}`,
        )
        await renderClipWithAudio(clips[i], ctx, canvasW, canvasH, audioCtx, audioDest)
    }

    bgmCleanup()

    onProgress?.(95, 'Finalizing...')

    await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve()
        recorder.stop()
    })

    videoStream.getTracks().forEach(t => t.stop())
    audioDest.stream.getTracks().forEach(t => t.stop())
    await audioCtx.close()

    const isMP4 = mimeType.includes('mp4')
    const ext = isMP4 ? 'mp4' : 'webm'
    const blob = new Blob(chunks, { type: mimeType })

    onProgress?.(100, 'Downloading...')

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `wacoo_merged_${project.episodeId.slice(0, 8)}.${ext}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}

function getPreferredMimeType(): string {
    const candidates = [
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4;codecs=avc1.42E01E',
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9',
        'video/webm',
    ]
    for (const mime of candidates) {
        if (MediaRecorder.isTypeSupported(mime)) return mime
    }
    return 'video/webm'
}

function probeVideoDimensions(src: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve) => {
        const video = document.createElement('video')
        video.crossOrigin = 'anonymous'
        video.muted = true
        video.preload = 'metadata'

        const timeout = setTimeout(() => {
            video.remove()
            resolve({ width: 0, height: 0 })
        }, 8000)

        video.onloadedmetadata = () => {
            clearTimeout(timeout)
            resolve({ width: video.videoWidth, height: video.videoHeight })
            video.remove()
        }
        video.onerror = () => {
            clearTimeout(timeout)
            video.remove()
            resolve({ width: 0, height: 0 })
        }
        video.src = src
    })
}

/**
 * Render a single clip: draw video frames to canvas AND route its audio
 * (both the video's own audio track and any attached voice) to the AudioContext.
 */
function renderClipWithAudio(
    clip: VideoClip,
    ctx: CanvasRenderingContext2D,
    cw: number,
    ch: number,
    audioCtx: AudioContext,
    audioDest: MediaStreamAudioDestinationNode,
): Promise<void> {
    return new Promise((resolve) => {
        const video = document.createElement('video')
        video.crossOrigin = 'anonymous'
        video.playsInline = true
        video.preload = 'auto'

        let videoAudioSource: MediaElementAudioSourceNode | null = null
        let attachAudio: HTMLAudioElement | null = null
        let attachSource: MediaElementAudioSourceNode | null = null
        let animFrameId = 0
        let stopped = false

        const cleanup = () => {
            stopped = true
            cancelAnimationFrame(animFrameId)
            try { videoAudioSource?.disconnect() } catch { /* */ }
            try { attachSource?.disconnect() } catch { /* */ }
            if (attachAudio) { attachAudio.pause(); attachAudio.remove() }
            video.pause()
            video.remove()
        }

        const drawFrame = () => {
            if (stopped) return
            drawVideoContain(ctx, video, cw, ch)
            animFrameId = requestAnimationFrame(drawFrame)
        }

        video.onended = () => {
            drawVideoContain(ctx, video, cw, ch)
            cleanup()
            resolve()
        }

        video.onerror = () => {
            ctx.fillStyle = '#000'
            ctx.fillRect(0, 0, cw, ch)
            cleanup()
            setTimeout(resolve, 200)
        }

        video.oncanplaythrough = () => {
            // Route the video element's own audio to the recorder
            try {
                videoAudioSource = audioCtx.createMediaElementSource(video)
                videoAudioSource.connect(audioDest)
                videoAudioSource.connect(audioCtx.destination) // also play locally so user hears it
            } catch {
                // some videos have no audio track
            }

            // Play clip attachment audio (voice/dubbing) in parallel
            if (clip.attachment?.audio?.src) {
                attachAudio = new Audio(clip.attachment.audio.src)
                attachAudio.crossOrigin = 'anonymous'
                attachAudio.volume = clip.attachment.audio.volume ?? 1
                try {
                    attachSource = audioCtx.createMediaElementSource(attachAudio)
                    attachSource.connect(audioDest)
                    attachSource.connect(audioCtx.destination)
                } catch { /* */ }
                attachAudio.play().catch(() => {})
            }

            drawFrame()
            video.play().catch(() => {
                video.onerror?.(new Event('error'))
            })
        }

        video.src = clip.src
    })
}

/**
 * Start BGM playback for the entire export duration.
 * Returns a cleanup function.
 */
function startBgmPlayback(
    bgmTrack: BgmClip[],
    audioCtx: AudioContext,
    audioDest: MediaStreamAudioDestinationNode,
    _fps: number,
): () => void {
    const elements: HTMLAudioElement[] = []
    const sources: MediaElementAudioSourceNode[] = []
    const gains: GainNode[] = []

    for (const bgm of bgmTrack) {
        const audio = new Audio(bgm.src)
        audio.crossOrigin = 'anonymous'
        audio.loop = true

        try {
            const source = audioCtx.createMediaElementSource(audio)
            const gain = audioCtx.createGain()
            gain.gain.value = bgm.volume
            source.connect(gain)
            gain.connect(audioDest)
            gain.connect(audioCtx.destination)
            elements.push(audio)
            sources.push(source)
            gains.push(gain)
            audio.play().catch(() => {})
        } catch {
            // blob URL might not support CORS
        }
    }

    return () => {
        for (const el of elements) { el.pause(); el.remove() }
        for (const s of sources) { try { s.disconnect() } catch { /* */ } }
        for (const g of gains) { try { g.disconnect() } catch { /* */ } }
    }
}

function drawVideoContain(
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    cw: number,
    ch: number,
) {
    const vw = video.videoWidth || cw
    const vh = video.videoHeight || ch
    const scale = Math.min(cw / vw, ch / vh)
    const dw = vw * scale
    const dh = vh * scale
    const dx = (cw - dw) / 2
    const dy = (ch - dh) / 2

    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, cw, ch)
    ctx.drawImage(video, dx, dy, dw, dh)
}

export { probeVideoDimensions }
