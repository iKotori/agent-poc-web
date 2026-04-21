import { defineStore } from 'pinia'
import { cancelAgentRun, createAgentRun, getRunStatus, listAgentRuns, streamRunEvents } from '@/services/ag-ui-sse'
import type { RunListItem } from '@/services/ag-ui-sse'
import type { AgUiSseEvent, ChatMessage, ChatSession, StageKey, StageProgressNode } from '@/types/chat'

type ChatStatus = 'idle' | 'streaming' | 'error'

interface ChatState {
  sessions: ChatSession[]
  activeSessionId: string
  status: ChatStatus
  error: string
  abortController: AbortController | null
  activeRunId: string | null
  runStatus: string
  currentStage: string
  workspaceRoot: string
  stageProgress: StageProgressNode[]
  historyLoading: boolean
  historyError: string
  historyItems: RunListItem[]
  historyTotal: number
  historyPage: number
  historySize: number
  historyStatus: string
  historyKeyword: string
}

const DEFAULT_SESSION_TITLE = '新会话'

const STAGE_META: Array<Pick<StageProgressNode, 'key' | 'name' | 'description' | 'artifact'>> = [
  {
    key: 'requirement-analysis',
    name: '需求分析',
    description: '将自然语言需求结构化为模块、实体、约束。',
    artifact: 'requirement-analysis-parsed.json',
  },
  {
    key: 'sql-generation',
    name: 'SQL 生成',
    description: '产出数据模型、表结构、索引和关系。',
    artifact: 'sql-generation-parsed.json',
  },
  {
    key: 'api-design',
    name: 'API 设计',
    description: '设计接口、参数、返回和错误码契约。',
    artifact: 'api-design-parsed.json',
  },
  {
    key: 'backend-generation',
    name: '后端生成',
    description: '生成控制器、服务、实体和仓储代码。',
    artifact: 'backend-generation-parsed.json',
  },
  {
    key: 'frontend-generation',
    name: '前端生成',
    description: '生成页面、调用逻辑与前端工程代码。',
    artifact: 'frontend-generation-parsed.json',
  },
  {
    key: 'backend-build',
    name: '后端构建',
    description: '执行 mvn compile 进行后端构建验证。',
    artifact: 'backend-build.log',
  },
  {
    key: 'frontend-build',
    name: '前端构建',
    description: '执行 npm run build 进行前端构建验证。',
    artifact: 'frontend-build.log',
  },
]

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function buildSessionTitle(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return DEFAULT_SESSION_TITLE
  return cleaned.length > 20 ? `${cleaned.slice(0, 20)}...` : cleaned
}

function createSession(title = DEFAULT_SESSION_TITLE): ChatSession {
  const now = Date.now()
  return {
    id: createId('session'),
    title,
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
}

function createStageProgress(): StageProgressNode[] {
  return STAGE_META.map((item) => ({
    ...item,
    status: 'pending',
    durationMs: null,
  }))
}

function getStatusFromPayload(payload: unknown): string {
  const record = asRecord(payload)
  const direct = record.status ?? record.state ?? record.phase ?? record.runStatus
  if (typeof direct === 'string' && direct) return direct.toLowerCase()

  const data = asRecord(record.data)
  const nested = data.status ?? data.state ?? data.phase ?? data.runStatus
  if (typeof nested === 'string' && nested) return nested.toLowerCase()

  return 'unknown'
}

function getCurrentStageFromPayload(payload: unknown): string {
  const record = asRecord(payload)
  if (typeof record.currentStage === 'string') return record.currentStage

  const data = asRecord(record.data)
  if (typeof data.currentStage === 'string') return data.currentStage

  return ''
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      cleanup()
      resolve()
    }, ms)

    const onAbort = () => {
      window.clearTimeout(timer)
      cleanup()
      resolve()
    }

    const cleanup = () => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function isTerminalRunStatus(status: string | null | undefined): boolean {
  if (!status) return false
  const value = status.toLowerCase()
  return value === 'completed' || value === 'failed' || value === 'cancelled'
}

