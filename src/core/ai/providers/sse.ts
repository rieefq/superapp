/**
 * Incremental Server-Sent Events parser (WHATWG event-stream rules), robust to arbitrary
 * chunk boundaries: lines may be split anywhere, including between `\r` and `\n`.
 * - `data:` lines accumulate (joined with `\n`) until a blank line dispatches the event,
 * - lines starting with `:` are comments, `event:`/`id:` set metadata, other fields are ignored,
 * - one leading space after the colon is stripped, a leading BOM is ignored.
 */

export interface SseEvent {
  data: string
  event?: string
  id?: string
}

export interface SseParser {
  /** Feed decoded text; returns the events completed by this chunk. */
  push(chunk: string): SseEvent[]
  /** End of stream: dispatches an event still pending without a terminating blank line. */
  flush(): SseEvent[]
}

export function createSseParser(): SseParser {
  let buffer = ''
  let data: string[] = []
  let eventType: string | undefined
  let lastId: string | undefined
  let started = false
  let pendingCR = false

  const dispatch = (out: SseEvent[]) => {
    if (data.length) {
      const ev: SseEvent = { data: data.join('\n') }
      if (eventType) ev.event = eventType
      if (lastId !== undefined) ev.id = lastId
      out.push(ev)
    }
    data = []
    eventType = undefined
  }

  const processLine = (line: string, out: SseEvent[]) => {
    if (line === '') return dispatch(out)
    if (line.startsWith(':')) return
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') data.push(value)
    else if (field === 'event') eventType = value
    else if (field === 'id' && !value.includes('\0')) lastId = value
  }

  return {
    push(chunk) {
      let text = chunk
      if (!started && text.length) {
        started = true
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
      }
      if (pendingCR && text.startsWith('\n')) text = text.slice(1)
      if (text.length) pendingCR = false
      buffer += text
      const out: SseEvent[] = []
      let start = 0
      for (let i = 0; i < buffer.length; i++) {
        const ch = buffer[i]
        if (ch !== '\n' && ch !== '\r') continue
        const line = buffer.slice(start, i)
        if (ch === '\r') {
          if (i + 1 < buffer.length) {
            if (buffer[i + 1] === '\n') i++
          } else {
            pendingCR = true // a "\n" at the start of the next chunk belongs to this line break
          }
        }
        processLine(line, out)
        start = i + 1
      }
      buffer = buffer.slice(start)
      return out
    },
    flush() {
      const out: SseEvent[] = []
      if (buffer) processLine(buffer, out)
      buffer = ''
      dispatch(out)
      return out
    },
  }
}
