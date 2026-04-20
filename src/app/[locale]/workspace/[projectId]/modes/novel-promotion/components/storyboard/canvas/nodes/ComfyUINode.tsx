'use client'

import { memo, useState, useCallback } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useTranslations } from 'next-intl'

function ComfyUINodeInner({ data, id }: NodeProps) {
  const t = useTranslations('storyboard.nodeCanvas.comfyNode')
  const [workflowPath, setWorkflowPath] = useState('')
  const [isExecuting, setIsExecuting] = useState(false)
  const [outputUrl, setOutputUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleExecute = useCallback(async () => {
    if (!workflowPath.trim()) return
    setIsExecuting(true)
    setError(null)
    try {
      const res = await fetch('/api/comfyui/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowPath: workflowPath.trim() }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { prompt_id } = await res.json()

      let attempts = 0
      const maxAttempts = 120
      while (attempts < maxAttempts) {
        await new Promise((r) => setTimeout(r, 2000))
        const histRes = await fetch(`/api/comfyui/history/${prompt_id}`)
        if (!histRes.ok) { attempts++; continue }
        const hist = await histRes.json()
        if (hist.status === 'completed' && hist.outputUrl) {
          setOutputUrl(hist.outputUrl)
          break
        }
        if (hist.status === 'failed') {
          throw new Error(hist.error || 'Execution failed')
        }
        attempts++
      }
      if (attempts >= maxAttempts) throw new Error('Timeout')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsExecuting(false)
    }
  }, [workflowPath])

  const handleSaveAsReference = useCallback(async () => {
    if (!outputUrl) return
    try {
      const projectId = (data as { projectId?: string })?.projectId
      if (!projectId) return
      await fetch(`/api/novel-promotion/${projectId}/reference-assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `ComfyUI Output ${new Date().toLocaleString()}`,
          imageUrl: outputUrl,
          sourceType: 'comfyui-output',
        }),
      })
    } catch {
      // silently fail for now
    }
  }, [outputUrl, data])

  return (
    <div className="glass-surface-elevated min-w-[320px]">
      <Handle type="target" position={Position.Left} className="!bg-[var(--glass-tone-info-fg)]" />

      <div className="px-3 py-2 border-b border-[var(--glass-stroke-soft)] rounded-t-[var(--glass-radius-lg)] bg-[var(--glass-tone-info-bg)]">
        <span className="text-xs font-semibold text-[var(--glass-tone-info-fg)]">{t('title')}</span>
      </div>

      <div className="p-3 space-y-3">
        <div>
          <label className="glass-field-hint mb-1 block">{t('workflowPath')}</label>
          <input
            type="text"
            value={workflowPath}
            onChange={(e) => setWorkflowPath(e.target.value)}
            placeholder={t('workflowPlaceholder')}
            className="glass-input-base px-2.5 py-1.5 text-xs"
          />
        </div>

        <button
          onClick={handleExecute}
          disabled={isExecuting || !workflowPath.trim()}
          className="glass-btn-base glass-btn-primary w-full h-8 text-xs"
        >
          {isExecuting ? t('executing') : t('execute')}
        </button>

        {error && (
          <p className="text-xs text-[var(--glass-tone-danger-fg)]">{t('executeFailed', { error })}</p>
        )}

        {outputUrl && (
          <div className="space-y-2">
            <label className="glass-field-hint">{t('output')}</label>
            <img src={outputUrl} alt="output" className="w-full rounded-[var(--glass-radius-sm)] border border-[var(--glass-stroke-soft)]" />
            <button
              onClick={handleSaveAsReference}
              className="glass-btn-base glass-btn-ghost w-full h-7 text-xs"
            >
              {t('saveAsReference')}
            </button>
          </div>
        )}

        {!outputUrl && !error && !isExecuting && (
          <p className="text-xs text-[var(--glass-text-tertiary)] text-center py-2">{t('noOutput')}</p>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="!bg-[var(--glass-tone-info-fg)]" />
    </div>
  )
}

export default memo(ComfyUINodeInner)
