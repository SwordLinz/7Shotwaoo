export { exportToFcpXml } from './fcpxml-exporter'
export { exportToJianyingDraft, exportJianyingMeta } from './jianying-exporter'

import type { VideoEditorProject } from '../types/editor.types'
import { exportToFcpXml } from './fcpxml-exporter'
import { exportToJianyingDraft, exportJianyingMeta } from './jianying-exporter'

export type ExportFormat = 'fcpxml' | 'jianying'

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Export and trigger browser download for the given format.
 *
 * - `fcpxml`: single .xml file importable by Premiere Pro / DaVinci Resolve
 * - `jianying`: downloads a .zip containing draft_content.json + draft_meta_info.json
 */
export async function downloadProjectExport(
  project: VideoEditorProject,
  format: ExportFormat,
  projectName?: string,
) {
  const safeName = (projectName || project.episodeId).replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_')

  if (format === 'fcpxml') {
    const xml = exportToFcpXml(project, projectName)
    const blob = new Blob([xml], { type: 'application/xml' })
    downloadBlob(blob, `${safeName}.xml`)
    return
  }

  if (format === 'jianying') {
    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()
    zip.file('draft_content.json', exportToJianyingDraft(project))
    zip.file('draft_meta_info.json', exportJianyingMeta(projectName))
    const blob = await zip.generateAsync({ type: 'blob' })
    downloadBlob(blob, `${safeName}_jianying.zip`)
    return
  }

  throw new Error(`Unsupported export format: ${format}`)
}
