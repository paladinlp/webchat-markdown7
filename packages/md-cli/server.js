import express from 'express'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import OSS from 'ali-oss'
import { createProxyMiddleware } from 'http-proxy-middleware'
import {
  dcloud,
  parseArgv,
  colors
} from './util.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const arg = parseArgv()

// unicloud 服务空间配置
const spaceInfo = {
  spaceId: ``,
  clientSecret: ``,
  ...arg,
}

const GEMINI_API_HOST = `https://generativelanguage.googleapis.com/v1beta/models`
const DEFAULT_GEMINI_IMAGE_MODEL = `gemini-3-pro-image-preview`
const DEFAULT_ALI_OSS_BASE_PATH = `ai-images`
const AI_IMAGE_RECORD_DIR = path.join(__dirname, 'data/ai-images')

function resolveGeminiApiKey(req) {
  if (process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY
  }
  const headerKey = req.headers[`x-goog-api-key`]
  if (headerKey) {
    return headerKey
  }
  const auth = req.headers.authorization || ``
  if (auth.startsWith(`Bearer `)) {
    return auth.replace(/^Bearer\s+/i, ``).trim()
  }
  return ``
}

function setCorsHeaders(res, origin) {
  res.setHeader(`Access-Control-Allow-Origin`, origin || `*`)
  res.setHeader(`Access-Control-Allow-Methods`, `POST, GET, OPTIONS`)
  res.setHeader(`Access-Control-Allow-Headers`, `Content-Type, Authorization, x-goog-api-key`)
}

function extractInlineImageData(payload) {
  const candidates = payload?.candidates || []
  for (const candidate of candidates) {
    const parts = candidate?.content?.parts || []
    for (const part of parts) {
      // 支持两种命名格式：snake_case (inline_data) 和 camelCase (inlineData)
      const inlineData = part?.inline_data || part?.inlineData
      const mimeType = inlineData?.mime_type || inlineData?.mimeType
      if (inlineData?.data && mimeType?.startsWith?.(`image/`)) {
        return {
          data: inlineData.data,
          mimeType: mimeType,
        }
      }
    }
  }
  return null
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function normalizePath(value) {
  return String(value || ``).replace(/^\/+|\/+$/g, ``)
}

function getDateParts(date = new Date()) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, `0`)
  const day = `${date.getDate()}`.padStart(2, `0`)
  return {
    dir: `${year}/${month}/${day}`,
    key: `${year}-${month}-${day}`,
  }
}

function buildAliOssConfig(override = {}) {
  const useSSLFromEnv = process.env.ALI_OSS_USE_SSL
  const useSSLFromArg = typeof arg.aliUseSSL === `boolean`
    ? arg.aliUseSSL
    : (typeof arg.aliOSSUseSSL === `boolean` ? arg.aliOSSUseSSL : undefined)

  const useSSLFromOverride = typeof override.useSSL === `boolean` ? override.useSSL : undefined
  const useSSL = typeof useSSLFromOverride === `boolean`
    ? useSSLFromOverride
    : (
      typeof useSSLFromEnv === `string`
        ? useSSLFromEnv !== `false` && useSSLFromEnv !== `0`
        : (useSSLFromArg ?? true)
    )

  const basePath = normalizePath(
    override.path
      || process.env.ALI_OSS_PATH
      || arg.aliPath
      || arg.aliOSSPath
      || DEFAULT_ALI_OSS_BASE_PATH,
  )

  return {
    region: override.region || process.env.ALI_OSS_REGION || arg.aliRegion || arg.aliOSSRegion || ``,
    bucket: override.bucket || process.env.ALI_OSS_BUCKET || arg.aliBucket || arg.aliOSSBucket || ``,
    accessKeyId: override.accessKeyId || process.env.ALI_OSS_ACCESS_KEY_ID || arg.aliAccessKeyId || arg.aliOSSAccessKeyId || ``,
    accessKeySecret: override.accessKeySecret || process.env.ALI_OSS_ACCESS_KEY_SECRET || arg.aliAccessKeySecret || arg.aliOSSAccessKeySecret || ``,
    cdnHost: override.cdnHost || process.env.ALI_OSS_CDN_HOST || arg.aliCdnHost || arg.aliOSSCdnHost || ``,
    useSSL,
    basePath,
  }
}

