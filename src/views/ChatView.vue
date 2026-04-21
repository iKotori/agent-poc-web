<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useChatStore } from '@/stores/chat'
import type { ChatSession } from '@/types/chat'

const chatStore = useChatStore()
const {
  sessions,
  activeSessionId,
  status,
  error,
  isStreaming,
  activeMessages,
  activeRunId,
  runStatus,
  currentStage,
  workspaceRoot,
  stageProgress,
  historyLoading,
  historyError,
  historyItems,
} = storeToRefs(chatStore)

const inputText = ref('')
const workspaceInput = ref(workspaceRoot.value)
const messageContainerRef = ref<HTMLElement | null>(null)
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '/poc/api'
const eventsEndpointHint = `${apiBaseUrl}/agent/runs/{runId}/events`

const statusText = computed(() => {
  if (status.value === 'streaming') return '生成中'
  if (status.value === 'error') return '异常'
  return '就绪'
})

const statusTagType = computed(() => {
  if (status.value === 'streaming') return 'warning'
  if (status.value === 'error') return 'danger'
  return 'success'
})

const runIdText = computed(() => activeRunId.value ?? '-')

const runStatusTagType = computed(() => {
  const state = (runStatus.value || '').toLowerCase()
  if (state === 'failed') return 'danger'
  if (state === 'cancelled') return 'info'
  if (state === 'cancelling') return 'warning'
  if (state === 'running') return 'primary'
  if (state === 'completed') return 'success'
  return 'info'
})

const runStatusText = computed(() => {
  const state = (runStatus.value || '').toLowerCase()
  if (!state || state === 'idle') return '空闲'
  if (state === 'accepted') return '已接收'
  if (state === 'running') return '执行中'
  if (state === 'cancelling') return '取消中'
  if (state === 'completed') return '已完成'
  if (state === 'failed') return '失败'
  if (state === 'cancelled') return '已取消'
  return state
})

const activeStageNode = computed(() => {
  const running = stageProgress.value.find((item) => item.status === 'running')
  if (running) return running
  if (!currentStage.value) return null
  return stageProgress.value.find((item) => item.key === currentStage.value) ?? null
})

const currentStageText = computed(() => activeStageNode.value?.name ?? '-')
const currentStageDurationText = computed(() => formatDuration(activeStageNode.value?.durationMs ?? null))

const mergedConversationItems = computed(() => {
  const localItems = sessions.value.map((session) => ({
    key: `local:${session.id}`,
    source: 'local' as const,
    title: session.title,
    subtitle: formatSessionMeta(session),
    active: session.id === activeSessionId.value,
    raw: session,
  }))

  const remoteItems = historyItems.value.map((item) => ({
    key: `remote:${item.runId}`,
    source: 'remote' as const,
    title: item.userRequirementPreview || item.runId,
    subtitle: `${item.status}${item.currentStage ? ` · ${item.currentStage}` : ''}`,
    active: false,
    raw: item,
  }))

  return [...localItems, ...remoteItems]
})

function roleText(role: string): string {
  if (role === 'user') return '你'
  if (role === 'assistant') return '助手'
  return '系统'
}

