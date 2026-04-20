'use client'

import { memo, useState, useCallback } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useTranslations } from 'next-intl'

function ImagePreviewNodeInner({ data }: NodeProps) {
  const t = useTranslations('storyboard.nodeCanvas.imageNode')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file)
      setImageUrl(url)
    }
  }, [])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          const url = URL.createObjectURL(file)
          setImageUrl(url)
        }
        break
      }
    }
  }, [])

  const handleSaveAsReference = useCallback(async () => {
    if (!imageUrl) return
    const projectId = (data as { projectId?: string })?.projectId
    if (!projectId) return
    try {
      await fetch(`/api/novel-promotion/${projectId}/reference-assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Image ${new Date().toLocaleString()}`,
          imageUrl,
          sourceType: 'manual-upload',
        }),
      })
    } catch {
      // silently fail
    }
  }, [imageUrl, data])

  return (
    <div className="glass-surface-elevated min-w-[280px]">
      <Handle type="target" position={Position.Left} className="!bg-[var(--glass-tone-success-fg)]" />

      <div className="px-3 py-2 border-b border-[var(--glass-stroke-soft)] rounded-t-[var(--glass-radius-lg)] bg-[var(--glass-tone-success-bg)]">
        <span className="text-xs font-semibold text-[var(--glass-tone-success-fg)]">{t('title')}</span>
      </div>

      <div
        className="p-3"
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
        onDragLeave={() => setIsDragOver(false)}
        onPaste={handlePaste}
        tabIndex={0}
      >
        {imageUrl ? (
          <div className="space-y-2">
            <img src={imageUrl} alt="preview" className="w-full rounded-[var(--glass-radius-sm)] border border-[var(--glass-stroke-soft)]" />
            <button
              onClick={handleSaveAsReference}
              className="glass-btn-base glass-btn-ghost w-full h-7 text-xs"
            >
              {t('saveAsReference')}
            </button>
          </div>
        ) : (
          <div
            className={`flex items-center justify-center h-32 rounded-[var(--glass-radius-sm)] border-2 border-dashed transition-colors ${
              isDragOver
                ? 'border-[var(--glass-tone-success-fg)] bg-[var(--glass-tone-success-bg)]'
                : 'border-[var(--glass-stroke-base)]'
            }`}
          >
            <p className="text-xs text-[var(--glass-text-tertiary)]">{t('noImage')}</p>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="!bg-[var(--glass-tone-success-fg)]" />
    </div>
  )
}

export default memo(ImagePreviewNodeInner)