export const useChatStore = defineStore('chat', {
  state: (): ChatState => {
    const firstSession = createSession()
    return {
      sessions: [firstSession],
      activeSessionId: firstSession.id,
      status: 'idle',
      error: '',
      abortController: null,
      activeRunId: null,
      runStatus: 'idle',
      currentStage: '',
      workspaceRoot: import.meta.env.VITE_WORKSPACE_ROOT ?? 'D:/workspace/poc-output/task-a',
      stageProgress: createStageProgress(),
      historyLoading: false,
      historyError: '',
      historyItems: [],
      historyTotal: 0,
      historyPage: 1,
      historySize: 20,
      historyStatus: '',
      historyKeyword: '',
    }
  },
  getters: {
    isStreaming: (state) => state.status === 'streaming',
    activeSession: (state): ChatSession | undefined =>
      state.sessions.find((session) => session.id === state.activeSessionId),
    activeMessages(): ChatMessage[] {
      return this.activeSession?.messages ?? []
    },
  },
  actions: {
    finalizeStreamingByRunStatus(): void {
      if (!isTerminalRunStatus(this.runStatus)) return
      if (this.status === 'streaming') {
        this.status = 'idle'
      }
      if (this.abortController && !this.abortController.signal.aborted) {
        this.abortController.abort()
      }
    },
    ensureActiveSession(): ChatSession {
      let session = this.activeSession
      if (!session) {
        session = createSession()
        this.sessions.unshift(session)
        this.activeSessionId = session.id
      }
      return session
    },
    touchActiveSession(): void {
      const session = this.ensureActiveSession()
      session.updatedAt = Date.now()
    },
    setWorkspaceRoot(value: string): void {
      this.workspaceRoot = value.trim()
    },
    setHistoryStatus(value: string): void {
      this.historyStatus = value.trim().toLowerCase()
    },
    setHistoryKeyword(value: string): void {
      this.historyKeyword = value.trim()
    },
    setHistoryPage(value: number): void {
      this.historyPage = Math.max(1, value)
    },
    getHistoryTotalPages(): number {
      const pages = Math.ceil(this.historyTotal / this.historySize)
      return pages > 0 ? pages : 1
    },
    async fetchRunHistory(): Promise<void> {
      this.historyLoading = true
      this.historyError = ''
      try {
        const result = await listAgentRuns({
          page: this.historyPage,
          size: this.historySize,
          status: this.historyStatus || undefined,
          keyword: this.historyKeyword || undefined,
        })
        this.historyItems = result.items
        this.historyTotal = result.total
        this.historyPage = result.page
        this.historySize = result.size
      } catch (error) {
        this.historyError = error instanceof Error ? error.message : '加载历史会话失败。'
      } finally {
        this.historyLoading = false
      }
    },
    resetStageProgress(): void {
      this.stageProgress = createStageProgress()
      this.currentStage = ''
    },
    findStageNode(stage: string): StageProgressNode | undefined {
      return this.stageProgress.find((item) => item.key === stage)
    },
    markStageStarted(stage: string): void {
      const node = this.findStageNode(stage)
      if (!node) return
      node.status = 'running'
      this.currentStage = node.key
    },
    markStageCompleted(stage: string, durationMs?: number): void {
      const node = this.findStageNode(stage)
      if (!node) return
      node.status = 'success'
      node.durationMs = typeof durationMs === 'number' ? durationMs : node.durationMs
      this.currentStage = node.key
    },
    markStageFailed(stage: string): void {
      const node = this.findStageNode(stage)
      if (!node) return
      node.status = 'failed'
      this.currentStage = node.key
    },
    markStageCancelled(stage: string): void {
      const node = this.findStageNode(stage)
      if (!node) return
      if (node.status === 'success' || node.status === 'failed') return
      node.status = 'cancelled'
      this.currentStage = node.key
    },
    markAllRunningAsCancelled(): void {
      for (const node of this.stageProgress) {
        if (node.status === 'running') node.status = 'cancelled'
      }
    },
    markAllAsCompleted(): void {
      for (const node of this.stageProgress) {
        if (node.status === 'pending' || node.status === 'running' || node.status === 'cancelled') {
          node.status = 'success'
        }
      }
    },
    createSession(): void {
      if (this.isStreaming) return
      this.error = ''
      const session = createSession()
      this.sessions.unshift(session)
      this.activeSessionId = session.id
      this.status = 'idle'
    },
    switchSession(sessionId: string): void {
      if (this.isStreaming) return
      const target = this.sessions.find((item) => item.id === sessionId)
      if (!target) return
      this.activeSessionId = target.id
      this.error = ''
      this.status = 'idle'
    },
    deleteSession(sessionId: string): void {
      if (this.isStreaming) return
      const index = this.sessions.findIndex((item) => item.id === sessionId)
      if (index < 0) return

      if (this.sessions.length === 1) {
        const first = this.sessions[0]
        if (!first) return
        first.messages = []
        first.title = DEFAULT_SESSION_TITLE
        first.updatedAt = Date.now()
        this.activeSessionId = first.id
        this.error = ''
        this.status = 'idle'
        return
      }

      const removed = this.sessions[index]
      if (!removed) return
      this.sessions.splice(index, 1)

      if (removed.id === this.activeSessionId) {
        const fallback = this.sessions[Math.max(index - 1, 0)] ?? this.sessions[0]
        if (!fallback) return
        this.activeSessionId = fallback.id
        this.error = ''
        this.status = 'idle'
      }
    },
    appendMessage(role: ChatMessage['role'], content: string): ChatMessage {
      const session = this.ensureActiveSession()
      const message: ChatMessage = {
        id: createId(role),
        role,
        content,
        createdAt: Date.now(),
      }
      session.messages.push(message)
      this.touchActiveSession()
      return message
    },
    updateAssistantMessage(content: string): void {
      const session = this.ensureActiveSession()
      const lastMessage = session.messages[session.messages.length - 1]
      if (!lastMessage || lastMessage.role !== 'assistant') {
        this.appendMessage('assistant', content)
        return
      }
      lastMessage.content += content
      this.touchActiveSession()
    },
    extractDeltaText(event: AgUiSseEvent): string {
      const envelope = asRecord(event.payload)
      const eventType = typeof envelope.type === 'string' ? envelope.type : event.event
      const payload = asRecord(envelope.payload)

      if (eventType === 'build.log') return ''
      if (typeof envelope.delta === 'string') return envelope.delta
      if (typeof envelope.content === 'string') return envelope.content
      if (typeof payload.delta === 'string') return payload.delta
      if (typeof payload.content === 'string') return payload.content
      return ''
    },
    handleAgUiEvent(event: AgUiSseEvent): void {
      const envelope = asRecord(event.payload)
      const eventType = typeof envelope.type === 'string' ? envelope.type : event.event
      const payload = asRecord(envelope.payload)

      if (eventType === 'run.started') {
        this.runStatus = 'running'
        return
      }

      if (eventType === 'stage.started') {
        const stage = typeof payload.stage === 'string' ? payload.stage : ''
        this.markStageStarted(stage)
        return
      }

      if (eventType === 'stage.completed') {
        const stage = typeof payload.stage === 'string' ? payload.stage : ''
        const durationMs = typeof payload.durationMs === 'number' ? payload.durationMs : undefined
        this.markStageCompleted(stage, durationMs)
        return
      }

      if (eventType === 'run.error') {
        const errorStage = typeof payload.stage === 'string' ? payload.stage : this.currentStage
        const message =
          (typeof payload.message === 'string' && payload.message) ||
          (typeof envelope.message === 'string' && envelope.message) ||
          '任务执行失败。'
        if (errorStage) this.markStageFailed(errorStage)
        this.runStatus = 'failed'
        this.error = message
        this.finalizeStreamingByRunStatus()
        return
      }

      if (eventType === 'run.cancelled') {
        this.runStatus = 'cancelled'
        if (this.currentStage) this.markStageCancelled(this.currentStage)
        this.markAllRunningAsCancelled()
        this.finalizeStreamingByRunStatus()
        return
      }

      if (eventType === 'run.completed') {
        this.runStatus = 'completed'
        this.markAllAsCompleted()
        this.finalizeStreamingByRunStatus()
        return
      }

      const delta = this.extractDeltaText(event)
      if (delta) this.updateAssistantMessage(delta)
    },
    async sendMessage(userInput: string): Promise<void> {
      const requirement = userInput.trim()
      const workspaceRoot = this.workspaceRoot.trim()
      if (!requirement || !workspaceRoot || this.isStreaming) return

      const session = this.ensureActiveSession()
      this.error = ''
      this.status = 'streaming'
      this.runStatus = 'accepted'
      this.resetStageProgress()

      if (session.title === DEFAULT_SESSION_TITLE && session.messages.length === 0) {
        session.title = buildSessionTitle(requirement)
      }

      this.appendMessage('user', requirement)
      this.appendMessage('assistant', '')

      const controller = new AbortController()
      this.abortController = controller

      try {
        const run = await createAgentRun({ userRequirement: requirement, workspaceRoot }, controller.signal)
        this.activeRunId = run.runId
        this.runStatus = (run.status ?? 'accepted').toLowerCase()

        const poller = this.pollRunStatus(run.runId, controller.signal)

        await streamRunEvents({
          runId: run.runId,
          signal: controller.signal,
          onEvent: (event) => this.handleAgUiEvent(event),
        })

        await poller
        await this.refreshRunStatus(run.runId)
        this.status = 'idle'
      } catch (error) {
        if (controller.signal.aborted) {
          this.status = 'idle'
          return
        }
        this.status = 'error'
        this.error = error instanceof Error ? error.message : '未知错误。'
      } finally {
        this.abortController = null
        this.activeRunId = null
      }
    },
    async stopStreaming(): Promise<void> {
      if (!this.isStreaming) return
      if (isTerminalRunStatus(this.runStatus)) {
        this.status = 'idle'
        return
      }

      const runId = this.activeRunId
      if (this.abortController) this.abortController.abort()
      if (!runId) return

      this.runStatus = 'cancelling'

      if (this.currentStage) this.markStageCancelled(this.currentStage)
      this.markAllRunningAsCancelled()

      try {
        const result = await cancelAgentRun(runId)
        if (result.status) this.runStatus = result.status.toLowerCase()
        await this.refreshRunStatus(runId)
      } catch (error) {
        this.error = error instanceof Error ? error.message : '取消任务失败。'
        this.status = 'error'
      }
    },
    resetChat(): void {
      if (this.isStreaming) return
      const session = this.ensureActiveSession()
      session.messages = []
      session.title = DEFAULT_SESSION_TITLE
      session.updatedAt = Date.now()
      this.error = ''
      this.status = 'idle'
      this.runStatus = 'idle'
      this.currentStage = ''
      this.activeRunId = null
      this.resetStageProgress()
    },
    async refreshRunStatus(runId: string): Promise<void> {
      try {
        const payload = await getRunStatus(runId)
        this.runStatus = getStatusFromPayload(payload)
        const stage = getCurrentStageFromPayload(payload)
        if (stage) this.currentStage = stage
        this.finalizeStreamingByRunStatus()
      } catch {
        // ignore temporary status query failures
      }
    },
    async pollRunStatus(runId: string, signal: AbortSignal): Promise<void> {
      while (!signal.aborted && this.activeRunId === runId && !isTerminalRunStatus(this.runStatus)) {
        await this.refreshRunStatus(runId)
        await delay(1200, signal)
      }
    },
  },
})
