/**
 * Photos of paper work, local to this device (DECISIONS C5): IndexedDB
 * `meridian_photos`, compressed to JPEG with the long edge at most 1,600 px.
 * Items store only the returned ids; the photos never sync.
 *
 * Bytes are stored as an ArrayBuffer plus a MIME type rather than a Blob:
 * older iOS Safari could not store Blobs in IndexedDB, and an ArrayBuffer
 * clones the same everywhere.
 *
 * Lazy module: never import it from the main chunk.
 */

export const PHOTO_DB = 'meridian_photos';
const STORE = 'photos';
export const MAX_EDGE = 1600;
export const JPEG_QUALITY = 0.72;

export interface PhotoRecord {
  id: string;
  type: string;
  bytes: ArrayBuffer;
  size: number;
  width: number;
  height: number;
  createdAt: number;
}

/** Scale (w, h) down so the long edge is at most `max`, keeping the aspect ratio. Never scales up. */
export function fitWithin(w: number, h: number, max: number = MAX_EDGE): { width: number; height: number } {
  if (!(w > 0) || !(h > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** The most a stored photo may weigh (contract section 1: about 150 to 300 KB each). */
export const MAX_BYTES = 300 * 1024;

/**
 * Encodings to try in order until one fits MAX_BYTES: the default first, then
 * lower quality, then a smaller long edge. A dense page of handwriting can
 * exceed the budget at the default; the last step is small enough for any page.
 */
export const COMPRESS_STEPS: readonly { edge: number; quality: number }[] = [
  { edge: MAX_EDGE, quality: JPEG_QUALITY },
  { edge: MAX_EDGE, quality: 0.6 },
  { edge: 1400, quality: 0.6 },
  { edge: 1200, quality: 0.5 },
];

export interface Encoded { blob: Blob; width: number; height: number }

/**
 * Encode with each step until the output is at most `limit` bytes. Returns the
 * first that fits, or the last (smallest) if none does. Pure over `encode`, so
 * the retry rule is unit-testable without a canvas.
 */
export async function encodeWithin(
  encode: (edge: number, quality: number) => Promise<Encoded>,
  limit: number = MAX_BYTES,
  steps: readonly { edge: number; quality: number }[] = COMPRESS_STEPS,
): Promise<Encoded> {
  let out: Encoded | null = null;
  for (const { edge, quality } of steps) {
    out = await encode(edge, quality);
    if (out.blob.size <= limit) return out;
  }
  return out!;
}

/** Decode, downscale and re-encode an image as JPEG, at most MAX_BYTES where possible. Browser only. */
export async function compressImage(file: Blob): Promise<Encoded> {
  const bitmap = await createImageBitmap(file);
  try {
    return await encodeWithin((edge, quality) => encodeBitmap(bitmap, edge, quality));
  } finally {
    bitmap.close();
  }
}

async function encodeBitmap(bitmap: ImageBitmap, edge: number, quality: number): Promise<Encoded> {
  const { width, height } = fitWithin(bitmap.width, bitmap.height, edge);
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0, width, height);
    return { blob: await canvas.convertToBlob({ type: 'image/jpeg', quality }), width, height };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('could not encode the photo');
  return { blob, width, height };
}

let dbp: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(PHOTO_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        // The size index lets usage be summed from index keys alone, without
        // reading every photo's bytes into memory.
        req.result.createObjectStore(STORE, { keyPath: 'id' }).createIndex('size', 'size');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  // A failed open is retried on the next call instead of cached.
  dbp.catch(() => { dbp = null; });
  return dbp;
}

function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T> | null): Promise<T | undefined> {
  return open().then((db) => new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = op(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('photo transaction aborted'));
  }));
}

const newId = (now: number): string =>
  'ph-' + now.toString(36) + '-' + (globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10));

/** Store already-encoded bytes. Returns the new photo id. */
export async function putPhoto(
  data: { bytes: ArrayBuffer; type: string; width: number; height: number },
  now: number = Date.now(),
): Promise<string> {
  const rec: PhotoRecord = { id: newId(now), ...data, size: data.bytes.byteLength, createdAt: now };
  await run('readwrite', (s) => s.put(rec));
  return rec.id;
}

/** Compress and store a photo from a file input or camera. Returns its id. */
export async function savePhoto(file: Blob, now: number = Date.now()): Promise<string> {
  const { blob, width, height } = await compressImage(file);
  return putPhoto({ bytes: await blob.arrayBuffer(), type: blob.type || 'image/jpeg', width, height }, now);
}

/** Compress and store several; ids come back in the input order. */
export async function savePhotos(files: readonly Blob[], now: number = Date.now()): Promise<string[]> {
  const ids: string[] = [];
  for (const f of files) ids.push(await savePhoto(f, now));
  return ids;
}

export async function getPhoto(id: string): Promise<Blob | null> {
  const rec = (await run('readonly', (s) => s.get(id) as IDBRequest<PhotoRecord | undefined>)) ?? undefined;
  return rec ? new Blob([rec.bytes], { type: rec.type }) : null;
}

export async function deletePhoto(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id));
}

/** Bytes used by every stored photo, for the Data tab. */
export async function photoUsageBytes(): Promise<number> {
  const db = await open();
  return new Promise<number>((resolve, reject) => {
    let total = 0;
    const tx = db.transaction(STORE, 'readonly');
    const cur = tx.objectStore(STORE).index('size').openKeyCursor();
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c) return;
      total += Number(c.key) || 0;
      c.continue();
    };
    tx.oncomplete = () => resolve(total);
    tx.onerror = () => reject(tx.error);
  });
}
