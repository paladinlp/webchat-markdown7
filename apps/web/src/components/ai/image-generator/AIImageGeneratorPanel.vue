<script setup lang="ts">
import {
  Copy,
  Download,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  RefreshCcw,
  Settings,
  Trash2,
} from 'lucide-vue-next'
import { computed, onMounted, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import useAIImageConfigStore from '@/stores/aiImageConfig'
import { useEditorStore } from '@/stores/editor'
import useGeminiImageConfigStore from '@/stores/geminiImageConfig'
import { useUIStore } from '@/stores/ui'
import { copyPlain } from '@/utils/clipboard'
import { store } from '@/utils/storage'
import AIImageConfig from './AIImageConfig.vue'
import AIImageGeminiConfig from './AIImageGeminiConfig.vue'

/* ---------- 组件属性 ---------- */
const props = defineProps<{ open: boolean }>()
const emit = defineEmits([`update:open`])

/* ---------- 编辑器引用 ---------- */
const editorStore = useEditorStore()
const { editor } = storeToRefs(editorStore)
const uiStore = useUIStore()
const { toggleAIDialog } = uiStore

/* ---------- 弹窗开关 ---------- */
const dialogVisible = ref(props.open)
watch(() => props.open, (val) => {
  dialogVisible.value = val
  if (val) {
    initializeImages()
  }
})
watch(dialogVisible, val => emit(`update:open`, val))

/* ---------- 状态管理 ---------- */
const configVisible = ref(false)
const loading = ref(false)
const prompt = ref<string>(``)
const lastUsedPrompt = ref<string>(``) // 存储最后一次使用的提示词，用于重新生成
const generatedImages = ref<string[]>([])
const imagePrompts = ref<string[]>([]) // 存储每张图片对应的prompt
const imageTimestamps = ref<number[]>([]) // 存储每张图片的生成时间戳
const abortController = ref<AbortController | null>(null)
const currentImageIndex = ref(0)
const generateRounds = ref(1)
const imagesPerRound = ref(1)
const historyDates = ref<string[]>([])
const selectedDate = ref<string>(``)
const historyLoading = ref(false)
const historyError = ref<string>(``)
const generateError = ref<string>(``)

const maxGenerateRounds = 3
const maxImagesPerRound = 4
const maxTotalImages = 12

const totalPlannedImages = computed(() => generateRounds.value * imagesPerRound.value)
const hasImages = computed(() => generatedImages.value.length > 0)

function clampGenerationSettings() {
  generateRounds.value = Math.min(Math.max(generateRounds.value, 1), maxGenerateRounds)
  imagesPerRound.value = Math.min(Math.max(imagesPerRound.value, 1), maxImagesPerRound)

  const total = generateRounds.value * imagesPerRound.value
  if (total > maxTotalImages) {
    const allowedPerRound = Math.max(1, Math.floor(maxTotalImages / generateRounds.value))
    imagesPerRound.value = Math.min(imagesPerRound.value, allowedPerRound)
  }
}

watch([generateRounds, imagesPerRound], () => {
  clampGenerationSettings()
})

/* ---------- AI 配置 ---------- */
const AIImageConfigStore = useAIImageConfigStore()
const { apiKey, endpoint, model, type, size, quality, style } = storeToRefs(AIImageConfigStore)
const geminiImageConfigStore = useGeminiImageConfigStore()
const {
  enabled: geminiEnabled,
  endpoint: geminiEndpoint,
  model: geminiModel,
  apiKey: geminiApiKey,
} = storeToRefs(geminiImageConfigStore)

async function resolveGeminiOssConfig() {
  const config = await store.getJSON(`aliOSSConfig`, null)
  if (!config) {
    return null
  }
  const {
    region,
    bucket,
    accessKeyId,
    accessKeySecret,
    useSSL,
    cdnHost,
    path,
  } = config

  if (!region || !bucket || !accessKeyId || !accessKeySecret) {
    return null
  }

  return {
    region,
    bucket,
    accessKeyId,
    accessKeySecret,
    useSSL,
    cdnHost,
    path,
  }
}

function resolveImageRequestConfig() {
  const headers: Record<string, string> = { 'Content-Type': `application/json` }
  let endpointValue = endpoint.value
  let modelValue = model.value
  let useGemini = false

  if (geminiEnabled.value) {
    useGemini = true
    endpointValue = geminiEndpoint.value
    modelValue = geminiModel.value
    const key = geminiApiKey.value.trim()
    if (key) {
      headers[`x-goog-api-key`] = key
    }
  }
  else if (apiKey.value && type.value !== `default`) {
    headers.Authorization = `Bearer ${apiKey.value}`
  }

  if (!endpointValue?.trim() || !modelValue?.trim()) {
    return null
  }

  return {
    headers,
    endpointValue,
    modelValue,
    useGemini,
  }
}

function getTodayKey() {
  const date = new Date()
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, `0`)
  const day = `${date.getDate()}`.padStart(2, `0`)
  return `${year}-${month}-${day}`
}