function ensureAliOssConfig(config) {
  const missing = []
  if (!config.region)
    missing.push(`region`)
  if (!config.bucket)
    missing.push(`bucket`)
  if (!config.accessKeyId)
    missing.push(`accessKeyId`)
  if (!config.accessKeySecret)
    missing.push(`accessKeySecret`)
  if (missing.length > 0) {
    throw new Error(`Ali OSS config missing: ${missing.join(', ')}`)
  }
}

function stripDataUrl(value) {
  const str = String(value || ``)
  if (str.startsWith(`data:`)) {
    const idx = str.indexOf(`base64,`)
    return idx === -1 ? str : str.slice(idx + 7)
  }
  return str
}

function getImageExtension(mimeType) {
  if (mimeType === `image/jpeg`)
    return `jpg`
  if (mimeType === `image/webp`)
    return `webp`
  return `png`
}

function createImageFilename(extension) {
  const timestamp = Date.now()
  const rand = Math.random().toString(16).slice(2, 8)
  return `${timestamp}-${rand}.${extension}`
}

async function uploadImageToAliOss({ data, mimeType, ossConfig }) {
  const config = buildAliOssConfig(ossConfig || {})
  ensureAliOssConfig(config)

  const { dir } = getDateParts()
  const extension = getImageExtension(mimeType)
  const filename = createImageFilename(extension)
  const basePath = config.basePath || DEFAULT_ALI_OSS_BASE_PATH
  const objectKey = [basePath, dir, filename].filter(Boolean).join(`/`)

  const client = new OSS({
    region: config.region,
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    secure: config.useSSL,
  })

  const buffer = Buffer.from(stripDataUrl(data), `base64`)
  await client.put(objectKey, buffer, {
    mime: mimeType,
    headers: {
      'Content-Type': mimeType,
    },
  })

  if (config.cdnHost) {
    return `${config.cdnHost.replace(/\/+$/g, ``)}/${objectKey}`
  }

  const protocol = config.useSSL ? `https` : `http`
  return `${protocol}://${config.bucket}.${config.region}.aliyuncs.com/${objectKey}`
}

function recordAiImage({ url, prompt, model }) {
  ensureDir(AI_IMAGE_RECORD_DIR)
  const { key } = getDateParts()
  const record = {
    url,
    prompt,
    model,
    createdAt: new Date().toISOString(),
  }
  const recordFile = path.join(AI_IMAGE_RECORD_DIR, `${key}.jsonl`)
  fs.appendFileSync(recordFile, `${JSON.stringify(record)}\n`)
}

function listAiImageDates() {
  if (!fs.existsSync(AI_IMAGE_RECORD_DIR))
    return []
  return fs.readdirSync(AI_IMAGE_RECORD_DIR)
    .filter(name => name.endsWith(`.jsonl`))
    .map(name => name.replace(/\.jsonl$/, ``))
    .sort()
}

function readAiImagesByDate(dateKey) {
  const filePath = path.join(AI_IMAGE_RECORD_DIR, `${dateKey}.jsonl`)
  if (!fs.existsSync(filePath))
    return []
  const content = fs.readFileSync(filePath, `utf8`)
  return content
    .split(`\n`)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line)
      }
      catch {
        return null
      }
    })
    .filter(Boolean)
}

/**
 * 创建 Express 服务器
 * @param {number} port - 服务器端口
 */