function formatSessionMeta(session: ChatSession): string {
  const time = new Date(session.updatedAt).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${session.messages.length} 条消息 · ${time}`
}

function formatDuration(ms: number | null): string {
  if (typeof ms !== 'number') return '-'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function applyWorkspaceRoot(): void {
  chatStore.setWorkspaceRoot(workspaceInput.value)
}

async function handleSend(): Promise<void> {
  applyWorkspaceRoot()
  await chatStore.sendMessage(inputText.value)
  inputText.value = ''
}

async function handleStop(): Promise<void> {
  await chatStore.stopStreaming()
}

function handleReset(): void {
  chatStore.resetChat()
}

function handleCreateSession(): void {
  chatStore.createSession()
  inputText.value = ''
}

function handleConversationClick(item: (typeof mergedConversationItems.value)[number]): void {
  if (item.source === 'local') {
    const session = item.raw as ChatSession
    chatStore.switchSession(session.id)
  }
}

function handleDeleteSession(sessionId: string): void {
  chatStore.deleteSession(sessionId)
}

async function scrollToBottom(): Promise<void> {
  await nextTick()
  if (!messageContainerRef.value) return
  messageContainerRef.value.scrollTop = messageContainerRef.value.scrollHeight
}

watch(activeMessages, scrollToBottom, { deep: true })
watch(activeSessionId, scrollToBottom)

onMounted(async () => {
  await chatStore.fetchRunHistory()
})
</script>

<template>
  <main class="desktop-chat">
    <aside class="session-sidebar">
      <div class="sidebar-top">
        <h1>Agent 验证台</h1>
        <el-button type="primary" plain size="small" :disabled="isStreaming" @click="handleCreateSession">
          新建对话
        </el-button>
      </div>

      <div class="session-list">
        <div
          v-for="item in mergedConversationItems"
          :key="item.key"
          class="session-item"
          :class="{ active: item.active }"
          @click="handleConversationClick(item)"
        >
          <div class="session-item-top">
            <p class="session-title">{{ item.title }}</p>
            <el-button
              v-if="item.source === 'local'"
              class="session-delete-btn"
              text
              size="small"
              :disabled="isStreaming"
              @click.stop="handleDeleteSession((item.raw as ChatSession).id)"
            >
              删除
            </el-button>
            <el-tag v-else size="small" type="info">历史</el-tag>
          </div>
          <p class="session-meta">{{ item.subtitle }}</p>
        </div>

        <p v-if="historyLoading" class="list-tip">正在加载历史记录...</p>
        <p v-if="historyError" class="list-tip error">{{ historyError }}</p>
      </div>

      <div class="sidebar-foot">
        <el-text size="small" type="info">后端前缀</el-text>
        <p>{{ apiBaseUrl }}</p>

        <el-text size="small" type="info">SSE 接口</el-text>
        <p>{{ eventsEndpointHint }}</p>

        <el-text size="small" type="info">输出工作区</el-text>
        <el-input v-model="workspaceInput" size="small" :disabled="isStreaming" @blur="applyWorkspaceRoot" />
      </div>
    </aside>

    <section class="chat-workspace">
      <header class="workspace-head">
        <div>
          <h2>聊天窗口</h2>
          <p>任务 ID：{{ runIdText }}</p>
          <p>
            任务状态：
            <el-tag size="small" :type="runStatusTagType">{{ runStatusText }}</el-tag>
          </p>
          <p>当前阶段：{{ currentStageText }} ｜ 耗时：{{ currentStageDurationText }}</p>
        </div>
        <el-tag size="small" :type="statusTagType">{{ statusText }}</el-tag>
      </header>

      <div ref="messageContainerRef" class="message-scroll">
        <div v-if="activeMessages.length === 0" class="empty-state">
          <h3>开始一段新对话</h3>
          <p>输入需求后，系统会创建 run 并通过 SSE 推送进度与结果。</p>
        </div>

        <div v-for="item in activeMessages" :key="item.id" class="bubble-row" :class="item.role">
          <div class="role-badge">{{ roleText(item.role) }}</div>
          <div class="bubble">
            {{ item.content || (item.role === 'assistant' && isStreaming ? '正在生成...' : '') }}
          </div>
        </div>
      </div>

      <el-alert v-if="error" class="error-box" :closable="false" type="error" :title="error" />

      <footer class="composer">
        <el-input
          v-model="inputText"
          type="textarea"
          :rows="4"
          :disabled="isStreaming"
          resize="none"
          placeholder="请输入用户需求，Ctrl + Enter 发送"
          @keydown.ctrl.enter.prevent="handleSend"
        />
        <div class="composer-actions">
          <el-button type="primary" :disabled="!inputText.trim() || isStreaming" @click="handleSend">发送</el-button>
          <el-button :disabled="!isStreaming" @click="handleStop">停止生成</el-button>
          <el-button text :disabled="isStreaming" @click="handleReset">清空会话</el-button>
        </div>
      </footer>
    </section>
  </main>
</template>

<style scoped>
.desktop-chat {
  height: 100vh;
  min-width: 1280px;
  display: grid;
  grid-template-columns: 300px 1fr;
  background: #f4f6fb;
}

.session-sidebar {
  border-right: 1px solid #dbe1ec;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  padding: 18px 14px;
}

.sidebar-top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}

.sidebar-top h1 {
  margin: 0;
  font-size: 18px;
  color: #111827;
  font-weight: 600;
}

.session-list {
  margin-top: 18px;
  flex: 1;
  overflow-y: auto;
}

.session-item {
  border-radius: 10px;
  padding: 12px;
  border: 1px solid #e5eaf3;
  background: #f8fafc;
  cursor: pointer;
}

.session-item + .session-item {
  margin-top: 10px;
}

.session-item-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}

.session-delete-btn {
  padding: 2px 4px;
  min-height: 20px;
  color: #6b7280;
}

.session-item.active {
  border-color: #bfd2ff;
  background: #edf3ff;
}

.session-title {
  margin: 0;
  color: #111827;
  font-size: 14px;
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-meta {
  margin: 6px 0 0;
  color: #4b5563;
  font-size: 12px;
}

.list-tip {
  margin: 8px 0 0;
  font-size: 12px;
  color: #6b7280;
}

.list-tip.error {
  color: #dc2626;
}

.sidebar-foot {
  border-top: 1px solid #ebeff6;
  padding-top: 12px;
}

.sidebar-foot p {
  margin: 4px 0 8px;
  font-size: 12px;
  line-height: 1.5;
  color: #4b5563;
  word-break: break-all;
}

.chat-workspace {
  min-width: 0;
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.workspace-head {
  padding: 20px 30px 12px;
  border-bottom: 1px solid #e3e8f1;
  background: #ffffff;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.workspace-head h2 {
  margin: 0;
  color: #111827;
  font-size: 18px;
  font-weight: 600;
}

.workspace-head p {
  margin: 4px 0 0;
  color: #6b7280;
  font-size: 13px;
}

.message-scroll {
  min-width: 0;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 30px;
}

.empty-state {
  width: min(860px, 100%);
  margin: 56px auto 0;
  text-align: center;
  color: #6b7280;
}

.empty-state h3 {
  margin: 0 0 8px;
  font-size: 22px;
  color: #111827;
}

.empty-state p {
  margin: 0;
}

.bubble-row {
  width: min(860px, 100%);
  margin: 0 auto 16px;
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.bubble-row.user {
  flex-direction: row-reverse;
}

.role-badge {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: #374151;
  background: #e6ebf5;
  flex: none;
}

.bubble-row.user .role-badge {
  background: #dbe9ff;
  color: #1d4ed8;
}

.bubble {
  padding: 12px 14px;
  border-radius: 12px;
  background: #ffffff;
  border: 1px solid #e1e7f0;
  color: #111827;
  line-height: 1.7;
  white-space: pre-wrap;
  max-width: calc(100% - 46px);
}

.bubble-row.user .bubble {
  background: #edf4ff;
  border-color: #cedfff;
}

.error-box {
  margin: 0 30px 14px;
}

.composer {
  border-top: 1px solid #e3e8f1;
  background: #ffffff;
  padding: 14px 30px 20px;
}

.composer-actions {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