function buildHistoryUrl(dateKey?: string) {
  const url = new URL(geminiEndpoint.value)
  url.pathname = `/ai/images`
  if (dateKey) {
    url.searchParams.set(`date`, dateKey)
  }
  return url
}

function ensureHistoryDate(dateKey: string) {
  if (!dateKey) {
    return
  }
  if (!historyDates.value.includes(dateKey)) {
    historyDates.value = [...historyDates.value, dateKey].sort()
  }
}

async function loadLocalImages() {
  const images = await store.getJSON(`ai_generated_images`, [])
  const prompts = await store.getJSON(`ai_image_prompts`, [])
  const timestamps = await store.getJSON(`ai_image_timestamps`, [])

  generatedImages.value = Array.isArray(images) ? images : []
  imagePrompts.value = Array.isArray(prompts) ? prompts : []
  imageTimestamps.value = Array.isArray(timestamps) ? timestamps : []

  if (generatedImages.value.length < imagePrompts.value.length) {
    imagePrompts.value = imagePrompts.value.slice(0, generatedImages.value.length)
  }
  else if (imagePrompts.value.length < generatedImages.value.length) {
    imagePrompts.value = [
      ...imagePrompts.value,
      ...Array.from({ length: generatedImages.value.length - imagePrompts.value.length }, () => ``),
    ]
  }

  if (generatedImages.value.length < imageTimestamps.value.length) {
    imageTimestamps.value = imageTimestamps.value.slice(0, generatedImages.value.length)
  }
  else if (imageTimestamps.value.length < generatedImages.value.length) {
    imageTimestamps.value = [
      ...imageTimestamps.value,
      ...Array.from({ length: generatedImages.value.length - imageTimestamps.value.length }, () => Date.now()),
    ]
  }

  currentImageIndex.value = 0
}

async function fetchHistoryDates() {
  historyLoading.value = true
  historyError.value = ``
  try {
    const res = await window.fetch(buildHistoryUrl().toString())
    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`${res.status}: ${errorText}`)
    }
    const data = await res.json()
    const dates = Array.isArray(data?.dates) ? data.dates : []
    historyDates.value = dates

    const todayKey = getTodayKey()
    if (!selectedDate.value) {
      selectedDate.value = dates[dates.length - 1] || todayKey
    }
    else if (!dates.includes(selectedDate.value) && selectedDate.value !== todayKey) {
      selectedDate.value = dates[dates.length - 1] || todayKey
    }
  }
  catch (error) {
    historyError.value = `历史记录加载失败：${(error as Error).message}`
  }
  finally {
    historyLoading.value = false
  }
}