export function createServer(port = 8800) {
  const app = express()

  // 确保上传目录存在
  const uploadDir = path.join(__dirname, 'public/upload')
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true })
  }

  // 配置 multer 用于文件上传
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadDir)
    },
    filename: (req, file, cb) => {
      cb(null, file.originalname)
    }
  })

  const upload = multer({ storage })

  // 中间件
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))

  app.use('/public', express.static(path.join(__dirname, 'public')))

  app.options('/images/generations', (req, res) => {
    setCorsHeaders(res, req.headers.origin)
    res.sendStatus(204)
  })

  // Gemini 文生图 API（兼容 OpenAI /images/generations）
  app.post('/images/generations', async (req, res) => {
    setCorsHeaders(res, req.headers.origin)

    try {
      const prompt = String(req.body?.prompt || ``).trim()
      if (!prompt) {
        return res.status(400).json({ error: 'Missing prompt' })
      }

      const apiKey = resolveGeminiApiKey(req)
      if (!apiKey) {
        return res.status(401).json({ error: 'Missing Gemini API key' })
      }

      const requestedCount = Number(req.body?.n || 1)
      const count = Number.isFinite(requestedCount)
        ? Math.min(Math.max(requestedCount, 1), 4)
        : 1
      const model = String(req.body?.model || process.env.GEMINI_IMAGE_MODEL || DEFAULT_GEMINI_IMAGE_MODEL).trim()
        || DEFAULT_GEMINI_IMAGE_MODEL

      const images = []
      for (let i = 0; i < count; i++) {
        const geminiRes = await fetch(`${GEMINI_API_HOST}/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt },
                ],
              },
            ],
          }),
        })

        if (!geminiRes.ok) {
          const errorText = await geminiRes.text()
          return res.status(geminiRes.status).send(errorText)
        }

        const result = await geminiRes.json()
        console.log('Gemini response:', JSON.stringify(result, null, 2))
        const imagePayload = extractInlineImageData(result)
        if (!imagePayload?.data) {
          console.log('No image data found in response')
          return res.status(502).json({ error: 'No image data returned from Gemini', response: result })
        }

        const imageUrl = await uploadImageToAliOss({
          data: imagePayload.data,
          mimeType: imagePayload.mimeType,
          ossConfig: req.body?.ossConfig || null,
        })

        recordAiImage({ url: imageUrl, prompt, model })
        images.push({ url: imageUrl })
      }

      return res.json({
        created: Date.now(),
        data: images,
      })
    } catch (error) {
      console.error('Gemini image generation error:', error)
      return res.status(500).json({ error: error.message })
    }
  })

  app.options('/ai/images', (req, res) => {
    setCorsHeaders(res, req.headers.origin)
    res.sendStatus(204)
  })

  app.get('/ai/images', (req, res) => {
    setCorsHeaders(res, req.headers.origin)

    const date = String(req.query?.date || ``).trim()
    if (date) {
      return res.json({
        date,
        items: readAiImagesByDate(date),
      })
    }

    return res.json({
      dates: listAiImageDates(),
    })
  })

  // 文件上传 API
  app.post('/upload', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' })
      }

      const file = req.file
      let url = `http://127.0.0.1:${port}/public/upload/${file.filename}`

      try {
        if (spaceInfo.spaceId && spaceInfo.clientSecret) {
          url = await dcloud(spaceInfo)({
            name: file.originalname,
            file: fs.createReadStream(file.path)
          })

          // 上传成功后删除本地临时文件
          fs.unlinkSync(file.path)
          console.log('文件已上传到云端:', url)
        } else {
          console.log(`${colors.yellow('未配置云存储，降级到本地存储')}`)
        }
      } catch (err) {
        // 云上传失败，降级到本地存储
        console.log('云存储上传失败，降级到本地存储:', err.message)
      }

      res.json({ url })
    } catch (error) {
      console.error('Upload error:', error)
      res.status(500).json({ error: error.message })
    }
  })

  console.log('代理到: https://md.doocs.org/')
  app.use(createProxyMiddleware({
    target: 'https://md.doocs.org/',
    changeOrigin: true,
    on: {
      error: (err, req, res) => {
        console.error(`代理错误 ${req.path}:`, err)
        res.status(502).send(`代理服务暂不可用，请检查网络连接 ${err.message}`)
      },
    },
  }))

  return app
}
