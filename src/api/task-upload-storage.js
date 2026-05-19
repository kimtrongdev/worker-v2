const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');

const DEFAULT_UPLOAD_DIR = path.resolve(__dirname, '../../.task-uploads/gemini-flow-images');

const IMAGE_FIELDS = [
  'firstImage',
  'lastImage',
  'ingredientImage1',
  'ingredientImage2',
  'ingredientImage3',
];

function trimToString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function extensionFromMime(mimeType) {
  switch (String(mimeType || '').toLowerCase()) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/avif':
      return 'avif';
    case 'image/jpeg':
    case 'image/jpg':
    default:
      return 'jpg';
  }
}

function sanitizeFileName(fileName, mimeType) {
  const fallback = `image-${Date.now()}.${extensionFromMime(mimeType)}`;
  const base = path.basename(trimToString(fileName) || fallback)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^_+/, '');
  return base || fallback;
}

function extractBase64File(input) {
  if (!input) return null;

  if (typeof input === 'string') {
    const value = input.trim();
    const dataUrlMatch = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (dataUrlMatch) {
      return {
        base64: dataUrlMatch[2],
        mimeType: dataUrlMatch[1].toLowerCase(),
        fileName: '',
      };
    }
    return null;
  }

  if (typeof input !== 'object' || Array.isArray(input)) return null;

  const base64 = trimToString(
    input.base64
    || input.base_64
    || input.imageBase64
    || input.image_base64
    || input.dataUrl
    || input.data_url,
  );
  if (!base64) return null;

  const dataUrlMatch = base64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  const mimeType = trimToString(
    input.mimeType
    || input.mime_type
    || input.contentType
    || input.content_type
    || (dataUrlMatch ? dataUrlMatch[1] : ''),
  ).toLowerCase() || 'image/jpeg';

  return {
    base64: dataUrlMatch ? dataUrlMatch[2] : base64,
    mimeType,
    fileName: trimToString(input.fileName || input.file_name || input.name || input.originalName || input.original_name),
  };
}

function stripImageMetadataFields(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => stripImageMetadataFields(item));

  const next = { ...value };
  delete next.mimeType;
  delete next.mime_type;
  delete next.fileName;
  delete next.file_name;
  return next;
}

async function persistBase64Image(input, { uploadDir = DEFAULT_UPLOAD_DIR, slot = 'image' } = {}) {
  const extracted = extractBase64File(input);
  if (!extracted) return stripImageMetadataFields(input);

  const cleanBase64 = extracted.base64.replace(/\s+/g, '');
  const buffer = Buffer.from(cleanBase64, 'base64');
  if (!buffer.length) {
    throw new Error(`Invalid empty base64 image for ${slot}`);
  }

  const fileName = sanitizeFileName(extracted.fileName, extracted.mimeType);
  const storedFileName = `${Date.now()}-${randomUUID()}-${fileName}`;
  const filePath = path.join(uploadDir, storedFileName);

  await fs.mkdir(uploadDir, { recursive: true });
  await fs.writeFile(filePath, buffer);

  return {
    filepath: filePath,
    filePath,
    size: buffer.length,
    storedAt: Date.now(),
    source: 'create-task-base64-upload',
  };
}

async function persistImageField(data, fieldName) {
  if (!data || !Object.prototype.hasOwnProperty.call(data, fieldName)) return;
  data[fieldName] = await persistBase64Image(data[fieldName], { slot: fieldName });
}

async function persistReferenceImages(data) {
  if (!data || !Array.isArray(data.referenceImages)) return;
  const persisted = [];
  for (let idx = 0; idx < data.referenceImages.length; idx += 1) {
    persisted.push(await persistBase64Image(data.referenceImages[idx], { slot: `referenceImages[${idx}]` }));
  }
  data.referenceImages = persisted;
}

async function persistGeminiFlowImageInputs(data = {}) {
  const nextData = { ...data };
  delete nextData.resolution;
  for (const fieldName of IMAGE_FIELDS) {
    await persistImageField(nextData, fieldName);
  }
  await persistReferenceImages(nextData);
  return nextData;
}

module.exports = {
  persistGeminiFlowImageInputs,
  persistBase64Image,
  DEFAULT_UPLOAD_DIR,
};
