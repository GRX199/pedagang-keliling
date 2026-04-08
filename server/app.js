import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import rateLimit from 'express-rate-limit'
import multer from 'multer'
import { createClient } from '@supabase/supabase-js'

dotenv.config()

const app = express()
const PORT = Number(process.env.PORT || 4000)
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BUCKET = process.env.SUPABASE_BUCKET || 'data'
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024)

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
])

const ALLOWED_UPLOAD_FOLDERS = new Set(['products', 'profiles'])

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const rawAllowedOrigins = process.env.CORS_ORIGIN || 'http://localhost:5173'
const allowedOrigins = rawAllowedOrigins === '*'
  ? '*'
  : rawAllowedOrigins.split(',').map((origin) => origin.trim()).filter(Boolean)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
  },
  fileFilter(_req, file, callback) {
    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      callback(new Error('File harus berupa gambar JPG, PNG, WEBP, atau GIF'))
      return
    }

    callback(null, true)
  },
})

app.use(cors({
  origin(origin, callback) {
    if (allowedOrigins === '*' || !origin || allowedOrigins.includes(origin)) {
      callback(null, true)
      return
    }

    callback(new Error('Origin not allowed by CORS'))
  },
}))

app.use(express.json({ limit: '1mb' }))

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
}))

function sanitizeFilename(filename) {
  return String(filename || 'upload')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'upload'
}

function normalizeUploadFolder(folder) {
  const normalizedFolder = String(folder || 'products').trim().toLowerCase()
  if (!ALLOWED_UPLOAD_FOLDERS.has(normalizedFolder)) {
    throw new Error('Folder upload tidak valid')
  }

  return normalizedFolder
}

function extractAccessToken(req) {
  const authorizationHeader = req.headers?.authorization || req.headers?.Authorization
  if (!authorizationHeader) return null

  const [scheme, token] = authorizationHeader.split(' ')
  if (!/^Bearer$/i.test(scheme) || !token) return null

  return token
}

async function getAuthenticatedUser(req, res) {
  const token = extractAccessToken(req)
  if (!token) {
    res.status(401).json({ error: 'Missing authorization token' })
    return null
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data?.user) {
    console.error('auth.getUser failed', error)
    res.status(401).json({ error: 'Invalid token' })
    return null
  }

  return data.user
}

async function uploadBufferToStorage({ file, userId, folder }) {
  const filepath = `vendors/${userId}/${folder}/${Date.now()}-${sanitizeFilename(file.originalname)}`

  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(filepath, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    })

  if (uploadError) throw uploadError

  const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(filepath)
  return {
    filepath,
    imageUrl: data?.publicUrl || null,
  }
}

app.get('/', (_req, res) => {
  res.json({ ok: true })
})

app.post('/upload-only', upload.single('file'), async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req, res)
    if (!user) return
    if (!req.file) {
      res.status(400).json({ error: 'File gambar wajib diunggah' })
      return
    }

    const folder = normalizeUploadFolder(req.body?.folder)
    const payload = await uploadBufferToStorage({
      file: req.file,
      userId: user.id,
      folder,
    })

    res.json({
      path: payload.filepath,
      imageUrl: payload.imageUrl,
    })
  } catch (error) {
    console.error('upload-only unexpected', error)
    res.status(500).json({ error: error.message || 'Gagal mengunggah file' })
  }
})

app.post('/upload-product', upload.single('file'), async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req, res)
    if (!user) return

    const productName = String(req.body?.name || '').trim()
    if (!productName) {
      res.status(400).json({ error: 'Nama produk wajib diisi' })
      return
    }

    let imageUrl = null
    if (req.file) {
      const payload = await uploadBufferToStorage({
        file: req.file,
        userId: user.id,
        folder: 'products',
      })
      imageUrl = payload.imageUrl
    }

    const { data, error } = await supabaseAdmin
      .from('products')
      .insert([{
        vendor_id: user.id,
        name: productName,
        description: String(req.body?.description || '').trim() || null,
        price: req.body?.price ? Number(req.body.price) : null,
        image_url: imageUrl,
      }])
      .select()
      .single()

    if (error) throw error

    res.json({
      success: true,
      product: data,
      imageUrl,
    })
  } catch (error) {
    console.error('upload-product unexpected', error)
    res.status(500).json({ error: error.message || 'Gagal membuat produk' })
  }
})

app.post(['/vendor/:id/online', '/api/vendor/:id/online'], async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req, res)
    if (!user) return

    const vendorId = req.params.id
    const { data: vendorRow, error: vendorError } = await supabaseAdmin
      .from('vendors')
      .select('id, user_id, online')
      .eq('id', vendorId)
      .maybeSingle()

    if (vendorError) throw vendorError
    if (!vendorRow) {
      res.status(404).json({ error: 'Vendor tidak ditemukan' })
      return
    }

    if (!vendorRow.user_id || vendorRow.user_id !== user.id) {
      res.status(403).json({ error: 'Anda tidak punya akses untuk mengubah status toko ini' })
      return
    }

    const nextStatus = typeof req.body?.online === 'boolean'
      ? req.body.online
      : !Boolean(vendorRow.online)

    const { data, error } = await supabaseAdmin
      .from('vendors')
      .update({ online: nextStatus })
      .eq('id', vendorId)
      .select()
      .maybeSingle()

    if (error) throw error

    res.json({
      ok: true,
      online: data?.online ?? nextStatus,
      vendor: data,
    })
  } catch (error) {
    console.error('vendor online unexpected', error)
    res.status(500).json({ error: error.message || 'Gagal memperbarui status toko' })
  }
})

app.use((error, _req, res, next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({ error: `Ukuran gambar maksimal ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB` })
    return
  }

  if (error?.message === 'Origin not allowed by CORS') {
    res.status(403).json({ error: error.message })
    return
  }

  if (error?.message?.includes('File harus berupa gambar')) {
    res.status(400).json({ error: error.message })
    return
  }

  next(error)
})

app.listen(PORT, () => {
  console.log(`API server listening on ${PORT}`)
})