async function fetchHistoryByDate(dateKey: string) {
  if (!dateKey) {
    return
  }
  historyLoading.value = true
  historyError.value = ``
  try {
    const res = await window.fetch(buildHistoryUrl(dateKey).toString())
    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`${res.status}: ${errorText}`)
    }
    const data = await res.json()
    const items = Array.isArray(data?.items) ? data.items : []

    generatedImages.value = items.map((item: any) => item?.url).filter(Boolean)
    imagePrompts.value = items.map((item: any) => item?.prompt || ``)
    imageTimestamps.value = items.map((item: any) => {
      const time = Date.parse(item?.createdAt || ``)
      return Number.isFinite(time) ? time : Date.now()
    })
    currentImageIndex.value = 0
  }
  catch (error) {
    historyError.value = `历史记录加载失败：${(error as Error).message}`
  }
  finally {
    historyLoading.value = false
  }
}

async function refreshHistoryDates() {
  if (!geminiEnabled.value) {
    return
  }
  await fetchHistoryDates()
}

async function initializeImages() {
  if (geminiEnabled.value) {
    await refreshHistoryDates()
  }
  else {
    historyDates.value = []
    selectedDate.value = ``
    historyError.value = ``
    await loadLocalImages()
  }
}

/* ---------- 初始数据 ---------- */
onMounted(async () => {
  await initializeImages()
})

watch(geminiEnabled, async () => {
  await initializeImages()
})

watch(selectedDate, async (dateKey) => {
  if (!geminiEnabled.value) {
    return
  }
  await fetchHistoryByDate(dateKey)
})

/* ---------- 事件处理 ---------- */
function handleConfigSaved() {
  configVisible.value = false
}

function switchToChat() {
  // 先关闭当前文生图对话框
  emit(`update:open`, false)
  // 然后打开聊天对话框
  setTimeout(() => {
    toggleAIDialog(true)
  }, 100)
}

function handleKeydown(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229)
    return

  if (e.key === `Enter` && !e.shiftKey) {
    e.preventDefault()
    generateImage()
  }
}

/* ---------- 生成图像 ---------- */
async function generateImage() {
  if (!prompt.value.trim() || loading.value)
    return

  generateError.value = ``
  clampGenerationSettings()

  // 保存当前提示词用于重新生成
  const currentPrompt = prompt.value.trim()
  lastUsedPrompt.value = currentPrompt

  loading.value = true
  abortController.value = new AbortController()

  const requestConfig = resolveImageRequestConfig()
  if (!requestConfig) {
    generateError.value = `配置不完整，请检查 Gemini 配置中的端点和模型设置`
    loading.value = false
    abortController.value = null
    return
  }

  try {
    const url = new URL(requestConfig.endpointValue)
    if (!url.pathname.includes(`/images/`) && !url.pathname.endsWith(`/images/generations`)) {
      url.pathname = url.pathname.replace(/\/?$/, `/images/generations`)
    }

    const newImages: string[] = []
    const newPrompts: string[] = []
    const newTimestamps: number[] = []
    const rounds = generateRounds.value
    const perRound = imagesPerRound.value

    for (let round = 0; round < rounds; round++) {
      if (abortController.value?.signal.aborted) {
        break
      }

      const payload: any = {
        model: requestConfig.modelValue,
        prompt: currentPrompt,
        size: size.value,
        n: perRound,
      }

      if (requestConfig.useGemini) {
        const ossConfig = await resolveGeminiOssConfig()
        if (ossConfig) {
          payload.ossConfig = ossConfig
        }
      }

      // 只对 DALL-E 模型添加额外参数
      if (!requestConfig.useGemini && requestConfig.modelValue.includes(`dall-e`)) {
        payload.quality = quality.value
        payload.style = style.value
      }

      const res = await window.fetch(url.toString(), {
        method: `POST`,
        headers: requestConfig.headers,
        body: JSON.stringify(payload),
        signal: abortController.value.signal,
      })

      if (!res.ok) {
        const errorText = await res.text()
        throw new Error(`${res.status}: ${errorText}`)
      }

      const data = await res.json()

      if (data.data && data.data.length > 0) {
        data.data.forEach((item: { url?: string, b64_json?: string }) => {
          const imageUrl = item.url || item.b64_json
          if (!imageUrl) {
            return
          }
          const finalUrl = imageUrl.startsWith(`data:`) || imageUrl.startsWith(`http`)
            ? imageUrl
            : `data:image/png;base64,${imageUrl}`
          newImages.push(finalUrl)
          newPrompts.push(currentPrompt)
          newTimestamps.push(Date.now())
        })
      }
    }

    if (abortController.value?.signal.aborted && newImages.length === 0) {
      return
    }

    if (newImages.length > 0) {
      generatedImages.value = newImages.concat(generatedImages.value)
      imagePrompts.value = newPrompts.concat(imagePrompts.value)
      imageTimestamps.value = newTimestamps.concat(imageTimestamps.value)
      currentImageIndex.value = 0

      if (requestConfig.useGemini) {
        const todayKey = getTodayKey()
        ensureHistoryDate(todayKey)
        if (selectedDate.value !== todayKey) {
          selectedDate.value = todayKey
        }
      }

      // 非 Gemini 模式限制存储数量，避免占用过多存储空间
      if (!requestConfig.useGemini && generatedImages.value.length > 20) {
        generatedImages.value = generatedImages.value.slice(0, 20)
        imagePrompts.value = imagePrompts.value.slice(0, 20)
        imageTimestamps.value = imageTimestamps.value.slice(0, 20)
      }

      await store.setJSON(`ai_generated_images`, generatedImages.value)
      await store.setJSON(`ai_image_prompts`, imagePrompts.value)
      await store.setJSON(`ai_image_timestamps`, imageTimestamps.value)

      // 清空输入框
      prompt.value = ``
    }
    else {
      throw new Error(`未收到有效的图像数据`)
    }
  }
  catch (e) {
    if ((e as Error).name === `AbortError`) {
      console.log(`图像生成请求中止`)
    }
    else {
      console.error(`图像生成失败:`, e)
      const errorMsg = (e as Error).message || `未知错误`
      // 解析常见错误信息
      if (errorMsg.includes(`Missing Gemini API key`)) {
        generateError.value = `缺少 Gemini API Key。请在配置面板中填入 API Key，或在后端设置 GEMINI_API_KEY 环境变量。`
      }
      else if (errorMsg.includes(`Ali OSS config missing`)) {
        generateError.value = `阿里云 OSS 配置不完整。请在图床设置中配置阿里云 OSS。`
      }
      else {
        generateError.value = `生成失败: ${errorMsg}`
      }
    }
  }
  finally {
    loading.value = false
    abortController.value = null
  }
}

