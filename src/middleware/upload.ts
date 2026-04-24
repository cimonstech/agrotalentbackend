import type { RequestHandler } from 'express'
import multer from 'multer'
import type { FileFilterCallback } from 'multer'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import fs from 'fs'
import { fileTypeFromBuffer } from 'file-type'

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, os.tmpdir())
  },
  filename: (_req, file, cb) => {
    const uniqueName = crypto.randomUUID() + path.extname(file.originalname)
    cb(null, uniqueName)
  },
})

const fileFilter = (
  _req: Express.Request,
  file: Express.Multer.File,
  cb: FileFilterCallback
) => {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(new Error('File type not allowed'))
    return
  }
  cb(null, true)
}

const imageOnlyFilter = (
  _req: Express.Request,
  file: Express.Multer.File,
  cb: FileFilterCallback
) => {
  if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
    cb(new Error('Only images (JPEG, PNG, GIF, WebP) are allowed.'))
    return
  }
  cb(null, true)
}

async function validateMagicBytes(filePath: string, expectedMime: string): Promise<boolean> {
  const handle = await fs.promises.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(4100)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const detected = await fileTypeFromBuffer(buffer.subarray(0, bytesRead))
    if (!detected) return expectedMime === 'application/pdf'
    if (expectedMime === 'image/jpg') return detected.mime === 'image/jpeg'
    return detected.mime === expectedMime
  } finally {
    await handle.close()
  }
}

function withMagicValidation(singleUpload: RequestHandler): RequestHandler {
  return (req, res, next) => {
    singleUpload(req, res, async (err) => {
      if (err) {
        next(err)
        return
      }
      try {
        if (req.file?.path) {
          const ok = await validateMagicBytes(req.file.path, req.file.mimetype)
          if (!ok) {
            fs.unlink(req.file.path, () => {})
            next(new Error('File content does not match MIME type'))
            return
          }
        }
        next()
      } catch (validationErr) {
        if (req.file?.path) fs.unlink(req.file.path, () => {})
        next(validationErr)
      }
    })
  }
}

export const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter,
})

export function uploadSingle(fieldName = 'file') {
  return withMagicValidation(upload.single(fieldName))
}

const uploadImageOnly = multer({
  storage,
  fileFilter: imageOnlyFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
})

export function uploadSingleImage(fieldName = 'file') {
  return withMagicValidation(uploadImageOnly.single(fieldName))
}
