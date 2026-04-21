import type { AgUiSseEvent } from '@/types/chat'

export interface StreamAgUiChatOptions {
  endpoint: string
  body: unknown
  signal?: AbortSignal
  onEvent: (event: AgUiSseEvent) => void
}

function parseEventBlock(block: string): AgUiSseEvent | null {
  const lines = block.split('\n')
  let eventName = 'message'
  const dataLines: string[] = []

  for (const line of lines) {
    if (!line || line.startsWith(':')) {
      continue
    }

    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim() || 'message'
      continue
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
    }
  }

  if (dataLines.length === 0) {
    return null
  }

  const rawData = dataLines.join('\n')

  if (rawData === '[DONE]') {
    return {
      event: 'done',
      payload: { type: 'done' },
      rawData,
    }
  }

  let payload: unknown = rawData

  try {
    payload = JSON.parse(rawData)
  } catch {
    // Keep raw string payload for non-JSON events.
  }

  return {
    event: eventName,
    payload,
    rawData,
  }
}

export async function streamAgUiChat(options: StreamAgUiChatOptions): Promise<void> {
  const response = await fetch(options.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(options.body),
    signal: options.signal,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`SSE request failed (${response.status}): ${errorText}`)
  }

  if (!response.body) {
    throw new Error('SSE response body is empty.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })

    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''

    for (const block of blocks) {
      const parsed = parseEventBlock(block.trim())
      if (parsed) {
        options.onEvent(parsed)
      }
    }
  }

  const tail = buffer.trim()
  if (tail) {
    const parsed = parseEventBlock(tail)
    if (parsed) {
      options.onEvent(parsed)
    }
  }
}
