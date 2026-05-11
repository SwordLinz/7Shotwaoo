'use client'

import { useCallback, useState } from 'react'
import { useTranslations } from 'next-intl'
import { shouldShowError } from '@/lib/error-utils'
import {
  useAiCreateProjectCharacter,
  useAiDesignCharacter,
  useCreateAssetHubCharacter,
  useCreateProjectCharacter,
  useGenerateCharacterImage,
  useGenerateProjectCharacterImage,
  useCreateProjectCharacterAppearance,
  useExtractAssetHubReferenceCharacterDescription,
  useExtractProjectReferenceCharacterDescription,
  useUploadAssetHubTempMedia,
  useUploadProjectTempMedia,
} from '@/lib/query/hooks'
import { useImageGenerationCount } from '@/lib/image-generation/use-image-generation-count'

type Mode = 'asset-hub' | 'project'

interface UseCharacterCreationSubmitParams {
  mode: Mode
  folderId?: string | null
  projectId?: string
  name: string
  description: string
  aiInstruction: string
  artStyle: string
  descriptionReferenceImagesBase64: string[]
  referenceModeImagesBase64: string[]
  referenceSubMode: 'direct' | 'extract'
  isSubAppearance: boolean
  selectedCharacterId: string
  changeReason: string
  createMode: 'reference' | 'description'
  setDescription: (value: string) => void
  setAiInstruction: (value: string) => void
  onSuccess: () => void
  onClose: () => void
}

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export function useCharacterCreationSubmit({
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
}: UseCharacterCreationSubmitParams) {
  const t = useTranslations('assetModal')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isAiDesigning, setIsAiDesigning] = useState(false)
  const [isExtracting, setIsExtracting] = useState(false)

  const uploadAssetHubTemp = useUploadAssetHubTempMedia()
  const uploadProjectTemp = useUploadProjectTempMedia()
  const aiDesignAssetHubCharacter = useAiDesignCharacter()
  const aiCreateProjectCharacter = useAiCreateProjectCharacter(projectId ?? '')
  const extractAssetHubDescription = useExtractAssetHubReferenceCharacterDescription()
  const extractProjectDescription = useExtractProjectReferenceCharacterDescription(projectId ?? '')
  const createAssetHubCharacter = useCreateAssetHubCharacter()
  const createProjectCharacter = useCreateProjectCharacter(projectId ?? '')
  const generateAssetHubCharacterImage = useGenerateCharacterImage()
  const generateProjectCharacterImage = useGenerateProjectCharacterImage(projectId ?? '')
  const createProjectAppearance = useCreateProjectCharacterAppearance(projectId ?? '')
  const {
    count: characterGenerationCount,
    setCount: setCharacterGenerationCount,
  } = useImageGenerationCount('character')
  const {
    count: referenceCharacterGenerationCount,
    setCount: setReferenceCharacterGenerationCount,
  } = useImageGenerationCount('reference-to-character')

  type CreatedCharacterResponse = {
    character?: {
      id: string
      appearances?: Array<{
        id: string
        appearanceIndex: number
      }>
    }
  }

  const uploadImages = useCallback(async (imagesBase64: string[]) => {
    const uploadMutation = mode === 'asset-hub' ? uploadAssetHubTemp : uploadProjectTemp
    return Promise.all(
      imagesBase64.map(async (base64) => {
        const data = await uploadMutation.mutateAsync({ imageBase64: base64 })
        if (!data.url) throw new Error(t('errors.uploadFailed'))
        return data.url
      }),
    )
  }, [mode, t, uploadAssetHubTemp, uploadProjectTemp])

  const uploadDescriptionReferenceImages = useCallback(async () => (
    await uploadImages(descriptionReferenceImagesBase64)
  ), [descriptionReferenceImagesBase64, uploadImages])

  const uploadReferenceModeImages = useCallback(async () => (
    await uploadImages(referenceModeImagesBase64)
  ), [referenceModeImagesBase64, uploadImages])

  const handleExtractDescription = useCallback(async () => {
    const referenceImageUrls = mode === 'asset-hub'
      ? descriptionReferenceImagesBase64
      : referenceModeImagesBase64
    if (referenceImageUrls.length === 0) return

    try {
      setIsExtracting(true)
      const uploadedReferenceImageUrls = mode === 'asset-hub'
        ? await uploadDescriptionReferenceImages()
        : await uploadReferenceModeImages()
      const result = mode === 'asset-hub'
        ? await extractAssetHubDescription.mutateAsync(uploadedReferenceImageUrls)
        : await extractProjectDescription.mutateAsync(uploadedReferenceImageUrls)
      if (result?.description) {
        setDescription(result.description)
      }
    } catch (error: unknown) {
      if (shouldShowError(error)) {
        alert(getErrorMessage(error, t('errors.extractDescriptionFailed')))
      }
    } finally {
      setIsExtracting(false)
    }
  }, [
    descriptionReferenceImagesBase64,
    extractAssetHubDescription,
    extractProjectDescription,
    mode,
    referenceModeImagesBase64,
    setDescription,
    t,
    uploadDescriptionReferenceImages,
    uploadReferenceModeImages,
  ])

  const handleCreateWithReference = useCallback(async () => {
    if (!name.trim() || referenceModeImagesBase64.length === 0) return

    try {
      setIsSubmitting(true)
      const referenceImageUrls = await uploadReferenceModeImages()

      let finalDescription = description.trim()
      if (referenceSubMode === 'extract') {
        const result = mode === 'asset-hub'
          ? await extractAssetHubDescription.mutateAsync(referenceImageUrls)
          : await extractProjectDescription.mutateAsync(referenceImageUrls)
        finalDescription = result?.description || finalDescription
      }

      if (mode === 'asset-hub') {
        await createAssetHubCharacter.mutateAsync({
          name: name.trim(),
          description: finalDescription || t('character.defaultDescription', { name: name.trim() }),
          folderId: folderId ?? null,
          artStyle,
          generateFromReference: true,
          referenceImageUrls,
          customDescription: referenceSubMode === 'extract' ? finalDescription : undefined,
          count: referenceCharacterGenerationCount,
        })
      } else {
        await createProjectCharacter.mutateAsync({
          name: name.trim(),
          description: finalDescription || t('character.defaultDescription', { name: name.trim() }),
          generateFromReference: true,
          referenceImageUrls,
          customDescription: referenceSubMode === 'extract' ? finalDescription : undefined,
          count: referenceCharacterGenerationCount,
        })
      }

      onSuccess()
      onClose()
    } catch (error: unknown) {
      if (shouldShowError(error)) {
        alert(getErrorMessage(error, t('errors.createFailed')))
      }
    } finally {
      setIsSubmitting(false)
    }
  }, [
    artStyle,
    createAssetHubCharacter,
    createProjectCharacter,
    description,
    extractAssetHubDescription,
    extractProjectDescription,
    folderId,
    mode,
    name,
    onClose,
    onSuccess,
    referenceCharacterGenerationCount,
    referenceModeImagesBase64.length,
    referenceSubMode,
    t,
    uploadReferenceModeImages,
  ])

  const handleAiDesign = useCallback(async () => {
    if (!aiInstruction.trim()) return

    try {
      setIsAiDesigning(true)
      const result = mode === 'asset-hub'
        ? await aiDesignAssetHubCharacter.mutateAsync(aiInstruction)
        : await aiCreateProjectCharacter.mutateAsync({ userInstruction: aiInstruction })

      if (result?.prompt) {
        setDescription(result.prompt)
        setAiInstruction('')
      }
    } catch (error: unknown) {
      if (shouldShowError(error)) {
        alert(getErrorMessage(error, t('errors.aiDesignFailed')))
      }
    } finally {
      setIsAiDesigning(false)
    }
  }, [aiCreateProjectCharacter, aiDesignAssetHubCharacter, aiInstruction, mode, setAiInstruction, setDescription, t])

  const handleSubmit = useCallback(async () => {
    if (isSubAppearance) {
      if (!selectedCharacterId.trim() || !changeReason.trim() || !description.trim()) return
      try {
        setIsSubmitting(true)
        await createProjectAppearance.mutateAsync({
          characterId: selectedCharacterId,
          changeReason: changeReason.trim(),
          description: description.trim(),
        })
        onSuccess()
        onClose()
      } catch (error: unknown) {
        if (shouldShowError(error)) {
          alert(getErrorMessage(error, t('errors.addSubAppearanceFailed')))
        }
      } finally {
        setIsSubmitting(false)
      }
      return
    }

    const isAssetHubThreeViewSave = mode === 'asset-hub' && createMode === 'reference'
    if (!name.trim()) return
    if (!isAssetHubThreeViewSave && !description.trim()) return
    if (isAssetHubThreeViewSave && referenceModeImagesBase64.length === 0) return

    try {
      setIsSubmitting(true)
      if (mode === 'asset-hub') {
        const payload: {
          name: string
          description: string
          folderId?: string | null
          artStyle: string
          initialImageUrls?: string[]
        } = {
          name: name.trim(),
          description: description.trim() || t('character.defaultDescription', { name: name.trim() }),
          folderId: folderId ?? null,
          artStyle,
        }
        if (isAssetHubThreeViewSave) {
          payload.initialImageUrls = await uploadReferenceModeImages()
        }
        await createAssetHubCharacter.mutateAsync(payload)
      } else {
        await createProjectCharacter.mutateAsync({
          name: name.trim(),
          description: description.trim(),
        })
      }
      onSuccess()
      onClose()
    } catch (error: unknown) {
      if (shouldShowError(error)) {
        alert(getErrorMessage(error, t('errors.createFailed')))
      }
    } finally {
      setIsSubmitting(false)
    }
  }, [
    artStyle,
    changeReason,
    createAssetHubCharacter,
    createMode,
    createProjectAppearance,
    createProjectCharacter,
    description,
    folderId,
    isSubAppearance,
    mode,
    name,
    onClose,
    onSuccess,
    referenceModeImagesBase64.length,
    selectedCharacterId,
    t,
    uploadReferenceModeImages,
  ])

  const handleSubmitAndGenerate = useCallback(async () => {
    if (isSubAppearance) {
      await handleSubmit()
      return
    }

    const hasDescriptionReferences = mode === 'asset-hub' && descriptionReferenceImagesBase64.length > 0
    if (!name.trim() || (!description.trim() && !hasDescriptionReferences)) return

    try {
      setIsSubmitting(true)

      if (mode === 'asset-hub' && hasDescriptionReferences) {
        const referenceImageUrls = await uploadDescriptionReferenceImages()
        let finalDescription = description.trim()
        if (referenceSubMode === 'extract') {
          const result = await extractAssetHubDescription.mutateAsync(referenceImageUrls)
          finalDescription = result?.description || finalDescription
        }

        await createAssetHubCharacter.mutateAsync({
          name: name.trim(),
          description: finalDescription || t('character.defaultDescription', { name: name.trim() }),
          folderId: folderId ?? null,
          artStyle,
          generateFromReference: true,
          referenceImageUrls,
          customDescription: finalDescription || undefined,
          useReferenceImagesWithCustomDescription: Boolean(finalDescription),
          count: characterGenerationCount,
        })

        onSuccess()
        onClose()
        return
      }

      if (mode === 'asset-hub') {
        const result = await createAssetHubCharacter.mutateAsync({
          name: name.trim(),
          description: description.trim(),
          folderId: folderId ?? null,
          artStyle,
        }) as CreatedCharacterResponse
        const createdCharacterId = result.character?.id
        const createdAppearanceIndex = result.character?.appearances?.[0]?.appearanceIndex
        if (!createdCharacterId || createdAppearanceIndex === undefined) {
          throw new Error(t('errors.createFailed'))
        }
        await generateAssetHubCharacterImage.mutateAsync({
          characterId: createdCharacterId,
          appearanceIndex: createdAppearanceIndex,
          artStyle,
          count: characterGenerationCount,
        })
      } else {
        const result = await createProjectCharacter.mutateAsync({
          name: name.trim(),
          description: description.trim(),
        }) as CreatedCharacterResponse
        const createdCharacterId = result.character?.id
        const createdAppearanceId = result.character?.appearances?.[0]?.id
        if (!createdCharacterId || !createdAppearanceId) {
          throw new Error(t('errors.createFailed'))
        }
        await generateProjectCharacterImage.mutateAsync({
          characterId: createdCharacterId,
          appearanceId: createdAppearanceId,
          count: characterGenerationCount,
        })
      }

      onSuccess()
      onClose()
    } catch (error: unknown) {
      if (shouldShowError(error)) {
        alert(getErrorMessage(error, t('errors.createFailed')))
      }
    } finally {
      setIsSubmitting(false)
    }
  }, [
    artStyle,
    characterGenerationCount,
    createAssetHubCharacter,
    createProjectCharacter,
    description,
    descriptionReferenceImagesBase64.length,
    extractAssetHubDescription,
    folderId,
    generateAssetHubCharacterImage,
    generateProjectCharacterImage,
    handleSubmit,
    isSubAppearance,
    mode,
    name,
    onClose,
    onSuccess,
    referenceSubMode,
    t,
    uploadDescriptionReferenceImages,
  ])

  return {
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
  }
}
