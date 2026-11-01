import { describe, expect, it } from 'vitest'
import { parseOpenAiChunk } from './openaiCompatible'
import { createSseParser, type SseEvent } from './sse'

function parseAll(chunks: string[]): SseEvent[] {
  const parser = createSseParser()
  return [...chunks.flatMap((c) => parser.push(c)), ...parser.flush()]
}

const STREAM = [
  ': keep-alive comment',
  'data: {"choices":[{"delta":{"content":"Hel"}}]}',
  '',
  'event: message',
  'id: 7',
  'data: {"choices":[{"delta":{"content":"lo"}}]}',
  '',
  'data: line one',
  'data:line two',
  '',
  'data: [DONE]',
  '',
  '',
].join('\n')

describe('createSseParser', () => {
  it('parses data, event, id and multi-line data; ignores comments', () => {
    expect(parseAll([STREAM])).toEqual([
      { data: '{"choices":[{"delta":{"content":"Hel"}}]}' },
      { data: '{"choices":[{"delta":{"content":"lo"}}]}', event: 'message', id: '7' },
      { data: 'line one\nline two', id: '7' },
      { data: '[DONE]', id: '7' },
    ])
  })

  it('gives identical results for every possible chunk boundary', () => {
    const expected = parseAll([STREAM])
    for (let i = 1; i < STREAM.length; i++) {
      expect(parseAll([STREAM.slice(0, i), STREAM.slice(i)]), `split at ${i}`).toEqual(expected)
    }
    // One character at a time.
    expect(parseAll(STREAM.split(''))).toEqual(expected)
  })

  it('handles CRLF and CR line endings, including a CR/LF pair split across chunks', () => {
    expect(parseAll(['data: a\r\n\r\ndata: b\r\rdata: c\n\n'])).toEqual([{ data: 'a' }, { data: 'b' }, { data: 'c' }])
    expect(parseAll(['data: a\r', '\n\r', '\ndata: b\r\n', '\r\n'])).toEqual([{ data: 'a' }, { data: 'b' }])
  })

  it('dispatches a final event without a trailing blank line on flush', () => {
    const parser = createSseParser()
    expect(parser.push('data: partial')).toEqual([])
    expect(parser.flush()).toEqual([{ data: 'partial' }])
  })

  it('ignores a leading BOM, unknown fields and empty data-less events', () => {
    expect(parseAll(['﻿retry: 1000\nfoo: bar\n\nevent: ping\n\ndata: x\n\n'])).toEqual([{ data: 'x' }])
  })

  it('treats "data" without a colon as an empty data line', () => {
    expect(parseAll(['data\n\n'])).toEqual([{ data: '' }])
  })
})

describe('parseOpenAiChunk', () => {
  it('recognizes the [DONE] sentinel and ignores malformed payloads', () => {
    expect(parseOpenAiChunk('[DONE]')).toBe('done')
    expect(parseOpenAiChunk('  [DONE]  ')).toBe('done')
    expect(parseOpenAiChunk('{not json')).toBeUndefined()
    expect(parseOpenAiChunk('')).toBeUndefined()
  })

  it('extracts content, reasoning (both spellings), usage and finish reason', () => {
    expect(parseOpenAiChunk('{"choices":[{"delta":{"content":"Hi"}}]}')).toEqual({ text: 'Hi' })
    expect(parseOpenAiChunk('{"choices":[{"delta":{"reasoning_content":"thinking"}}]}')).toEqual({ reasoning: 'thinking' })
    expect(parseOpenAiChunk('{"choices":[{"delta":{"reasoning":"also thinking"}}]}')).toEqual({ reasoning: 'also thinking' })
    expect(parseOpenAiChunk('{"choices":[{"delta":{},"finish_reason":"length"}]}')).toEqual({ finishReason: 'length' })
    expect(parseOpenAiChunk('{"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":34}}')).toEqual({ usage: { inputTokens: 12, outputTokens: 34 } })
  })

  it('reads non-streamed completions and error payloads', () => {
    expect(parseOpenAiChunk('{"choices":[{"message":{"content":"Whole answer"},"finish_reason":"stop"}]}')).toEqual({ text: 'Whole answer', finishReason: 'stop' })
    expect(parseOpenAiChunk('{"error":{"message":"model not found"}}')).toEqual({ error: 'model not found' })
    expect(parseOpenAiChunk('{"error":"boom"}')).toEqual({ error: 'boom' })
  })
})
