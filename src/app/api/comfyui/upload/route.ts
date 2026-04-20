import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'

const COMFYUI_BASE = process.env.COMFYUI_BASE_URL || 'http://127.0.0.1:8190'

/**
 * POST - Upload an image to the local ComfyUI server's input directory.
 * Expects multipart form data with a `file` field.
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const formData = await request.formData()
  const file = formData.get('file')
  if (!file) {
    return NextResponse.json({ error: 'file field required' }, { status: 400 })
  }

  const upstreamForm = new FormData()
  upstreamForm.append('image', file)

  const res = await fetch(`${COMFYUI_BASE}/upload/image`, {
    method: 'POST',
    body: upstreamForm,
  })

  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ error: text }, { status: res.status })
  }

  const data = await res.json()
  return NextResponse.json(data)
})
