'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { resolveOriginalImageUrl, toDisplayImageUrl } from '@/lib/media/image-url'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import { AppIcon } from '@/components/ui/icons'

export interface ImagePreviewInfoChip {
  label: string
  value: string
}

interface ImagePreviewModalProps {
  imageUrl: string | null
  onClose: () => void
  /** 与「查看原图」同排的生成参数展示（如项目宽高比、画质），可选 */
  infoChips?: ImagePreviewInfoChip[]
}

export default function ImagePreviewModal({ imageUrl, onClose, infoChips }: ImagePreviewModalProps) {
  const t = useTranslations('common')

  useEffect(() => {
    // 禁用body滚动
    document.body.style.overflow = 'hidden'

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)

    return () => {
      document.body.style.overflow = 'unset'
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  if (!imageUrl) return null
  const displayImageUrl = toDisplayImageUrl(imageUrl)
  const originalImageUrl = resolveOriginalImageUrl(imageUrl) || displayImageUrl
  if (!displayImageUrl) return null

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-[var(--glass-overlay)] backdrop-blur-sm"
      onClick={onClose}
      style={{ margin: 0, padding: 0 }}
    >
      <div className="relative max-w-7xl max-h-[90vh] p-4">
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="absolute top-6 right-6 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-[var(--glass-overlay)] hover:bg-[var(--glass-overlay)] text-white transition-colors"
        >
          <AppIcon name="close" className="w-6 h-6" />
        </button>
        {originalImageUrl && (
          <a
            href={originalImageUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="absolute top-6 right-20 z-10 px-3 h-10 inline-flex items-center rounded-full bg-[var(--glass-overlay)] hover:bg-[var(--glass-overlay)] text-white text-sm transition-colors"
          >
            {t('viewOriginal')}
          </a>
        )}

        {infoChips && infoChips.length > 0 && (
          <div
            className="absolute top-6 left-6 z-10 flex flex-wrap items-center gap-2 max-w-[min(100%,42rem)]"
            onClick={(e) => e.stopPropagation()}
          >
            {infoChips.map((chip) => (
              <span
                key={`${chip.label}:${chip.value}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--glass-overlay)] px-3 py-1.5 text-xs text-white/95"
              >
                <span className="text-white/75">{chip.label}</span>
                <span className="font-medium tabular-nums">{chip.value}</span>
              </span>
            ))}
          </div>
        )}

        {/* 图片 */}
        <MediaImageWithLoading
          src={displayImageUrl}
          alt={t('preview')}
          containerClassName="max-w-full max-h-[90vh]"
          className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  )
}
