import { describe, expect, it } from 'vitest'
import { createAudioGenerator, createImageGenerator, createVideoGenerator } from '@/lib/generators/factory'
import { ArkSeedanceVideoGenerator } from '@/lib/generators/ark'
import { GoogleVeoVideoGenerator } from '@/lib/generators/video/google'
import { OpenAICompatibleVideoGenerator } from '@/lib/generators/video/openai-compatible'
import { BailianAudioGenerator, BailianImageGenerator, BailianVideoGenerator, SiliconFlowAudioGenerator } from '@/lib/generators/official'

describe('generator factory', () => {
  it('routes gemini-compatible Seedance 2.0 to Ark video generator', () => {
    expect(createVideoGenerator('gemini-compatible:gm-1', 'doubao-seedance-2-0-260128')).toBeInstanceOf(
      ArkSeedanceVideoGenerator,
    )
  })

  it('routes gemini-compatible Veo to Google video generator', () => {
    const generator = createVideoGenerator('gemini-compatible:gm-1', 'veo-3.1-generate-preview')
    expect(generator).toBeInstanceOf(GoogleVeoVideoGenerator)
  })

  it('routes bailian official providers to official generators', () => {
    expect(createImageGenerator('bailian')).toBeInstanceOf(BailianImageGenerator)
    expect(createVideoGenerator('bailian')).toBeInstanceOf(BailianVideoGenerator)
    expect(createAudioGenerator('bailian')).toBeInstanceOf(BailianAudioGenerator)
  })

  it('routes siliconflow audio provider to official generator', () => {
    expect(createAudioGenerator('siliconflow')).toBeInstanceOf(SiliconFlowAudioGenerator)
  })

  it('routes niuniu (Volcengine Seedance 2) to Ark video generator', () => {
    expect(createVideoGenerator('niuniu')).toBeInstanceOf(ArkSeedanceVideoGenerator)
    expect(createVideoGenerator(' niuniu ')).toBeInstanceOf(ArkSeedanceVideoGenerator)
  })
})
