'use client'

import { memo, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { NovelPromotionPanel } from '@/types/project'

interface SmartRefPanelCardProps {
  panel: NovelPromotionPanel
  isGenerating: boolean
  onGenerate: (panelId: string) => void
  t: (key: string, values?: Record<string, string | number | Date>) => string
}

function parseCharacters(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === 'string')
    return []
  } catch {
    return raw.split(/[,，、]/).map((s) => s.trim()).filter(Boolean)
  }
}

function SmartRefPanelCardInner({
  panel,
  isGenerating,
  onGenerate,
  t,
}: SmartRefPanelCardProps) {
  const [showFullPrompt, setShowFullPrompt] = useState(false)
  const hasVideo = !!panel.videoUrl
  const characters = parseCharacters(panel.characters)
  const promptText = panel.videoPrompt || panel.description || ''
  const truncatedPrompt = promptText.length > 120 ? promptText.slice(0, 120) + '...' : promptText

  return (
    <div className="glass-surface rounded-xl overflow-hidden flex flex-col">
      {/* Video / Placeholder */}
      <div className="relative aspect-video bg-[var(--glass-bg-secondary)]">
        {hasVideo ? (
          <video
            src={panel.videoUrl!}
            controls
            preload="metadata"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {isGenerating ? (
              <div className="flex flex-col items-center gap-2">
                <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-[var(--glass-text-tertiary)]">
                  {t('smartRefStage.generating')}
                </span>
              </div>
            ) : (
              <AppIcon name="video" className="w-12 h-12 text-[var(--glass-text-quaternary)]" strokeWidth={1} />
            )}
          </div>
        )}
        {hasVideo && (
          <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-green-500/80 text-white text-[10px] font-medium">
            {t('smartRefStage.videoReady')}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3 flex flex-col gap-2 flex-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-[var(--glass-text-primary)]">
            {t('smartRefStage.panelLabel', { number: panel.panelNumber ?? panel.panelIndex + 1 })}
          </span>
          {panel.duration && (
            <span className="text-[10px] text-[var(--glass-text-tertiary)]">
              {panel.duration}{t('smartRefStage.durationUnit')}
            </span>
          )}
        </div>

        {/* Characters & Location */}
        <div className="flex flex-wrap gap-1">
          {characters.map((name) => (
            <span
              key={name}
              className="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/10 text-blue-400"
            >
              {name}
            </span>
          ))}
          {panel.location && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-400">
              {panel.location}
            </span>
          )}
        </div>

        {/* Video Prompt */}
        {promptText && (
          <div
            className="text-[11px] text-[var(--glass-text-secondary)] leading-relaxed cursor-pointer"
            onClick={() => setShowFullPrompt(!showFullPrompt)}
            title={promptText}
          >
            {showFullPrompt ? promptText : truncatedPrompt}
          </div>
        )}

        {/* Generate button */}
        <div className="mt-auto pt-2">
          <button
            onClick={() => onGenerate(panel.id)}
            disabled={isGenerating || !panel.videoPrompt}
            className="w-full px-3 py-1.5 rounded-lg text-xs font-medium transition-all
              bg-[var(--glass-bg-tertiary)] text-[var(--glass-text-primary)]
              hover:bg-[var(--glass-bg-quaternary)]
              disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isGenerating
              ? t('smartRefStage.generating')
              : hasVideo
                ? t('smartRefStage.regenerate')
                : t('smartRefStage.generate')}
          </button>
        </div>
      </div>
    </div>
  )
}

const SmartRefPanelCard = memo(SmartRefPanelCardInner)
export default SmartRefPanelCard
