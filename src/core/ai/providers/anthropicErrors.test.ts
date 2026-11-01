import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { buildAnthropicParams, mapAnthropicError, toAnthropicMessages, totalInputTokens } from './anthropic'
import { getModel } from '../models'

/** Error mapping against the real SDK classes (verifies the subclass ordering). */
describe('mapAnthropicError with the real SDK', () => {
  const headers = new Headers()
  const body = (type: string, message: string) => ({ type: 'error', error: { type, message } })

  it('maps generated status errors', () => {
    const cases: Array<[number, string, string, boolean]> = [
      [400, 'invalid_request_error', 'bad_request', false],
      [401, 'authentication_error', 'auth', false],
      [403, 'permission_error', 'auth', false],
      [404, 'not_found_error', 'unknown', false],
      [429, 'rate_limit_error', 'rate_limit', true],
      [500, 'api_error', 'overloaded', true],
      [529, 'overloaded_error', 'overloaded', true],
    ]
    for (const [status, type, code, retryable] of cases) {
      const err = Anthropic.APIError.generate(status, body(type, `${type} happened`), undefined, headers)
      expect(mapAnthropicError(err, Anthropic), String(status)).toMatchObject({ type: 'error', code, retryable })
    }
  })

  it('maps connection errors (subclasses of APIError) to network, not overloaded/unknown', () => {
    expect(mapAnthropicError(new Anthropic.APIConnectionError({ message: 'Connection error.' }), Anthropic)).toMatchObject({ code: 'network', retryable: true })
    expect(mapAnthropicError(new Anthropic.APIConnectionTimeoutError(), Anthropic)).toMatchObject({ code: 'network', retryable: true })
  })

  it('surfaces the API message for bad requests', () => {
    const err = Anthropic.APIError.generate(400, body('invalid_request_error', 'max_tokens: 999999 > 128000'), undefined, headers)
    expect(mapAnthropicError(err, Anthropic).error).toContain('max_tokens: 999999 > 128000')
  })

  it('maps non-SDK errors to unknown', () => {
    expect(mapAnthropicError(new TypeError('boom'), Anthropic)).toMatchObject({ code: 'unknown', error: 'boom' })
  })
})

describe('request helpers', () => {
  it('sums cached input tokens', () => {
    expect(totalInputTokens({ input_tokens: 10, cache_creation_input_tokens: 4, cache_read_input_tokens: null })).toBe(14)
  })

  it('drops empty turns and trailing assistant prefills', () => {
    expect(
      toAnthropicMessages([
        { role: 'user', content: '   ' },
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'Question' },
        { role: 'assistant', content: 'Prefill' },
      ]),
    ).toEqual([{ role: 'user', content: 'Question' }])
  })

  it('omits the system prompt when empty', () => {
    const model = getModel('claude-haiku-5-5')!
    const params = buildAnthropicParams({ modelId: model.id, messages: [{ role: 'user', content: 'x' }] }, model)
    expect(params).not.toHaveProperty('system')
    expect(params.max_tokens).toBe(64000)
  })
})