/* ---------- 取消生成 ---------- */
function cancelGeneration() {
  if (abortController.value) {
    abortController.value.abort()
    abortController.value = null
  }
  loading.value = false
}

/* ---------- 清空图像 ---------- */
async function clearImages() {
  generatedImages.value = []
  imagePrompts.value = []
  imageTimestamps.value = []
  currentImageIndex.value = 0
  await store.remove(`ai_generated_images`)
  await store.remove(`ai_image_prompts`)
  await store.remove(`ai_image_timestamps`)
}

/* ---------- 下载图像 ---------- */
async function downloadImage(imageUrl: string, index: number) {
  try {
    const response = await fetch(imageUrl)
    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement(`a`)
    a.href = url

    // 生成包含prompt信息的文件名
    const relatedPrompt = imagePrompts.value[index] || ``
    const promptPart = relatedPrompt
      ? relatedPrompt.substring(0, 20).replace(/[^\w\s-]/g, ``).replace(/\s+/g, `-`)
      : `no-prompt`
    a.download = `ai-image-${index + 1}-${promptPart}.png`

    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.URL.revokeObjectURL(url)
  }
  catch (error) {
    console.error(`下载图像失败:`, error)
  }
}

/* ---------- 复制图像URL ---------- */
async function copyImageUrl(imageUrl: string) {
  try {
    await copyPlain(imageUrl)
    console.log(`✅ 图片链接已复制到剪贴板`)
    if (typeof toast !== `undefined`) {
      toast.success(`图片链接已复制到剪贴板`)
    }
  }
  catch (error) {
    console.error(`❌ 复制失败:`, error)
    if (typeof toast !== `undefined`) {
      toast.error(`复制失败，请重试`)
    }
  }
}

