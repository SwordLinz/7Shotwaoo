'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { GlassButton, GlassSurface } from '@/components/ui/primitives'
import type { ReferenceAsset } from '@/types/project'

interface ReferenceAssetSectionProps {
  projectId: string
}

export default function ReferenceAssetSection({ projectId }: ReferenceAssetSectionProps) {
  const t = useTranslations('assets.referenceAsset')
  const [assets, setAssets] = useState<ReferenceAsset[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchAssets = useCallback(async () => {
    try {
      const res = await fetch(`/api/novel-promotion/${projectId}/reference-assets`)
      if (res.ok) {
        const data = await res.json()
        setAssets(data.referenceAssets || [])
      }
    } catch {
      // silently fail
    } finally {
      setIsLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetchAssets()
  }, [fetchAssets])

  const handleDelete = useCallback(async (assetId: string) => {
    if (!confirm(t('deleteConfirm'))) return
    setDeletingId(assetId)
    try {
      const res = await fetch(`/api/novel-promotion/${projectId}/reference-assets/${assetId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setAssets((prev) => prev.filter((a) => a.id !== assetId))
      }
    } catch {
      // silently fail
    } finally {
      setDeletingId(null)
    }
  }, [projectId, t])

  const handleUpload = useCallback(async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return

      const reader = new FileReader()
      reader.onload = async () => {
        const dataUrl = reader.result as string
        try {
          const res = await fetch(`/api/novel-promotion/${projectId}/reference-assets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: file.name.replace(/\.[^/.]+$/, ''),
              imageUrl: dataUrl,
              sourceType: 'manual-upload',
            }),
          })
          if (res.ok) {
            fetchAssets()
          }
        } catch {
          // silently fail
        }
      }
      reader.readAsDataURL(file)
    }
    input.click()
  }, [projectId, fetchAssets])

  const sourceTypeBadge = (sourceType: string) => {
    const key = sourceType as 'pose-screenshot' | 'comfyui-output' | 'manual-upload'
    const colors: Record<string, string> = {
      'pose-screenshot': 'bg-orange-500/20 text-orange-400',
      'comfyui-output': 'bg-blue-500/20 text-blue-400',
      'manual-upload': 'bg-green-500/20 text-green-400',
    }
    return (
      <span className={`px-1.5 py-0.5 text-[10px] rounded-full ${colors[key] || 'bg-gray-500/20 text-gray-400'}`}>
        {t(`sourceType.${key}`)}
      </span>
    )
  }

  return (
    <GlassSurface variant="panel" className="space-y-4 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AppIcon name="image" className="w-5 h-5 text-[var(--glass-text-secondary)]" />
          <h3 className="text-base font-bold text-[var(--glass-text-primary)]">{t('title')}</h3>
          <span className="text-sm text-[var(--glass-text-tertiary)]">{t('count', { count: assets.length })}</span>
        </div>
        <GlassButton variant="primary" size="sm" onClick={handleUpload}>
          <AppIcon name="plus" className="w-4 h-4" />
          <span>{t('add')}</span>
        </GlassButton>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <AppIcon name="loader" className="w-5 h-5 animate-spin text-[var(--glass-text-tertiary)]" />
        </div>
      ) : assets.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-[var(--glass-text-tertiary)]">{t('noAssets')}</p>
          <p className="text-xs text-[var(--glass-text-tertiary)] mt-1">{t('noAssetsHint')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {assets.map((asset) => (
            <div
              key={asset.id}
              className="group relative rounded-lg border border-[var(--glass-stroke-base)] overflow-hidden bg-[var(--glass-bg-elevated)] hover:border-[var(--glass-stroke-hover)] transition-colors"
            >
              <div className="aspect-square relative">
                <img
                  src={asset.imageUrl}
                  alt={asset.name}
                  className="w-full h-full object-cover"
                />
                <div className="absolute top-1 left-1">
                  {sourceTypeBadge(asset.sourceType)}
                </div>
                <button
                  onClick={() => handleDelete(asset.id)}
                  disabled={deletingId === asset.id}
                  className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md bg-black/50 hover:bg-red-600/80 text-white"
                >
                  <AppIcon name="trash" className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="px-2 py-1.5">
                <p className="text-xs text-[var(--glass-text-primary)] truncate">{asset.name}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </GlassSurface>
  )
}
