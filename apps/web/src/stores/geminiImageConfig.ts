import { store } from '@/utils/storage'

export const useGeminiImageConfigStore = defineStore(`GeminiImageConfig`, () => {
  const enabled = store.reactive<boolean>(`gemini_image_enabled`, true)
  const endpoint = store.reactive<string>(`gemini_image_endpoint`, `http://127.0.0.1:8800`)
  const model = store.reactive<string>(`gemini_image_model`, `gemini-3-pro-image-preview`)
  const apiKey = store.reactive<string>(`gemini_image_key`, ``)

  const reset = async () => {
    enabled.value = false
    endpoint.value = `http://127.0.0.1:8800`
    model.value = `gemini-3-pro-image-preview`
    apiKey.value = ``
  }

  return {
    enabled,
    endpoint,
    model,
    apiKey,
    reset,
  }
})

export default useGeminiImageConfigStore
