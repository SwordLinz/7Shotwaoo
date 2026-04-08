import type { VideoEditorProject, VideoClip } from '../types/editor.types'
import { computeClipPositions } from '../utils/time-utils'

/**
 * Export a VideoEditorProject to Final Cut Pro XML (XMEML 4) format.
 * This format is natively importable by:
 *  - Adobe Premiere Pro (File > Import)
 *  - DaVinci Resolve (File > Import Timeline > FCP XML)
 *  - Final Cut Pro 7 / X (via legacy import)
 *
 * Limitations of this exporter:
 *  - Single video track (magnetic timeline → flat V1)
 *  - Transitions are mapped to dissolve only (FCP XML cross-dissolve)
 *  - Audio attachments become a separate A1 track
 */

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function fileIdFromClip(clip: VideoClip): string {
  return `file-${clip.id}`
}

function buildFileElement(clip: VideoClip, fps: number, width: number, height: number): string {
  const fileId = fileIdFromClip(clip)
  const name = clip.metadata?.description || `Clip ${clip.id}`
  const sourceDuration = clip.trim
    ? clip.trim.to - clip.trim.from
    : clip.durationInFrames

  return `
            <file id="${fileId}">
              <name>${escapeXml(name)}</name>
              <pathurl>${escapeXml(clip.src)}</pathurl>
              <duration>${sourceDuration}</duration>
              <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
              <media>
                <video>
                  <samplecharacteristics>
                    <width>${width}</width>
                    <height>${height}</height>
                  </samplecharacteristics>
                </video>
              </media>
            </file>`
}

function buildClipItem(
  clip: VideoClip,
  index: number,
  startFrame: number,
  fps: number,
  width: number,
  height: number,
): string {
  const clipItemId = `clipitem-${index + 1}`
  const name = clip.metadata?.description || `Clip ${index + 1}`
  const inPoint = clip.trim?.from ?? 0
  const outPoint = clip.trim ? clip.trim.to : clip.durationInFrames
  const endFrame = startFrame + clip.durationInFrames

  return `
          <clipitem id="${clipItemId}">
            <name>${escapeXml(name)}</name>
            <duration>${clip.durationInFrames}</duration>
            <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
            <in>${inPoint}</in>
            <out>${outPoint}</out>
            <start>${startFrame}</start>
            <end>${endFrame}</end>
            ${buildFileElement(clip, fps, width, height)}
          </clipitem>`
}

function buildAudioClipItem(
  clip: VideoClip,
  index: number,
  startFrame: number,
  fps: number,
): string {
  if (!clip.attachment?.audio?.src) return ''

  const clipItemId = `audio-clipitem-${index + 1}`
  const audioFileId = `audio-file-${clip.id}`
  const name = clip.attachment.subtitle?.text || `Voice ${index + 1}`

  return `
          <clipitem id="${clipItemId}">
            <name>${escapeXml(name)}</name>
            <duration>${clip.durationInFrames}</duration>
            <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
            <in>0</in>
            <out>${clip.durationInFrames}</out>
            <start>${startFrame}</start>
            <end>${startFrame + clip.durationInFrames}</end>
            <file id="${audioFileId}">
              <name>${escapeXml(name)}</name>
              <pathurl>${escapeXml(clip.attachment.audio.src)}</pathurl>
              <duration>${clip.durationInFrames}</duration>
              <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
            </file>
          </clipitem>`
}

function buildTransitionItem(
  clip: VideoClip,
  startFrame: number,
): string {
  if (!clip.transition || clip.transition.type === 'none') return ''

  const dur = clip.transition.durationInFrames
  const alignOffset = startFrame + clip.durationInFrames - Math.floor(dur / 2)

  return `
          <transitionitem>
            <start>${alignOffset}</start>
            <end>${alignOffset + dur}</end>
            <alignment>center</alignment>
            <rate><timebase>30</timebase><ntsc>FALSE</ntsc></rate>
            <effect>
              <name>Cross Dissolve</name>
              <effectid>CrossDissolve</effectid>
              <effecttype>transition</effecttype>
              <mediatype>video</mediatype>
            </effect>
          </transitionitem>`
}

export function exportToFcpXml(project: VideoEditorProject, sequenceName?: string): string {
  const { fps, width, height } = project.config
  const computed = computeClipPositions(project.timeline)
  const totalDuration = computed.length > 0
    ? computed[computed.length - 1].endFrame
    : 0

  const name = sequenceName || `Wacoo Export - ${project.episodeId}`

  const videoClipItems = computed
    .map((c, i) => buildClipItem(c, i, c.startFrame, fps, width, height))
    .join('')

  const transitionItems = computed
    .filter((c, i) => i < computed.length - 1 && c.transition && c.transition.type !== 'none')
    .map((c) => buildTransitionItem(c, c.startFrame))
    .join('')

  const audioClipItems = computed
    .filter(c => c.attachment?.audio?.src)
    .map((c, i) => buildAudioClipItem(c, i, c.startFrame, fps))
    .join('')

  const hasAudio = audioClipItems.length > 0

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
  <sequence>
    <name>${escapeXml(name)}</name>
    <duration>${totalDuration}</duration>
    <rate>
      <timebase>${fps}</timebase>
      <ntsc>FALSE</ntsc>
    </rate>
    <media>
      <video>
        <format>
          <samplecharacteristics>
            <width>${width}</width>
            <height>${height}</height>
            <pixelaspectratio>square</pixelaspectratio>
            <fielddominance>none</fielddominance>
            <rate>
              <timebase>${fps}</timebase>
              <ntsc>FALSE</ntsc>
            </rate>
          </samplecharacteristics>
        </format>
        <track>
          ${videoClipItems}
          ${transitionItems}
        </track>
      </video>${hasAudio ? `
      <audio>
        <format>
          <samplecharacteristics>
            <samplerate>48000</samplerate>
            <depth>16</depth>
          </samplecharacteristics>
        </format>
        <track>
          ${audioClipItems}
        </track>
      </audio>` : ''}
    </media>
  </sequence>
</xmeml>
`
}
