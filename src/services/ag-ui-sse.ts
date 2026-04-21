import type { AgUiSseEvent } from '@/types/chat'

export interface CreateRunRequest {
  userRequirement: string
  workspaceRoot: string
}

export interface CreateRunResponse {
  runId: string
  status?: string
  createdAt?: string
  streamUrl?: string
  cancelUrl?: string
}

export interface CancelRunResponse {
  runId?: string
  status?: string
}

export interface RunStatusResponse {
  runId?: string
  status?: string
  currentStage?: string
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
}

export interface RunListItem {
  runId: string
  status: string
  currentStage: string
  userRequirementPreview: string
  workspaceRoot: string
  createdAt: string
  updatedAt: string
}

export interface ListRunsParams {
  page: number
  size: number
  status?: string
  keyword?: string
}

export interface ListRunsResponse {
  total: number
  page: number
  size: number
  items: RunListItem[]
}

export interface StreamRunEventsOptions {
  runId: string
  signal?: AbortSignal
  onEvent: (event: AgUiSseEvent) => void
}

function getApiBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL ?? '/poc/api'
}

function getRunsPath(): string {
  return `${getApiBaseUrl()}/agent/runs`
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function parseCreateRunResponse(payload: unknown): CreateRunResponse {
  const record = asRecord(payload)
  const runId = typeof record.runId === 'string' ? record.runId : ''

  if (!runId) {
    throw new Error('Create run succeeded but runId is missing in response.')
  }

  return {
    runId,
    status: typeof record.status === 'string' ? record.status : undefined,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : undefined,
    streamUrl: typeof record.streamUrl === 'string' ? record.streamUrl : undefined,
    cancelUrl: typeof record.cancelUrl === 'string' ? record.cancelUrl : undefined,
  }
}

function parseEventBlock(block: string): AgUiSseEvent | null {
  const lines = block.split('\n')
  let eventName = 'message'
  const dataLines: string[] = []

  for (const line of lines) {
    if (!line || line.startsWith(':')) continue

    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim() || 'message'
      continue
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
    }
  }

  if (dataLines.length === 0) return null

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
    // keep string payload
  }

  return {
    event: eventName,
    payload,
    rawData,
  }
}

export async function createAgentRun(body: CreateRunRequest, signal?: AbortSignal): Promise<CreateRunResponse> {
  const response = await fetch(getRunsPath(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Create run failed (${response.status}): ${errorText}`)
  }

  const payload = await response.json()
  return parseCreateRunResponse(payload)
}

export async function streamRunEvents(options: StreamRunEventsOptions): Promise<void> {
  const response = await fetch(`${getRunsPath()}/${options.runId}/events`, {
    method: 'GET',
    headers: { Accept: 'text/event-stream' },
    signal: options.signal,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Subscribe events failed (${response.status}): ${errorText}`)
  }

  if (!response.body) {
    throw new Error('SSE response body is empty.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''

    for (const block of blocks) {
      const parsed = parseEventBlock(block.trim())
      if (parsed) options.onEvent(parsed)
    }
  }

  const tail = buffer.trim()
  if (tail) {
    const parsed = parseEventBlock(tail)
    if (parsed) options.onEvent(parsed)
  }
}

export async function cancelAgentRun(runId: string): Promise<CancelRunResponse> {
  const response = await fetch(`${getRunsPath()}/${runId}/cancel`, {
    method: 'POST',
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Cancel run failed (${response.status}): ${errorText}`)
  }

  const payload = await response.json().catch(() => ({}))
  const record = asRecord(payload)

  return {
    runId: typeof record.runId === 'string' ? record.runId : undefined,
    status: typeof record.status === 'string' ? record.status : undefined,
  }
}

export async function getRunStatus(runId: string, signal?: AbortSignal): Promise<RunStatusResponse> {
  const response = await fetch(`${getRunsPath()}/${runId}`, {
    method: 'GET',
    signal,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Get run status failed (${response.status}): ${errorText}`)
  }

  const payload = await response.json()
  return asRecord(payload) as RunStatusResponse
}

export async function listAgentRuns(params: ListRunsParams, signal?: AbortSignal): Promise<ListRunsResponse> {
  const query = new URLSearchParams()
  query.set('page', String(params.page))
  query.set('size', String(params.size))
  if (params.status) query.set('status', params.status)
  if (params.keyword) query.set('keyword', params.keyword)

  const response = await fetch(`${getRunsPath()}?${query.toString()}`, {
    method: 'GET',
    signal,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`List runs failed (${response.status}): ${errorText}`)
  }

  const payload = asRecord(await response.json())
  const itemsRaw = Array.isArray(payload.items) ? payload.items : []
  const items: RunListItem[] = itemsRaw.map((item) => {
    const row = asRecord(item)
    return {
      runId: typeof row.runId === 'string' ? row.runId : '',
      status: typeof row.status === 'string' ? row.status.toLowerCase() : 'unknown',
      currentStage: typeof row.currentStage === 'string' ? row.currentStage : '',
      userRequirementPreview: typeof row.userRequirementPreview === 'string' ? row.userRequirementPreview : '',
      workspaceRoot: typeof row.workspaceRoot === 'string' ? row.workspaceRoot : '',
      createdAt: typeof row.createdAt === 'string' ? row.createdAt : '',
      updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : '',
    }
  })

  return {
    total: typeof payload.total === 'number' ? payload.total : 0,
    page: typeof payload.page === 'number' ? payload.page : params.page,
    size: typeof payload.size === 'number' ? payload.size : params.size,
    items,
  }
}