/* ---------- 重新生成 ---------- */
function regenerateImage() {
  // 使用当前图片对应的prompt
  const currentPrompt = imagePrompts.value[currentImageIndex.value]
  if (currentPrompt) {
    console.log(`🔄 重新生成图像，使用当前图片的prompt:`, currentPrompt)
    // 直接使用当前图片的prompt生成，不修改输入框内容
    regenerateWithPrompt(currentPrompt)
  }
  else {
    console.warn(`⚠️ 没有找到当前图片的prompt`)
  }
}

/* ---------- 使用指定prompt重新生成 ---------- */
async function regenerateWithPrompt(promptText: string) {
  if (!promptText.trim() || loading.value)
    return

  loading.value = true
  abortController.value = new AbortController()

  const requestConfig = resolveImageRequestConfig()
  if (!requestConfig) {
    console.error(`图像生成配置不完整`)
    loading.value = false
    abortController.value = null
    return
  }

  try {
    const url = new URL(requestConfig.endpointValue)
    if (!url.pathname.includes(`/images/`) && !url.pathname.endsWith(`/images/generations`)) {
      url.pathname = url.pathname.replace(/\/?$/, `/images/generations`)
    }

    const payload: any = {
      model: requestConfig.modelValue,
      prompt: promptText.trim(),
      size: size.value,
      n: 1,
    }

    if (requestConfig.useGemini) {
      const ossConfig = await resolveGeminiOssConfig()
      if (ossConfig) {
        payload.ossConfig = ossConfig
      }
    }

    // 只对 DALL-E 模型添加额外参数
    if (!requestConfig.useGemini && requestConfig.modelValue.includes(`dall-e`)) {
      payload.quality = quality.value
      payload.style = style.value
    }

    const res = await window.fetch(url.toString(), {
      method: `POST`,
      headers: requestConfig.headers,
      body: JSON.stringify(payload),
      signal: abortController.value.signal,
    })

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`${res.status}: ${errorText}`)
    }

    const data = await res.json()

    if (data.data && data.data.length > 0) {
      const imageUrl = data.data[0].url || data.data[0].b64_json

      if (imageUrl) {
        // 如果是 base64 格式，转换为 data URL
        const finalUrl = imageUrl.startsWith(`data:`) || imageUrl.startsWith(`http`)
          ? imageUrl
          : `data:image/png;base64,${imageUrl}`

        const currentTimestamp = Date.now()

        generatedImages.value.unshift(finalUrl)
        imagePrompts.value.unshift(promptText.trim()) // 保存对应的prompt
        imageTimestamps.value.unshift(currentTimestamp) // 保存生成时间戳
        currentImageIndex.value = 0

        if (requestConfig.useGemini) {
          const todayKey = getTodayKey()
          ensureHistoryDate(todayKey)
          if (selectedDate.value !== todayKey) {
            selectedDate.value = todayKey
          }
        }

        // 非 Gemini 模式限制存储数量，避免占用过多存储空间
        if (!requestConfig.useGemini && generatedImages.value.length > 20) {
          generatedImages.value = generatedImages.value.slice(0, 20)
          imagePrompts.value = imagePrompts.value.slice(0, 20)
          imageTimestamps.value = imageTimestamps.value.slice(0, 20)
        }

        await store.setJSON(`ai_generated_images`, generatedImages.value)
        await store.setJSON(`ai_image_prompts`, imagePrompts.value)
        await store.setJSON(`ai_image_timestamps`, imageTimestamps.value)
      }
    }
    else {
      throw new Error(`未收到有效的图像数据`)
    }
  }
  catch (e) {
    if ((e as Error).name === `AbortError`) {
      console.log(`图像生成请求中止`)
    }
    else {
      console.error(`图像生成失败:`, e)
    }
  }
  finally {
    loading.value = false
    abortController.value = null
  }
}

/* ---------- 切换图像 ---------- */
function _previousImage() {
  if (currentImageIndex.value > 0) {
    currentImageIndex.value--
  }
}

