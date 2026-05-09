import { arkCreateVideoTask, arkQueryVideoTask, resolveArkOpenApiV3BaseUrl } from '@/lib/ark-api'
import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'

function readArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag)
  if (idx === -1) return null
  const val = process.argv[idx + 1]
  return typeof val === 'string' && val.trim() ? val.trim() : null
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  const apiKey = (process.env.ARK_API_KEY || '').trim()
  const baseUrl = (process.env.ARK_BASE_URL || '').trim()
  if (!apiKey) throw new Error('Missing env ARK_API_KEY')

  const model = readArg('--model') || 'doubao-seedance-2-0'
  const image = readArg('--image')
  const prompt = readArg('--prompt') || 'A cinematic underwater scene.'
  const ratio = readArg('--ratio') || '16:9'
  const duration = Number.parseInt(readArg('--duration') || '5', 10)
  const resolution = (readArg('--resolution') || '1080p') as '480p' | '720p' | '1080p'
  const generateAudio = (readArg('--generate-audio') || 'true').toLowerCase() !== 'false'

  if (!image) {
    throw new Error('Missing --image (url/storage key/media route)')
  }

  const v3 = resolveArkOpenApiV3BaseUrl(baseUrl || null)
  console.log('[ark] base:', v3)

  const imageDataUrl = await normalizeToBase64ForGeneration(image)
  const request = {
    model,
    content: [
      { type: 'text' as const, text: prompt },
      { type: 'image_url' as const, image_url: { url: imageDataUrl }, role: 'first_frame' as const },
    ],
    ratio,
    duration,
    resolution,
    generate_audio: generateAudio,
  }

  const created = await arkCreateVideoTask(request, { apiKey, ...(baseUrl ? { baseUrl } : {}) })
  const id = created.id
  console.log('[ark] task id:', id)

  for (let i = 0; i < 300; i += 1) {
    const status = await arkQueryVideoTask(id, { apiKey, ...(baseUrl ? { baseUrl } : {}) })
    console.log('[ark] status:', status.status)
    if (status.status === 'succeeded') {
      const videoUrl = status.content?.find((item) => item.type === 'video_url')?.video_url?.url
      console.log('[ark] video url:', videoUrl || '(missing)')
      return
    }
    if (status.status === 'failed') {
      console.error('[ark] failed:', status.error?.code, status.error?.message)
      process.exitCode = 2
      return
    }
    await sleep(2000)
  }

  console.error('[ark] timeout waiting task')
  process.exitCode = 3
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})

