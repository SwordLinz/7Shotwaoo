import { NextRequest, NextResponse } from 'next/server'
import { getAutomationToken } from '@/lib/automation/config'

const BEARER = /^Bearer\s+(.+)$/i

export function requireAutomationAuth(request: NextRequest): NextResponse | null {
  const expected = getAutomationToken()
  if (!expected) {
    return NextResponse.json(
      { error: 'automation_not_configured', message: 'WACOO_AUTOMATION_TOKEN is not set' },
      { status: 503 },
    )
  }

  const header = request.headers.get('authorization') || ''
  const match = BEARER.exec(header.trim())
  const token = match?.[1]?.trim() || ''
  if (!token || token !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  return null
}
