import multer from 'multer';

// Configure multer for memory storage (we'll upload directly to R2)
const storage = multer.memoryStorage();

// File filter (documents: PDF + images)
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, JPEG, and PNG are allowed.'), false);
  }
};

// Image-only filter for notice picture uploads
const imageOnlyFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'image/gif', 'image/webp'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only images (JPEG, PNG, GIF, WebP) are allowed.'), false);
  }
};

// Multer configuration
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

// Middleware for single file upload
export const uploadSingle = (fieldName = 'file') => {
  return upload.single(fieldName);
};

const uploadImageOnly = multer({
  storage: multer.memoryStorage(),
  fileFilter: imageOnlyFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

export const uploadSingleImage = (fieldName = 'file') => uploadImageOnly.single(fieldName);
