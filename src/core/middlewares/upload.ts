import multer from 'multer';

// Configure multer to store uploaded files strictly in memory (RAM Buffer)
const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 Megabytes limit
  },
});

// Helper for the digital signature fields
export const signatureFieldsUpload = upload.fields([
  { name: 'documento', maxCount: 1 },
  { name: 'certificado', maxCount: 1 },
  { name: 'llave', maxCount: 1 },
]);

// Helper for standalone certificate validation (single .cer, 1 MB max)
export const singleCerUpload = multer({
  storage,
  limits: { fileSize: 1 * 1024 * 1024 }, // 1 MB — suficiente para cualquier .cer
}).single('certificado');

// Helper for stamped document upload (single file, 20 MB max)
export const singleStampedUpload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
}).single('stamped');

// Helper for signature request document upload (single 'documento' field, 20 MB max)
export const signatureRequestDocUpload = upload.fields([
  { name: 'documento', maxCount: 1 },
]);

