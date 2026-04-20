import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'

const COMFYUI_BASE = process.env.COMFYUI_BASE_URL || 'http://127.0.0.1:8190'

/**
 * POST - Forward a prompt to local ComfyUI server.
 * Accepts either a raw workflow JSON body or a workflowPath pointing to a local file.
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  let workflow = body.workflow

  if (!workflow && body.workflowPath) {
    const fs = await import('fs/promises')
    const path = await import('path')
    const resolved = path.resolve(body.workflowPath)
    const raw = await fs.readFile(resolved, 'utf-8')
    workflow = JSON.parse(raw)
  }

  if (!workflow) {
    return NextResponse.json({ error: 'workflow or workflowPath required' }, { status: 400 })
  }

  const res = await fetch(`${COMFYUI_BASE}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
  })

  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ error: text }, { status: res.status })
  }

  const data = await res.json()
  return NextResponse.json(data)
})
