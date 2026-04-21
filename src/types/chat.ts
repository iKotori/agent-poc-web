export type ChatRole = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  createdAt: number
}

export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

export interface AgUiSseEvent {
  event: string
  payload: unknown
  rawData: string
}

export type StageKey =
  | 'requirement-analysis'
  | 'sql-generation'
  | 'api-design'
  | 'backend-generation'
  | 'frontend-generation'
  | 'backend-build'
  | 'frontend-build'

export type StageStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled'

export interface StageProgressNode {
  key: StageKey
  name: string
  description: string
  artifact: string
  status: StageStatus
  durationMs: number | null
}
