import type { Request } from 'express';
import multer from 'multer';
import type { FileFilterCallback } from 'multer';

const storage = multer.memoryStorage();

const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback
) => {
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, JPEG, and PNG are allowed.'));
  }
};

const imageOnlyFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback
) => {
  const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'image/gif', 'image/webp'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only images (JPEG, PNG, GIF, WebP) are allowed.'));
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

export function uploadSingle(fieldName = 'file') {
  return upload.single(fieldName);
}

const uploadImageOnly = multer({
  storage: multer.memoryStorage(),
  fileFilter: imageOnlyFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

export function uploadSingleImage(fieldName = 'file') {
  return uploadImageOnly.single(fieldName);
}