function _nextImage() {
  if (currentImageIndex.value < generatedImages.value.length - 1) {
    currentImageIndex.value++
  }
}

function selectImage(index: number) {
  if (index >= 0 && index < generatedImages.value.length) {
    currentImageIndex.value = index
  }
}

/* ---------- 插入图像到光标位置 ---------- */
function insertImageToCursor(imageUrl: string) {
  if (!editor.value) {
    console.warn(`编辑器未初始化`)
    return
  }

  try {
    // 获取当前图片对应的prompt
    const imagePrompt = imagePrompts.value[currentImageIndex.value] || ``
    console.log(`🔗 插入图片，使用关联的prompt:`, imagePrompt)

    // 生成简洁的alt文本
    const altText = imagePrompt.trim()
      ? imagePrompt.trim().substring(0, 30).replace(/\n/g, ` `)
      : `AI生成的图像`

    // 生成Markdown图片语法
    const markdownImage = `![${altText}](${imageUrl})`

    // 获取当前光标位置并插入
    const pos = editor.value.state.selection.main.head
    editor.value.dispatch({
      changes: { from: pos, insert: markdownImage },
      selection: { anchor: pos + markdownImage.length },
    })

    // 聚焦编辑器
    editor.value.focus()

    // 关闭弹窗
    dialogVisible.value = false

    console.log(`✅ 图像已成功插入到光标位置`)
  }
  catch (error) {
    console.error(`❌ 插入图像到光标位置失败:`, error)
  }
}

/* ---------- 查看大图 ---------- */
function viewFullImage(imageUrl: string) {
  console.log(`🔍 点击查看大图:`, imageUrl)
  if (!imageUrl) {
    console.error(`❌ 图片URL为空`)
    return
  }

  try {
    // 在新窗口中打开图片
    const newWindow = window.open(imageUrl, `_blank`, `width=800,height=600,scrollbars=yes,resizable=yes`)
    if (!newWindow) {
      console.error(`❌ 无法打开新窗口，可能被浏览器阻止`)
      // 备用方案：在当前标签页打开
      window.open(imageUrl, `_blank`)
    }
  }
  catch (error) {
    console.error(`❌ 打开图片失败:`, error)
  }
}

/* ---------- 时间相关函数 ---------- */
function formatTimestamp(index: number): string {
  const timestamp = imageTimestamps.value[index]
  if (!timestamp) {
    return `未知`
  }

  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return `未知`
  }

  return date.toLocaleString(`zh-CN`, { hour12: false })
}
</script>

