<script setup lang="ts">
import { Info } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { Switch } from '@/components/ui/switch'
import useGeminiImageConfigStore from '@/stores/geminiImageConfig'
import { store } from '@/utils/storage'

const emit = defineEmits([`saved`])

const geminiConfigStore = useGeminiImageConfigStore()
const { enabled, endpoint, model, apiKey } = storeToRefs(geminiConfigStore)

const loading = ref(false)
const testResult = ref(``)

watch([enabled, endpoint, model, apiKey], () => {
  testResult.value = ``
})

function saveConfig() {
  if (!endpoint.value.trim() || !model.value.trim()) {
    testResult.value = `请检查配置项是否完整`
    return
  }

  try {
    // eslint-disable-next-line no-new
    new URL(endpoint.value)
  }
  catch {
    testResult.value = `端点格式有误`
    return
  }

  testResult.value = `配置已保存`
  emit(`saved`)
}

function clearConfig() {
  geminiConfigStore.reset()
  testResult.value = `Gemini 配置已清除`
}

async function testConnection() {
  testResult.value = ``
  loading.value = true

  try {
    const url = new URL(endpoint.value)
    if (!url.pathname.includes(`/images/`) && !url.pathname.endsWith(`/images/generations`)) {
      url.pathname = url.pathname.replace(/\/?$/, `/images/generations`)
    }

    const headers: Record<string, string> = { 'Content-Type': `application/json` }
    if (apiKey.value.trim()) {
      headers[`x-goog-api-key`] = apiKey.value.trim()
    }

    const ossConfig = await store.getJSON(`aliOSSConfig`, null)
    const payload: Record<string, any> = {
      model: model.value,
      prompt: `test connection`,
      n: 1,
    }
    if (ossConfig) {
      payload.ossConfig = ossConfig
    }

    const res = await window.fetch(url.toString(), {
      method: `POST`,
      headers,
      body: JSON.stringify(payload),
    })

    if (res.ok) {
      testResult.value = `连接成功`
    }
    else {
      const errorText = await res.text()
      testResult.value = `连接失败：${res.status} ${errorText}`
    }
  }
  catch (error) {
    testResult.value = `连接失败：${(error as Error).message}`
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="space-y-4 max-w-full">
    <div class="text-lg font-semibold border-b pb-2">
      Gemini 图像生成配置
    </div>

    <div class="flex items-center justify-between gap-3 rounded-md border p-3">
      <div>
        <Label class="text-sm font-medium">启用 Gemini 后端</Label>
        <p class="text-xs text-muted-foreground mt-1">
          开启后，文生图请求将走 Gemini 后端接口
        </p>
      </div>
      <Switch v-model:checked="enabled" />
    </div>

    <div>
      <Label class="mb-1 block text-sm font-medium">API 端点</Label>
      <input
        v-model="endpoint"
        type="url"
        class="w-full mt-1 p-2 border rounded-md bg-background focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
        placeholder="http://127.0.0.1:8800"
      >
    </div>

    <div>
      <Label class="mb-1 block text-sm font-medium">模型</Label>
      <input
        v-model="model"
        type="text"
        class="w-full mt-1 p-2 border rounded-md bg-background focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
        placeholder="gemini-3-pro-image-preview"
      >
    </div>

    <div>
      <Label class="mb-1 block text-sm font-medium">API Key（可选）</Label>
      <PasswordInput
        v-model="apiKey"
        class="w-full mt-1 focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
        placeholder="留空则由后端环境变量提供"
      />
    </div>

    <div class="flex items-start gap-2 p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-md text-sm">
      <Info class="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
      <div class="text-emerald-700 dark:text-emerald-300">
        <p class="font-medium">
          推荐后端持有 Key
        </p>
        <p>后端已支持 Gemini 模型，API Key 可通过环境变量注入，前端可留空。</p>
      </div>
    </div>

    <div class="flex flex-wrap gap-2">
      <Button
        type="button"
        class="flex-1 min-w-[100px]"
        @click="saveConfig"
      >
        保存配置
      </Button>
      <Button
        variant="outline"
        type="button"
        class="flex-1 min-w-[80px]"
        @click="clearConfig"
      >
        清空
      </Button>
      <Button
        size="sm"
        variant="outline"
        class="flex-1 min-w-[100px]"
        :disabled="loading"
        @click="testConnection"
      >
        {{ loading ? '测试中...' : '测试连接' }}
      </Button>
    </div>

    <div v-if="testResult" class="mt-1 text-xs text-gray-500">
      {{ testResult }}
    </div>
  </div>
</template>
