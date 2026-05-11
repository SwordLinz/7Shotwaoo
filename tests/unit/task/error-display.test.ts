import { describe, expect, it } from 'vitest'
import { resolveErrorDisplay } from '@/lib/errors/display'

describe('resolveErrorDisplay', () => {
  it('shows a friendly copyright moderation message for upstream video blocks', () => {
    const display = resolveErrorDisplay({
      code: 'SENSITIVE_CONTENT',
      message: 'The request failed because the output video may be related to copyright restrictions. Request id: 02177847988888600000000000000000000ffffac153354eba24b',
    })

    expect(display).toEqual({
      code: 'SENSITIVE_CONTENT',
      message: '上游版权风控拦截',
    })
  })
})
