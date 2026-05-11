'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, MouseEvent } from 'react'
import { useTranslations } from 'next-intl'
import { useProjectAssets } from '@/lib/query/hooks'
import CharacterCreationForm from './character-creation/CharacterCreationForm'
import { useCharacterCreationSubmit } from './character-creation/hooks/useCharacterCreationSubmit'
import { AppIcon } from '@/components/ui/icons'
import ImageGenerationInlineCountButton from '@/components/image-generation/ImageGenerationInlineCountButton'
import { getImageGenerationCountOptions } from '@/lib/image-generation/count'

export interface CharacterCreationModalProps {
  mode: 'asset-hub' | 'project'
  folderId?: string | null
  projectId?: string
  onClose: () => void
  onSuccess: () => void
}

type UploadTarget = 'description-reference' | 'reference-mode'

const XMarkIcon = ({ className }: { className?: string }) => (
  <AppIcon name="close" className={className} />
)

export function CharacterCreationModal({
  mode,
  folderId,
  projectId,
  onClose,
  onSuccess,
}: CharacterCreationModalProps) {
  const t = useTranslations('assetModal')

  const [createMode, setCreateMode] = useState<'reference' | 'description'>('description')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [aiInstruction, setAiInstruction] = useState('')
  const [artStyle, setArtStyle] = useState('american-comic')
  const [descriptionReferenceImagesBase64, setDescriptionReferenceImagesBase64] = useState<string[]>([])
  const [referenceModeImagesBase64, setReferenceModeImagesBase64] = useState<string[]>([])
  const [referenceSubMode, setReferenceSubMode] = useState<'direct' | 'extract'>('direct')
  const [isSubAppearance, setIsSubAppearance] = useState(false)
  const [selectedCharacterId, setSelectedCharacterId] = useState('')
  const [changeReason, setChangeReason] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)

  const projectAssets = useProjectAssets(mode === 'project' ? (projectId ?? null) : null)
  const availableCharacters = useMemo(() => {
    if (mode !== 'project') return []
    const items = projectAssets.data?.characters || []
    return items.map((c) => ({
      id: c.id,
      name: c.name,
      appearances: c.appearances || [],
    }))
  }, [mode, projectAssets.data?.characters])

  const {
    isSubmitting,
    isAiDesigning,
    isExtracting,
    characterGenerationCount,
    setCharacterGenerationCount,
    referenceCharacterGenerationCount,
    setReferenceCharacterGenerationCount,
    handleExtractDescription,
    handleCreateWithReference,
    handleAiDesign,
    handleSubmit,
    handleSubmitAndGenerate,
  } = useCharacterCreationSubmit({
    mode,
    folderId,
    projectId,
    name,
    description,
    aiInstruction,
    artStyle,
    descriptionReferenceImagesBase64,
    referenceModeImagesBase64,
    referenceSubMode,
    isSubAppearance,
    selectedCharacterId,
    changeReason,
    createMode,
    setDescription,
    setAiInstruction,
    onSuccess,
    onClose,
  })

  const getTargetLimit = useCallback((target: UploadTarget) => {
    if (target === 'reference-mode' && mode === 'asset-hub') return 3
    return 5
  }, [mode])

  const handleFileSelect = useCallback(async (files: FileList | File[], target: UploadTarget) => {
    const fileArray = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (fileArray.length === 0) return

    const currentImages = target === 'description-reference'
      ? descriptionReferenceImagesBase64
      : referenceModeImagesBase64
    const maxCount = getTargetLimit(target)
    const remaining = maxCount - currentImages.length
    if (remaining <= 0) return

    const toAdd = fileArray.slice(0, remaining)
    const setImages = target === 'description-reference'
      ? setDescriptionReferenceImagesBase64
      : setReferenceModeImagesBase64

    for (const file of toAdd) {
      const reader = new FileReader()
      reader.onload = (e) => {
        const base64 = e.target?.result as string
        setImages((prev) => {
          if (prev.length >= maxCount) return prev
          if (prev.includes(base64)) return prev
          return [...prev, base64]
        })
      }
      reader.readAsDataURL(file)
    }
  }, [
    descriptionReferenceImagesBase64,
    getTargetLimit,
    referenceModeImagesBase64,
  ])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting && !isAiDesigning) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isAiDesigning, isSubmitting, onClose])

  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      const targetUploadMode: UploadTarget | null = mode === 'asset-hub'
        ? (createMode === 'description' ? 'description-reference' : createMode === 'reference' ? 'reference-mode' : null)
        : (createMode === 'reference' ? 'reference-mode' : null)
      if (!targetUploadMode) return

      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

      const items = e.clipboardData?.items
      if (!items) return

      for (let i = 0; i < items.length; i++) {
        if (!items[i].type.startsWith('image/')) continue
        const file = items[i].getAsFile()
        if (!file) continue
        e.preventDefault()
        void handleFileSelect([file], targetUploadMode)
        break
      }
    }

    document.addEventListener('paste', handleGlobalPaste)
    return () => document.removeEventListener('paste', handleGlobalPaste)
  }, [createMode, handleFileSelect, mode])

  const createDropHandler = useCallback((target: UploadTarget) => (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.files.length > 0) {
      void handleFileSelect(e.dataTransfer.files, target)
    }
  }, [handleFileSelect])

  const handleClearImages = useCallback((target: UploadTarget, index?: number) => {
    const setImages = target === 'description-reference'
      ? setDescriptionReferenceImagesBase64
      : setReferenceModeImagesBase64
    if (typeof index === 'number') {
      setImages((prev) => prev.filter((_, i) => i !== index))
      return
    }
    setImages([])
  }, [])

  const handleBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !isSubmitting && !isAiDesigning) {
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 glass-overlay flex items-center justify-center z-50 p-4"
      onClick={handleBackdropClick}
    >
      <div className="glass-surface-modal max-w-lg w-full max-h-[85vh] flex flex-col">
        <div className="p-6 overflow-y-auto flex-1">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-[var(--glass-text-primary)]">
              {t('character.title')}
            </h3>
            <button
              onClick={onClose}
              className="glass-btn-base glass-btn-soft w-8 h-8 rounded-full flex items-center justify-center text-[var(--glass-text-tertiary)]"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>

          <CharacterCreationForm
            mode={mode}
            createMode={createMode}
            setCreateMode={(value) => setCreateMode(value)}
            name={name}
            setName={(value) => setName(value)}
            description={description}
            setDescription={(value) => setDescription(value)}
            aiInstruction={aiInstruction}
            setAiInstruction={(value) => setAiInstruction(value)}
            artStyle={artStyle}
            setArtStyle={(value) => setArtStyle(value)}
            descriptionReferenceImagesBase64={descriptionReferenceImagesBase64}
            referenceModeImagesBase64={referenceModeImagesBase64}
            referenceSubMode={referenceSubMode}
            setReferenceSubMode={(value) => setReferenceSubMode(value)}
            isSubAppearance={isSubAppearance}
            setIsSubAppearance={(value) => setIsSubAppearance(value)}
            selectedCharacterId={selectedCharacterId}
            setSelectedCharacterId={(value) => setSelectedCharacterId(value)}
            changeReason={changeReason}
            setChangeReason={(value) => setChangeReason(value)}
            availableCharacters={availableCharacters}
            fileInputRef={fileInputRef}
            handleDescriptionReferenceDrop={createDropHandler('description-reference')}
            handleReferenceModeDrop={createDropHandler('reference-mode')}
            handleDescriptionReferenceFileSelect={(files) => { void handleFileSelect(files, 'description-reference') }}
            handleReferenceModeFileSelect={(files) => { void handleFileSelect(files, 'reference-mode') }}
            handleClearDescriptionReference={(index) => handleClearImages('description-reference', index)}
            handleClearReferenceModeImage={(index) => handleClearImages('reference-mode', index)}
            handleExtractDescription={() => { void handleExtractDescription() }}
            handleAiDesign={() => { void handleAiDesign() }}
            isSubmitting={isSubmitting}
            isAiDesigning={isAiDesigning}
            isExtracting={isExtracting}
          />
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-strong)] rounded-b-xl flex-shrink-0">
          <button
            onClick={onClose}
            className="glass-btn-base glass-btn-secondary px-4 py-2 rounded-lg text-sm"
            disabled={isSubmitting}
          >
            {t('common.cancel')}
          </button>
          {createMode === 'reference' && mode === 'asset-hub' ? (
            <button
              onClick={() => { void handleSubmit() }}
              disabled={isSubmitting || !name.trim() || referenceModeImagesBase64.length === 0}
              className="glass-btn-base glass-btn-primary px-4 py-2 rounded-lg text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSubmitting ? t('common.adding') : t('common.addOnlyToAssetHub')}
            </button>
          ) : createMode === 'reference' ? (
            <ImageGenerationInlineCountButton
              prefix={<span>{t('character.useReferenceGeneratePrefix')}</span>}
              suffix={<span>{t('character.generateCountSuffix')}</span>}
              value={referenceCharacterGenerationCount}
              options={getImageGenerationCountOptions('reference-to-character')}
              onValueChange={setReferenceCharacterGenerationCount}
              onClick={() => { void handleCreateWithReference() }}
              actionDisabled={!name.trim() || referenceModeImagesBase64.length === 0}
              selectDisabled={isSubmitting}
              ariaLabel={t('character.selectReferenceGenerateCount')}
              className="glass-btn-base glass-btn-primary flex items-center justify-center gap-1 rounded-lg px-4 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              selectClassName="appearance-none bg-transparent border-0 pl-0 pr-3 text-sm font-semibold text-current outline-none cursor-pointer leading-none transition-colors"
            />
          ) : isSubAppearance ? (
            <button
              onClick={() => { void handleSubmit() }}
              disabled={isSubmitting || !selectedCharacterId.trim() || !changeReason.trim() || !description.trim()}
              className="glass-btn-base glass-btn-primary px-4 py-2 rounded-lg text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSubmitting ? t('common.adding') : t('common.add')}
            </button>
          ) : (
            <>
              <button
                onClick={() => { void handleSubmit() }}
                disabled={isSubmitting || !name.trim() || !description.trim()}
                className="glass-btn-base glass-btn-secondary px-4 py-2 rounded-lg text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isSubmitting ? t('common.adding') : (mode === 'asset-hub' ? t('common.addOnlyToAssetHub') : t('common.addOnly'))}
              </button>
              <ImageGenerationInlineCountButton
                prefix={<span>{t('common.addAndGeneratePrefix')}</span>}
                suffix={<span>{t('common.generateCountSuffix')}</span>}
                value={characterGenerationCount}
                options={getImageGenerationCountOptions('character')}
                onValueChange={setCharacterGenerationCount}
                onClick={() => { void handleSubmitAndGenerate() }}
                actionDisabled={!name.trim() || (!description.trim() && descriptionReferenceImagesBase64.length === 0)}
                selectDisabled={isSubmitting}
                ariaLabel={t('common.selectGenerateCount')}
                className="glass-btn-base glass-btn-primary flex items-center justify-center gap-1 rounded-lg px-4 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                selectClassName="appearance-none bg-transparent border-0 pl-0 pr-3 text-sm font-semibold text-current outline-none cursor-pointer leading-none transition-colors"
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
