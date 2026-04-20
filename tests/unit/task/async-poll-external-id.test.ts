import { describe, expect, it } from 'vitest'
import { formatExternalId, parseExternalId } from '@/lib/async-poll'

describe('async poll externalId contract', () => {
  it('parses standard FAL externalId with endpoint', () => {
    const parsed = parseExternalId('FAL:VIDEO:fal-ai/wan/v2.6/image-to-video:req_123')
    expect(parsed.provider).toBe('FAL')
    expect(parsed.type).toBe('VIDEO')
    expect(parsed.endpoint).toBe('fal-ai/wan/v2.6/image-to-video')
    expect(parsed.requestId).toBe('req_123')
  })

  it('rejects legacy non-standard externalId formats', () => {
    expect(() => parseExternalId('FAL:fal-ai/wan/v2.6/image-to-video:req_123')).toThrow(/无效 FAL externalId/)
    expect(() => parseExternalId('batches/legacy')).toThrow(/无法识别的 externalId 格式/)
  })

  it('requires endpoint when formatting FAL externalId', () => {
    expect(() => formatExternalId('FAL', 'VIDEO', 'req_123')).toThrow(/requires endpoint/)
  })

  it('parses OPENAI video externalId with provider token', () => {
    const parsed = parseExternalId('OPENAI:VIDEO:b3BlbmFpLWNvbXBhdGlibGU6b2EtMQ:vid_123')
    expect(parsed.provider).toBe('OPENAI')
    expect(parsed.type).toBe('VIDEO')
    expect(parsed.providerToken).toBe('b3BlbmFpLWNvbXBhdGlibGU6b2EtMQ')
    expect(parsed.requestId).toBe('vid_123')
  })

  it('requires provider token when formatting OPENAI externalId', () => {
    expect(() => formatExternalId('OPENAI', 'VIDEO', 'vid_123')).toThrow(/providerToken/)
  })

  it('parses and formats BAILIAN externalId', () => {
    const externalId = formatExternalId('BAILIAN', 'VIDEO', 'task_123')
    expect(externalId).toBe('BAILIAN:VIDEO:task_123')

    const parsed = parseExternalId(externalId)
    expect(parsed.provider).toBe('BAILIAN')
    expect(parsed.type).toBe('VIDEO')
    expect(parsed.requestId).toBe('task_123')
  })

  it('parses and formats SILICONFLOW externalId', () => {
    const externalId = formatExternalId('SILICONFLOW', 'IMAGE', 'task_456')
    expect(externalId).toBe('SILICONFLOW:IMAGE:task_456')

    const parsed = parseExternalId(externalId)
    expect(parsed.provider).toBe('SILICONFLOW')
    expect(parsed.type).toBe('IMAGE')
    expect(parsed.requestId).toBe('task_456')
  })

  it('parses and formats YOUCHUAN image externalId', () => {
    const externalId = formatExternalId('YOUCHUAN', 'IMAGE', '68be9b50553a97d658968285')
    expect(externalId).toBe('YOUCHUAN:IMAGE:68be9b50553a97d658968285')

    const parsed = parseExternalId(externalId)
    expect(parsed.provider).toBe('YOUCHUAN')
    expect(parsed.type).toBe('IMAGE')
    expect(parsed.requestId).toBe('68be9b50553a97d658968285')
  })

  it('parses ARK video externalId with default ark key (3 segments)', () => {
    const parsed = parseExternalId('ARK:VIDEO:cgt-test-123')
    expect(parsed.provider).toBe('ARK')
    expect(parsed.type).toBe('VIDEO')
    expect(parsed.requestId).toBe('cgt-test-123')
    expect(parsed.arkProviderKey).toBe('ark')
  })

  it('parses ARK video externalId with Wacoo provider key (niuniu)', () => {
    const parsed = parseExternalId('ARK:VIDEO:niuniu:cgt-test-456')
    expect(parsed.provider).toBe('ARK')
    expect(parsed.type).toBe('VIDEO')
    expect(parsed.arkProviderKey).toBe('niuniu')
    expect(parsed.requestId).toBe('cgt-test-456')
  })

  it('formats ARK externalId with optional wacoo provider key', () => {
    expect(formatExternalId('ARK', 'VIDEO', 'cgt-1')).toBe('ARK:VIDEO:cgt-1')
    expect(formatExternalId('ARK', 'VIDEO', 'cgt-1', undefined, undefined, undefined, 'niuniu')).toBe(
      'ARK:VIDEO:niuniu:cgt-1',
    )
  })

  it('parses and formats RUNNINGHUB video externalId', () => {
    const token = Buffer.from('runninghub', 'utf8').toString('base64url')
    const externalId = formatExternalId('RUNNINGHUB', 'VIDEO', '2013508786110730241', undefined, token)
    expect(externalId).toBe(`RUNNINGHUB:VIDEO:${token}:2013508786110730241`)

    const parsed = parseExternalId(externalId)
    expect(parsed.provider).toBe('RUNNINGHUB')
    expect(parsed.type).toBe('VIDEO')
    expect(parsed.providerToken).toBe(token)
    expect(parsed.requestId).toBe('2013508786110730241')
  })
})
