'use client'

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { NovelPromotionPanel } from '@/types/project'
import {
  composeSmartRefPanelVideoPrompt,
  smartRefVideoPromptMatchesComposed,
} from '@/lib/novel-promotion/smart-reference/compose-panel-video-prompt'
import { parsePanelCharactersStructured } from '@/lib/novel-promotion/smart-reference/smart-ref-panel-assets'

export interface SmartRefPanelSavePayload {
  shotType: string | null
  cameraMove: string | null
  description: string | null
  videoPrompt: string | null
  location: string | null
  characters: string | null
  duration: number | null
}

type SmartRefDraft = {
  shotType: string
  cameraMove: string
  description: string
  videoPrompt: string
  location: string
  /** 与面板 API 一致：JSON 字符串或 null，不经逗号分隔简化，以免丢失形象 */
  charactersJson: string | null
  duration: number | null
}

interface SmartRefPanelCardProps {
  panel: NovelPromotionPanel
  storyboardId: string
  isGenerating: boolean
  onGenerate: (panelId: string) => void
  onSave: (payload: SmartRefPanelSavePayload) => Promise<void>
  onOpenAssetPicker?: () => void
  t: (key: string, values?: Record<string, string | number | Date>) => string
}

function buildDraft(panel: NovelPromotionPanel): SmartRefDraft {
  return {
    shotType: panel.shotType ?? '',
    cameraMove: panel.cameraMove ?? '',
    description: panel.description ?? '',
    videoPrompt: panel.videoPrompt ?? '',
    location: panel.location ?? '',
    charactersJson: panel.characters,
    duration: panel.duration,
  }
}