<template>
  <Dialog v-model:open="dialogVisible">
    <DialogContent
      class="bg-card text-card-foreground flex flex-col w-[95vw] max-h-[90vh] sm:max-h-[85vh] sm:max-w-4xl overflow-y-auto"
    >
      <!-- ============ 头部 ============ -->
      <DialogHeader class="space-y-1 flex flex-col items-start">
        <div class="space-x-1 flex items-center">
          <DialogTitle>AI 文生图</DialogTitle>

          <Button
            :title="configVisible ? 'AI 文生图' : '配置参数'"
            :aria-label="configVisible ? 'AI 文生图' : '配置参数'"
            variant="ghost"
            size="icon"
            @click="configVisible = !configVisible"
          >
            <ImageIcon v-if="configVisible" class="h-4 w-4" />
            <Settings v-else class="h-4 w-4" />
          </Button>

          <Button
            title="AI 对话"
            aria-label="AI 对话"
            variant="ghost"
            size="icon"
            @click="switchToChat()"
          >
            <MessageCircle class="h-4 w-4" />
          </Button>

          <Button
            title="清空图像"
            aria-label="清空图像"
            variant="ghost"
            size="icon"
            @click="clearImages"
          >
            <Trash2 class="h-4 w-4" />
          </Button>
        </div>
        <DialogDescription class="text-muted-foreground text-sm">
          使用 AI 根据文字描述生成图像
        </DialogDescription>
      </DialogHeader>

      <!-- ============ 参数配置面板 ============ -->
      <div
        v-if="configVisible"
        class="mb-4 w-full border rounded-md p-4 max-h-[60vh] overflow-y-auto flex-shrink-0"
      >
        <AIImageConfig @saved="handleConfigSaved" />
        <div class="my-4 border-t" />
        <AIImageGeminiConfig @saved="handleConfigSaved" />
      </div>

      <div v-if="!configVisible" class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <!-- 输入区域 -->
        <div class="rounded-xl border bg-background p-4 shadow-sm">
          <div class="space-y-3">
            <div class="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <NumberField v-model="generateRounds" :min="1" :max="maxGenerateRounds" class="gap-1">
                <Label class="text-xs">调用次数</Label>
                <NumberFieldContent class="w-24">
                  <NumberFieldDecrement />
                  <NumberFieldInput />
                  <NumberFieldIncrement />
                </NumberFieldContent>
              </NumberField>
              <NumberField v-model="imagesPerRound" :min="1" :max="maxImagesPerRound" class="gap-1">
                <Label class="text-xs">每次生成</Label>
                <NumberFieldContent class="w-24">
                  <NumberFieldDecrement />
                  <NumberFieldInput />
                  <NumberFieldIncrement />
                </NumberFieldContent>
              </NumberField>
              <span>预计 {{ totalPlannedImages }} 张</span>
            </div>
            <div class="rounded-lg border bg-muted/10 p-3">
              <Label class="text-xs text-muted-foreground">生成描述</Label>
              <Textarea
                v-model="prompt"
                placeholder="描述你想要生成的图像... (Enter 生成，Shift+Enter 换行)"
                rows="6"
                class="custom-scroll mt-2 min-h-28 w-full resize-none border-none bg-transparent p-0 text-sm focus-visible:outline-hidden focus:outline-hidden focus-visible:ring-0 focus:ring-0 focus-visible:ring-offset-0 focus:ring-offset-0 focus-visible:ring-transparent focus:ring-transparent"
                @keydown="handleKeydown"
              />
            </div>
            <div v-if="generateError" class="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 p-2 rounded">
              {{ generateError }}
            </div>
            <div class="flex items-center justify-between">
              <span class="text-xs text-muted-foreground">
                {{ loading ? '正在生成，请稍候...' : '支持多轮生成，结果可选一张插入' }}
              </span>
              <Button
                :disabled="!prompt.trim() && !loading"
                class="min-w-24"
                @click="loading ? cancelGeneration() : generateImage()"
              >
                <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
                <ImageIcon v-else class="mr-2 h-4 w-4" />
                {{ loading ? '取消' : '生成' }}
              </Button>
            </div>
          </div>
        </div>

        <!-- 预览区域 -->
        <div class="rounded-xl border bg-background p-4 shadow-sm">
          <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <div class="flex items-center gap-2">
              <span>预览</span>
              <span v-if="hasImages">{{ currentImageIndex + 1 }} / {{ generatedImages.length }}</span>
            </div>
            <div v-if="geminiEnabled" class="flex flex-wrap items-center gap-2">
              <span>日期</span>
              <Input
                v-model="selectedDate"
                type="date"
                list="ai-image-history-dates"
                class="h-7 w-36 text-xs"
                :disabled="historyLoading"
              />
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7"
                :disabled="historyLoading"
                @click="refreshHistoryDates"
              >
                <RefreshCcw class="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <datalist id="ai-image-history-dates">
            <option v-for="date in historyDates" :key="date" :value="date" />
          </datalist>
          <div v-if="historyError" class="mt-1 text-xs text-red-500">
            {{ historyError }}
          </div>
          <div class="mt-3 flex items-center justify-center rounded-lg bg-gray-50 dark:bg-gray-800 min-h-[260px]">
            <div v-if="loading" class="flex flex-col items-center gap-4">
              <Loader2 class="h-8 w-8 animate-spin text-primary" />
              <p class="text-sm text-muted-foreground">
                正在生成图像...
              </p>
              <Button
                variant="outline"
                size="sm"
                @click="cancelGeneration"
              >
                取消生成
              </Button>
            </div>
            <div v-else-if="historyLoading" class="text-sm text-muted-foreground">
              正在加载历史图片...
            </div>
            <div v-else-if="!hasImages" class="text-sm text-muted-foreground">
              暂无生成图片
            </div>
            <div v-else class="flex items-center justify-center p-2 sm:p-4">
              <div class="relative group cursor-pointer w-full max-w-sm" @click="viewFullImage(generatedImages[currentImageIndex])">
                <img
                  :src="generatedImages[currentImageIndex]"
                  :alt="`生成的图像 ${currentImageIndex + 1}`"
                  class="w-full h-auto max-h-[300px] object-contain rounded-lg shadow-lg border border-border transition-transform hover:scale-105"
                >
                <div class="absolute inset-0 bg-black/0 group-hover:bg-black/10 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  <div class="bg-black/70 text-white px-3 py-1 rounded-md text-sm">
                    点击查看大图
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-if="hasImages" class="mt-3 space-y-3">
            <div class="text-xs text-muted-foreground">
              <span class="font-medium">提示词:</span>
              <span class="ml-1">{{ imagePrompts[currentImageIndex] || '无关联提示词' }}</span>
            </div>
            <div class="text-xs text-muted-foreground">
              <span class="font-medium">生成时间:</span>
              <span class="ml-1">{{ formatTimestamp(currentImageIndex) }}</span>
            </div>

            <div class="flex flex-wrap justify-center gap-2 border-t border-border pt-3">
              <Button
                variant="outline"
                size="sm"
                class="flex-shrink-0 bg-background text-xs sm:text-sm"
                :disabled="!hasImages"
                @click="insertImageToCursor(generatedImages[currentImageIndex])"
              >
                <ImageIcon class="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                插入
              </Button>
              <Button
                variant="outline"
                size="sm"
                class="flex-shrink-0 bg-background text-xs sm:text-sm"
                :disabled="!hasImages"
                @click="downloadImage(generatedImages[currentImageIndex], currentImageIndex)"
              >
                <Download class="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                下载
              </Button>
              <Button
                variant="outline"
                size="sm"
                class="flex-shrink-0 bg-background text-xs sm:text-sm"
                :disabled="!hasImages"
                @click="copyImageUrl(generatedImages[currentImageIndex])"
              >
                <Copy class="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                复制
              </Button>
              <Button
                variant="outline"
                size="sm"
                class="flex-shrink-0 bg-background text-xs sm:text-sm"
                :disabled="!hasImages"
                @click="regenerateImage"
              >
                <RefreshCcw class="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                重新生成
              </Button>
            </div>

            <div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
              <button
                v-for="(img, index) in generatedImages"
                :key="`${img}-${index}`"
                type="button"
                class="group relative overflow-hidden rounded-md border transition hover:ring-2 hover:ring-primary"
                :class="{ 'ring-2 ring-primary': index === currentImageIndex }"
                @click="selectImage(index)"
              >
                <img
                  :src="img"
                  :alt="`缩略图 ${index + 1}`"
                  class="h-20 w-full object-cover"
                >
                <div class="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.custom-scroll::-webkit-scrollbar {
  width: 6px;
}
@media (pointer: coarse) {
  /* 触屏设备更细 */
  .custom-scroll::-webkit-scrollbar {
    width: 3px;
  }
}

.custom-scroll::-webkit-scrollbar-thumb {
  border-radius: 9999px;
  background-color: rgba(156, 163, 175, 0.4);
}

.custom-scroll::-webkit-scrollbar-thumb:hover {
  background-color: rgba(156, 163, 175, 0.6);
}

html.dark .custom-scroll::-webkit-scrollbar-thumb {
  background-color: rgba(107, 114, 128, 0.4);
}

html.dark .custom-scroll::-webkit-scrollbar-thumb:hover {
  background-color: rgba(107, 114, 128, 0.7);
}

.custom-scroll {
  scrollbar-width: thin;
}
</style>
