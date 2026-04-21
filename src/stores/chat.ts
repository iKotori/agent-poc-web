import { defineStore } from 'pinia'
import { streamAgUiChat } from '@/services/ag-ui-sse'
import type { AgUiSseEvent, ChatMessage } from '@/types/chat'

type ChatStatus = 'idle' | 'streaming' | 'error'

interface ChatState {
  messages: ChatMessage[]
  status: ChatStatus
  error: string
  abortController: AbortController | null
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

export const useChatStore = defineStore('chat', {
  state: (): ChatState => ({
    messages: [],
    status: 'idle',
    error: '',
    abortController: null,
  }),
  getters: {
    isStreaming: (state) => state.status === 'streaming',
  },
  actions: {
    appendMessage(role: ChatMessage['role'], content: string): ChatMessage {
      const message: ChatMessage = {
        id: createId(role),
        role,
        content,
        createdAt: Date.now(),
      }
      this.messages.push(message)
      return message
    },
    updateAssistantMessage(content: string): void {
      const lastMessage = this.messages[this.messages.length - 1]
      if (!lastMessage || lastMessage.role !== 'assistant') {
        this.appendMessage('assistant', content)
        return
      }
      lastMessage.content += content
    },
    extractTextFromEvent(event: AgUiSseEvent): string {
      const payload = asRecord(event.payload)
      const type = typeof payload.type === 'string' ? payload.type : event.event

      if (
        type === 'response.output_text.delta' ||
        type === 'assistant_message.delta' ||
        type === 'message.delta'
      ) {
        if (typeof payload.delta === 'string') {
          return payload.delta
        }
        if (typeof payload.content === 'string') {
          return payload.content
        }
      }

      if (
        type === 'response.output_text.done' ||
        type === 'assistant_message.completed' ||
        type === 'message.completed'
      ) {
        if (typeof payload.content === 'string') {
          return payload.content
        }
      }

      if (typeof payload.delta === 'string') {
        return payload.delta
      }

      if (typeof payload.text === 'string') {
        return payload.text
      }

      if (typeof payload.content === 'string') {
        return payload.content
      }

      return ''
    },
    async sendMessage(userInput: string): Promise<void> {
      const text = userInput.trim()
      if (!text || this.isStreaming) {
        return
      }

      this.error = ''
      this.status = 'streaming'
      this.appendMessage('user', text)
      this.appendMessage('assistant', '')

      const endpoint = import.meta.env.VITE_AGUI_CHAT_URL ?? '/api/ag-ui/chat'
      const controller = new AbortController()
      this.abortController = controller

      const requestBody = {
        input: text,
        messages: this.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      }

      try {
        await streamAgUiChat({
          endpoint,
          body: requestBody,
          signal: controller.signal,
          onEvent: (event) => {
            const payload = asRecord(event.payload)
            const type = typeof payload.type === 'string' ? payload.type : event.event

            if (type === 'error' || type === 'run.error') {
              const errorMessage =
                (typeof payload.message === 'string' && payload.message) ||
                (typeof payload.error === 'string' && payload.error) ||
                'Stream failed on server side.'
              throw new Error(errorMessage)
            }

            const delta = this.extractTextFromEvent(event)
            if (delta) {
              this.updateAssistantMessage(delta)
            }
          },
        })
        this.status = 'idle'
      } catch (error) {
        if (controller.signal.aborted) {
          this.status = 'idle'
          return
        }
        this.status = 'error'
        this.error = error instanceof Error ? error.message : 'Unknown stream error.'
      } finally {
        this.abortController = null
      }
    },
    stopStreaming(): void {
      if (this.abortController) {
        this.abortController.abort()
      }
    },
    resetChat(): void {
      this.messages = []
      this.error = ''
      this.status = 'idle'
    },
  },
})
