import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { COMPRESS_STEPS, deletePhoto, encodeWithin, fitWithin, getPhoto, MAX_BYTES, MAX_EDGE, photoUsageBytes, putPhoto } from '@/features/cambridge/photos';

describe('fitWithin (long edge at most 1,600 px)', () => {
  it('scales the long edge down to the limit, keeping the aspect ratio', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 }); // a phone photo, landscape
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 }); // portrait
    expect(fitWithin(5000, 100)).toEqual({ width: 1600, height: 32 });
  });

  it('never scales up, and handles edge sizes', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(MAX_EDGE, MAX_EDGE)).toEqual({ width: 1600, height: 1600 });
    expect(fitWithin(100_000, 1)).toEqual({ width: 1600, height: 1 }); // never rounds to 0
    expect(fitWithin(0, 10)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(NaN, 10)).toEqual({ width: 0, height: 0 });
  });
});

describe('photo storage (IndexedDB meridian_photos)', () => {
  const bytes = (n: number, fill: number): ArrayBuffer => new Uint8Array(n).fill(fill).buffer;

  it('round-trips bytes, sums usage, and deletes', async () => {
    const base = await photoUsageBytes();
    const a = await putPhoto({ bytes: bytes(1500, 7), type: 'image/jpeg', width: 1600, height: 1200 }, 1);
    const b = await putPhoto({ bytes: bytes(700, 9), type: 'image/jpeg', width: 1200, height: 1600 }, 2);
    expect(a).not.toBe(b);
    expect(await photoUsageBytes()).toBe(base + 2200);

    const blob = await getPhoto(a);
    expect(blob?.type).toBe('image/jpeg');
    const back = new Uint8Array(await blob!.arrayBuffer());
    expect(back.length).toBe(1500);
    expect(back.every((x) => x === 7)).toBe(true);

    await deletePhoto(a);
    expect(await getPhoto(a)).toBeNull();
    expect(await photoUsageBytes()).toBe(base + 700);
    await deletePhoto('missing'); // deleting an unknown id is harmless
    await deletePhoto(b);
    expect(await photoUsageBytes()).toBe(base);
  });
});

describe('encodeWithin (at most 300 KB a photo)', () => {
  const blobOf = (bytes: number): Blob => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });

  it('keeps the first encoding that fits', async () => {
    const tried: string[] = [];
    const out = await encodeWithin(async (edge, q) => {
      tried.push(`${edge}@${q}`);
      return { blob: blobOf(200 * 1024), width: edge, height: edge };
    });
    expect(tried).toEqual(['1600@0.72']);
    expect(out.width).toBe(1600);
  });

  it('over 300 KB: retries at quality 0.6, then a 1,400 px edge, until it fits', async () => {
    const size: Record<string, number> = { '1600@0.72': 520, '1600@0.6': 360, '1400@0.6': 280 };
    const tried: string[] = [];
    const out = await encodeWithin(async (edge, q) => {
      tried.push(`${edge}@${q}`);
      return { blob: blobOf((size[`${edge}@${q}`] ?? 100) * 1024), width: edge, height: edge };
    });
    expect(tried).toEqual(['1600@0.72', '1600@0.6', '1400@0.6']);
    expect(out.blob.size).toBeLessThanOrEqual(MAX_BYTES);
    expect(out.width).toBe(1400);
  });

  it('keeps the smallest try when nothing fits', async () => {
    const out = await encodeWithin(async (edge, q) => ({ blob: blobOf(Math.round(edge * q)), width: edge, height: edge }), 10);
    expect(out.width).toBe(COMPRESS_STEPS[COMPRESS_STEPS.length - 1]!.edge);
  });
});
