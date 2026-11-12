// On-device resize: full-resolution camera JPEG -> ~2048 px JPEG for storage
// and upload, plus a small thumbnail for lists. Drawing through an <img>
// applies EXIF orientation in current Safari and Chrome.

export const PHOTO_MAX_EDGE = 2048;
export const PHOTO_QUALITY = 0.8;
const THUMB_MAX_EDGE = 360;
const THUMB_QUALITY = 0.7;

export async function processPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w0 = img.naturalWidth;
    const h0 = img.naturalHeight;
    if (!w0 || !h0) throw new Error('Could not read image');
    const main = await drawScaled(img, w0, h0, PHOTO_MAX_EDGE, PHOTO_QUALITY);
    const thumb = await drawScaled(img, w0, h0, THUMB_MAX_EDGE, THUMB_QUALITY);
    return {
      blob: main.blob,
      width: main.width,
      height: main.height,
      thumb: thumb.blob,
      original_width: w0,
      original_height: h0,
      original_bytes: file.size,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawScaled(img, w0, h0, maxEdge, quality) {
  const scale = Math.min(1, maxEdge / Math.max(w0, h0));
  const w = Math.round(w0 * scale);
  const h = Math.round(h0 * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        // Release canvas memory promptly; iOS caps total canvas memory.
        canvas.width = 0;
        canvas.height = 0;
        blob ? resolve({ blob, width: w, height: h }) : reject(new Error('JPEG encode failed'));
      },
      'image/jpeg',
      quality,
    );
  });
}
