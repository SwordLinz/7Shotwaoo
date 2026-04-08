import type { VideoEditorProject } from '../types/editor.types'
import { computeClipPositions, framesToTime } from '../utils/time-utils'

/**
 * Export the timeline as a video bundle (ZIP):
 *  - All video clips downloaded as numbered MP4 files
 *  - An FFmpeg concat script that can be run locally to merge them
 *  - A human-readable playlist.txt
 *
 * This gives the user a self-contained package they can merge with
 * one FFmpeg command: `ffmpeg -f concat -safe 0 -i concat.txt -c copy output.mp4`
 */
export async function exportVideoBundle(
    project: VideoEditorProject,
    onProgress?: (pct: number, label: string) => void,
): Promise<void> {
    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()
    const computed = computeClipPositions(project.timeline)
    const fps = project.config.fps
    const total = computed.length

    if (total === 0) throw new Error('No clips to export')

    onProgress?.(0, 'Downloading clips...')

    const filenames: string[] = []

    for (let i = 0; i < total; i++) {
        const clip = computed[i]
        const label = `${i + 1}/${total}`
        onProgress?.(Math.round(((i) / total) * 80), `Downloading ${label}...`)

        try {
            const resp = await fetch(clip.src)
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
            const blob = await resp.blob()

            const ext = clip.src.includes('.webm') ? 'webm' : 'mp4'
            const filename = `clip_${String(i + 1).padStart(3, '0')}.${ext}`
            zip.file(filename, blob)
            filenames.push(filename)
        } catch {
            const filename = `clip_${String(i + 1).padStart(3, '0')}_MISSING.txt`
            zip.file(filename, `Failed to download: ${clip.src}\n`)
            filenames.push(filename)
        }
    }

    onProgress?.(80, 'Adding BGM...')

    for (let i = 0; i < project.bgmTrack.length; i++) {
        const bgm = project.bgmTrack[i]
        try {
            const resp = await fetch(bgm.src)
            if (resp.ok) {
                const blob = await resp.blob()
                zip.file(`bgm_${String(i + 1).padStart(2, '0')}.mp3`, blob)
            }
        } catch {
            // BGM might be a blob URL from upload — skip silently
        }
    }

    onProgress?.(85, 'Generating merge script...')

    const concatLines = filenames
        .filter(f => !f.endsWith('_MISSING.txt'))
        .map(f => `file '${f}'`)
        .join('\n')
    zip.file('concat.txt', concatLines + '\n')

    const playlistLines = computed.map((c, i) => {
        const start = framesToTime(c.startFrame, fps)
        const dur = framesToTime(c.durationInFrames, fps)
        const desc = c.metadata?.description || ''
        return `${i + 1}. [${start}] ${dur}  ${desc}`
    }).join('\n')

    zip.file('playlist.txt', [
        `Wacoo Video Export`,
        `Episode: ${project.episodeId}`,
        `Clips: ${total}`,
        `FPS: ${fps}`,
        `Resolution: ${project.config.width}x${project.config.height}`,
        ``,
        `--- Timeline ---`,
        playlistLines,
        ``,
        `--- Merge with FFmpeg ---`,
        `ffmpeg -f concat -safe 0 -i concat.txt -c copy output.mp4`,
    ].join('\n') + '\n')

    onProgress?.(90, 'Compressing ZIP...')
    const blob = await zip.generateAsync({ type: 'blob' })

    onProgress?.(100, 'Downloading...')
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `wacoo_video_${project.episodeId.slice(0, 8)}.zip`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}
