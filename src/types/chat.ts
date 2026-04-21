export type ChatRole = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  createdAt: number
}

export interface AgUiSseEvent {
  event: string
  payload: unknown
  rawData: string
}
