<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useChatStore } from '@/stores/chat'

const chatStore = useChatStore()
const { messages, status, error, isStreaming } = storeToRefs(chatStore)

const inputText = ref('')
const messageContainerRef = ref<HTMLElement | null>(null)
const endpointText = import.meta.env.VITE_AGUI_CHAT_URL ?? '/api/ag-ui/chat'

const statusText = computed(() => {
  if (status.value === 'streaming') {
    return '生成中'
  }
  if (status.value === 'error') {
    return '异常'
  }
  return '就绪'
})

const statusTagType = computed(() => {
  if (status.value === 'streaming') {
    return 'warning'
  }
  if (status.value === 'error') {
    return 'danger'
  }
  return 'success'
})

function roleText(role: string): string {
  if (role === 'user') {
    return '你'
  }
  if (role === 'assistant') {
    return '助手'
  }
  return '系统'
}

async function handleSend(): Promise<void> {
  await chatStore.sendMessage(inputText.value)
  inputText.value = ''
}

function handleStop(): void {
  chatStore.stopStreaming()
}

function handleReset(): void {
  chatStore.resetChat()
}

watch(
  messages,
  async () => {
    await nextTick()
    if (!messageContainerRef.value) {
      return
    }
    messageContainerRef.value.scrollTop = messageContainerRef.value.scrollHeight
  },
  { deep: true },
)
</script>

<template>
  <main class="desktop-chat">
    <aside class="session-sidebar">
      <div class="sidebar-top">
        <h1>Agent 验证台</h1>
        <el-button type="primary" plain size="small" @click="handleReset">新建对话</el-button>
      </div>
      <div class="session-list">
        <div class="session-item active">
          <p class="session-title">当前会话</p>
          <p class="session-meta">AG-UI / SSE 联调</p>
        </div>
      </div>
      <div class="sidebar-foot">
        <el-text size="small" type="info">后端地址</el-text>
        <p>{{ endpointText }}</p>
      </div>
    </aside>

    <section class="chat-workspace">
      <header class="workspace-head">
        <div>
          <h2>聊天窗口</h2>
          <p>用于验证 AG-UI 协议下的流式响应能力</p>
        </div>
        <el-tag size="small" :type="statusTagType">{{ statusText }}</el-tag>
      </header>

      <div ref="messageContainerRef" class="message-scroll">
        <div v-if="messages.length === 0" class="empty-state">
          <h3>开始一段新对话</h3>
          <p>输入需求后，助手会通过 SSE 流式输出分析结果。</p>
        </div>

        <div v-for="item in messages" :key="item.id" class="bubble-row" :class="item.role">
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
          placeholder="请输入你的需求，Ctrl + Enter 发送"
          @keydown.ctrl.enter.prevent="handleSend"
        />
        <div class="composer-actions">
          <el-button type="primary" :disabled="!inputText.trim() || isStreaming" @click="handleSend">发送</el-button>
          <el-button :disabled="!isStreaming" @click="handleStop">停止生成</el-button>
          <el-button text @click="handleReset">清空会话</el-button>
        </div>
      </footer>
    </section>
  </main>
</template>

<style scoped>
.desktop-chat {
  height: 100vh;
  min-width: 1200px;
  display: grid;
  grid-template-columns: 280px 1fr;
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
}

.session-meta {
  margin: 6px 0 0;
  color: #4b5563;
  font-size: 12px;
}

.sidebar-foot {
  border-top: 1px solid #ebeff6;
  padding-top: 12px;
}

.sidebar-foot p {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: #4b5563;
  word-break: break-all;
}

.chat-workspace {
  min-width: 0;
  display: grid;
  grid-template-rows: auto 1fr auto;
  height: 100vh;
}

.workspace-head {
  padding: 20px 30px 14px;
  border-bottom: 1px solid #e3e8f1;
  background: #ffffff;
  display: flex;
  justify-content: space-between;
  align-items: center;
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
  overflow-y: auto;
  padding: 22px 30px;
}

.empty-state {
  width: min(860px, 100%);
  margin: 70px auto 0;
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
