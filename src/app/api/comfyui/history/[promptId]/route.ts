import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'

const COMFYUI_BASE = process.env.COMFYUI_BASE_URL || 'http://127.0.0.1:8190'

/**
 * GET - Poll ComfyUI history for a given prompt_id.
 * Returns status ('pending' | 'completed' | 'failed') and output URLs if available.
 */
export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ promptId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const { promptId } = await context.params

  const res = await fetch(`${COMFYUI_BASE}/history/${promptId}`)
  if (!res.ok) {
    return NextResponse.json({ status: 'pending' })
  }

  const data = await res.json()
  const entry = data[promptId]
  if (!entry) {
    return NextResponse.json({ status: 'pending' })
  }

  if (entry.status?.status_str === 'error') {
    return NextResponse.json({
      status: 'failed',
      error: entry.status?.messages?.[0]?.[1] || 'Unknown error',
    })
  }

  const outputs = entry.outputs || {}
  let outputUrl: string | null = null

  for (const nodeOutput of Object.values(outputs) as Record<string, unknown>[]) {
    const images = (nodeOutput as { images?: Array<{ filename: string; subfolder: string; type: string }> }).images
    if (images?.length) {
      const img = images[0]
      outputUrl = `${COMFYUI_BASE}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${encodeURIComponent(img.type || 'output')}`
      break
    }
  }

  if (outputUrl) {
    return NextResponse.json({ status: 'completed', outputUrl })
  }

  return NextResponse.json({ status: 'pending' })
})