function SmartRefPanelCardInner({
  panel,
  storyboardId: _storyboardId,
  isGenerating,
  onGenerate,
  onSave,
  onOpenAssetPicker,
  t,
}: SmartRefPanelCardProps) {
  const [expanded, setExpanded] = useState(true)
  const [draft, setDraft] = useState<SmartRefDraft>(() => buildDraft(panel))
  const [linkCameraToPrompt, setLinkCameraToPrompt] = useState(true)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const serverStamp = useMemo(
    () =>
      [
        panel.shotType,
        panel.cameraMove,
        panel.description,
        panel.videoPrompt,
        panel.location,
        panel.characters,
        panel.duration,
        panel.srtSegment,
      ].join('\x1e'),
    [
      panel.shotType,
      panel.cameraMove,
      panel.description,
      panel.videoPrompt,
      panel.location,
      panel.characters,
      panel.duration,
      panel.srtSegment,
    ],
  )

  useEffect(() => {
    const d = buildDraft(panel)
    setDraft(d)
    setLinkCameraToPrompt(
      smartRefVideoPromptMatchesComposed(panel.videoPrompt, {
        shotType: d.shotType,
        cameraMove: d.cameraMove,
        description: d.description,
      }),
    )
  }, [panel.id, serverStamp])

  const composedVideoPrompt = useMemo(
    () =>
      composeSmartRefPanelVideoPrompt({
        shotType: draft.shotType,
        cameraMove: draft.cameraMove,
        description: draft.description,
      }),
    [draft.shotType, draft.cameraMove, draft.description],
  )

  const effectiveVideoPrompt = linkCameraToPrompt ? composedVideoPrompt : draft.videoPrompt

  const hasVideo = !!panel.videoUrl

  const characterEntries = useMemo(
    () => parsePanelCharactersStructured(draft.charactersJson),
    [draft.charactersJson],
  )

  const handleSave = useCallback(async () => {
    setSaveError(null)
    if (draft.duration != null && (!Number.isFinite(draft.duration) || draft.duration <= 0)) {
      setSaveError(t('smartRefStage.invalidDuration'))
      return
    }
    const rawChar = draft.charactersJson?.trim()
    setSaving(true)
    try {
      const composed = composeSmartRefPanelVideoPrompt({
        shotType: draft.shotType,
        cameraMove: draft.cameraMove,
        description: draft.description,
      })
      await onSave({
        shotType: draft.shotType?.trim() || null,
        cameraMove: draft.cameraMove?.trim() || null,
        description: draft.description?.trim() || null,
        videoPrompt: (linkCameraToPrompt ? composed : draft.videoPrompt)?.trim() || null,
        location: draft.location?.trim() || null,
        characters: rawChar || null,
        duration: draft.duration,
      })
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : t('smartRefStage.saveFailed'))
    } finally {
      setSaving(false)
    }
  }, [draft, linkCameraToPrompt, onSave, t])

  const applyCameraToPrompt = useCallback(() => {
    const next = composeSmartRefPanelVideoPrompt({
      shotType: draft.shotType,
      cameraMove: draft.cameraMove,
      description: draft.description,
    })
    setLinkCameraToPrompt(true)
    setDraft((d) => ({ ...d, videoPrompt: next }))
  }, [draft.shotType, draft.cameraMove, draft.description])

  return (
    <div className="glass-surface relative overflow-hidden flex flex-col group hover:border-[var(--glass-tone-info-fg)]/35 transition-colors duration-300">
      <div className="absolute inset-0 rounded-[inherit] bg-gradient-to-br from-blue-500/0 to-cyan-500/0 group-hover:from-blue-500/[0.06] group-hover:to-cyan-500/[0.04] transition-all duration-300 pointer-events-none z-0" />
      <div className="relative z-10 aspect-video bg-[var(--glass-bg-muted)] shrink-0">
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
                <div
                  className="w-9 h-9 border-2 border-[var(--glass-tone-info-fg)] border-t-transparent rounded-full animate-spin"
                  aria-hidden
                />
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
          <div className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-[var(--glass-radius-md)] bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)] text-[10px] font-semibold border border-[var(--glass-tone-info-fg)]/25">
            {t('smartRefStage.videoReady')}
          </div>
        )}
      </div>

      <div className="relative z-10 p-4 flex flex-col gap-3 flex-1 min-h-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-[var(--glass-text-primary)]">
            {t('smartRefStage.panelLabel', { number: panel.panelNumber ?? panel.panelIndex + 1 })}
          </span>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="glass-btn-base glass-btn-ghost text-xs py-1 px-2 shrink-0"
          >
            {expanded ? t('smartRefStage.collapseDetail') : t('smartRefStage.expandDetail')}
          </button>
        </div>

        {expanded ? (
          <div className="space-y-3 max-h-[min(420px,55vh)] overflow-y-auto pr-0.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-[var(--glass-text-tertiary)] mb-1">
                  {t('smartRefStage.shotType')}
                </label>
                <input
                  type="text"
                  value={draft.shotType ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, shotType: e.target.value }))}
                  className="glass-input-base w-full px-2.5 py-1.5 text-xs"
                  placeholder={t('smartRefStage.shotTypePlaceholder')}
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[var(--glass-text-tertiary)] mb-1">
                  {t('smartRefStage.cameraMove')}
                </label>
                <input
                  type="text"
                  value={draft.cameraMove ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, cameraMove: e.target.value }))}
                  className="glass-input-base w-full px-2.5 py-1.5 text-xs"
                  placeholder={t('smartRefStage.cameraMovePlaceholder')}
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[var(--glass-text-tertiary)] mb-1">
                {t('smartRefStage.durationLabel')} ({t('smartRefStage.durationUnit')})
              </label>
              <input
                type="number"
                min={1}
                value={draft.duration ?? ''}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    duration: e.target.value === '' ? null : Number.parseInt(e.target.value, 10) || null,
                  }))
                }
                className="glass-input-base w-full px-2.5 py-1.5 text-xs max-w-[120px]"
              />
            </div>

            {panel.srtSegment ? (
              <div>
                <label className="block text-[11px] font-medium text-[var(--glass-text-tertiary)] mb-1">
                  {t('smartRefStage.sourceText')}
                </label>
                <div className="text-xs text-[var(--glass-text-secondary)] leading-relaxed px-2.5 py-2 rounded-[var(--glass-radius-md)] bg-[var(--glass-bg-muted)] border border-[var(--glass-stroke-base)]">
                  <span className="italic">&quot;{panel.srtSegment}&quot;</span>
                </div>
              </div>
            ) : null}

            <div>
              <label className="block text-[11px] font-medium text-[var(--glass-text-tertiary)] mb-1">
                {t('smartRefStage.sceneDescription')}
              </label>
              <textarea
                value={draft.description ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                rows={3}
                className="glass-textarea-base w-full px-2.5 py-2 text-xs resize-y min-h-[4.5rem]"
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[11px] font-medium text-[var(--glass-text-tertiary)]">
                  {t('smartRefStage.videoPromptLabel')}
                </label>
                <label className="inline-flex items-center gap-1.5 text-[10px] text-[var(--glass-text-tertiary)] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="rounded border-[var(--glass-stroke-strong)]"
                    checked={linkCameraToPrompt}
                    onChange={(e) => {
                      const on = e.target.checked
                      if (on) {
                        applyCameraToPrompt()
                      } else {
                        setDraft((d) => ({
                          ...d,
                          videoPrompt: composeSmartRefPanelVideoPrompt({
                            shotType: d.shotType,
                            cameraMove: d.cameraMove,
                            description: d.description,
                          }),
                        }))
                        setLinkCameraToPrompt(false)
                      }
                    }}
                  />
                  {t('smartRefStage.syncPromptWithCamera')}
                </label>
                <button
                  type="button"
                  onClick={applyCameraToPrompt}
                  className="glass-btn-base glass-btn-ghost text-[10px] py-0.5 px-1.5"
                >
                  {t('smartRefStage.applyCameraToPrompt')}
                </button>
              </div>
              <textarea
                value={effectiveVideoPrompt}
                onChange={(e) => {
                  setLinkCameraToPrompt(false)
                  setDraft((d) => ({ ...d, videoPrompt: e.target.value }))
                }}
                rows={3}
                className="glass-textarea-base w-full px-2.5 py-2 text-xs resize-y min-h-[4.5rem] bg-[var(--glass-tone-warning-bg)]/40"
                placeholder={t('smartRefStage.videoPromptPlaceholder')}
              />
              {!linkCameraToPrompt ? (
                <p className="text-[10px] text-[var(--glass-text-tertiary)]">{t('smartRefStage.promptDetachedHint')}</p>
              ) : (
                <p className="text-[10px] text-[var(--glass-text-tertiary)]">{t('smartRefStage.videoPromptHint')}</p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="text-[11px] font-medium text-[var(--glass-text-tertiary)]">
                  {t('smartRefStage.locationLabel')}
                </label>
                {onOpenAssetPicker ? (
                  <button
                    type="button"
                    onClick={onOpenAssetPicker}
                    className="glass-btn-base glass-btn-ghost p-1 rounded-[var(--glass-radius-md)] shrink-0"
                    title={t('smartRefStage.pickAssets')}
                    aria-label={t('smartRefStage.pickAssets')}
                  >
                    <AppIcon name="edit" className="w-3.5 h-3.5" />
                  </button>
                ) : null}
              </div>
              {draft.location?.trim() ? (
                <span className="inline-flex px-2 py-0.5 rounded-[var(--glass-radius-md)] text-[10px] font-medium bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)]">
                  {draft.location.trim()}
                </span>
              ) : (
                <p className="text-[10px] text-[var(--glass-text-quaternary)]">{t('smartRefStage.noScenePicked')}</p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="text-[11px] font-medium text-[var(--glass-text-tertiary)]">
                  {t('smartRefStage.charactersLabel')}
                </label>
                {onOpenAssetPicker ? (
                  <button
                    type="button"
                    onClick={onOpenAssetPicker}
                    className="glass-btn-base glass-btn-ghost p-1 rounded-[var(--glass-radius-md)] shrink-0"
                    title={t('smartRefStage.pickAssets')}
                    aria-label={t('smartRefStage.pickAssets')}
                  >
                    <AppIcon name="edit" className="w-3.5 h-3.5" />
                  </button>
                ) : null}
              </div>
              {characterEntries.length > 0 ? (
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {characterEntries.map((e) => (
                    <span
                      key={`${e.name}-${e.appearance}`}
                      className="px-2 py-0.5 rounded-[var(--glass-radius-md)] text-[10px] font-medium bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)]"
                    >
                      {e.name}({e.appearance})
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-[var(--glass-text-quaternary)]">{t('smartRefStage.noCharactersPicked')}</p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-xs text-[var(--glass-text-tertiary)]">
            {(effectiveVideoPrompt || draft.description || '').slice(0, 80)}
            {(effectiveVideoPrompt || draft.description || '').length > 80 ? '…' : ''}
          </p>
        )}

        {saveError ? (
          <p className="text-[11px] text-[var(--glass-tone-danger-fg)]">{saveError}</p>
        ) : null}

        <div className="mt-auto pt-1 flex flex-col gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || isGenerating}
            className="glass-btn-base glass-btn-secondary w-full py-2 text-xs disabled:opacity-50"
          >
            {saving ? t('smartRefStage.saving') : t('smartRefStage.saveChanges')}
          </button>
          <button
            type="button"
            onClick={() => onGenerate(panel.id)}
            disabled={isGenerating || !(effectiveVideoPrompt || '').trim()}
            className="glass-btn-base glass-btn-soft w-full py-2 text-xs disabled:opacity-50"
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
