import { describe, it, expect } from 'vitest';
import { buildZip, crc32, type IZipEntry } from '../src/background/export/zip-writer.js';

// ---------------------------------------------------------------------------
// Minimal STORE-method unzip — validates the encoder by reading it back.
// Only supports compression method 0 (store), which is all buildZip emits.
// ---------------------------------------------------------------------------

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const decoder = new TextDecoder();

interface Unzipped {
  path: string;
  bytes: Uint8Array;
  crc: number;
}

function unzipStore(archive: Uint8Array): Unzipped[] {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);

  // Locate the End Of Central Directory record (no trailing comment expected).
  let eocd = -1;
  for (let i = archive.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('EOCD not found');

  const total = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true); // central directory offset

  const out: Unzipped[] = [];
  for (let n = 0; n < total; n++) {
    if (view.getUint32(ptr, true) !== CENTRAL_SIG) throw new Error('bad central signature');
    const crc = view.getUint32(ptr + 16, true);
    const compSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const path = decoder.decode(archive.subarray(ptr + 46, ptr + 46 + nameLen));

    // Read the local header to find where the data starts.
    if (view.getUint32(localOffset, true) !== LOCAL_SIG) throw new Error('bad local signature');
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const bytes = archive.subarray(dataStart, dataStart + compSize);

    out.push({ path, bytes, crc });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function bytesOf(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe('crc32', () => {
  it('matches the known CRC-32 of the ASCII string "123456789"', () => {
    // The canonical CRC-32 check value is 0xCBF43926.
    expect(crc32(bytesOf('123456789'))).toBe(0xcbf43926);
  });

  it('returns 0 for empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('buildZip — structure', () => {
  it('produces a valid archive with one entry round-tripping verbatim', () => {
    const entries: IZipEntry[] = [{ path: 'a.txt', bytes: bytesOf('hello') }];
    const archive = buildZip(entries);
    const back = unzipStore(archive);

    expect(back).toHaveLength(1);
    expect(back[0].path).toBe('a.txt');
    expect(decoder.decode(back[0].bytes)).toBe('hello');
  });

  it('stores entry bytes uncompressed (STORE) so content is byte-identical', () => {
    const payload = bytesOf('line1\nline2\n# heading\n');
    const archive = buildZip([{ path: 'note.md', bytes: payload }]);
    const back = unzipStore(archive);
    expect(back[0].bytes).toEqual(payload);
  });

  it('records a correct CRC-32 in the central directory', () => {
    const payload = bytesOf('123456789');
    const archive = buildZip([{ path: 'x', bytes: payload }]);
    const back = unzipStore(archive);
    expect(back[0].crc).toBe(0xcbf43926);
  });

  it('round-trips multiple entries including nested paths and binary bytes', () => {
    const bin = new Uint8Array([0, 1, 2, 253, 254, 255]);
    const entries: IZipEntry[] = [
      { path: 'r1.md', bytes: bytesOf('# R1') },
      { path: 'media/r1_img0', bytes: bin },
      { path: 'r2.md', bytes: bytesOf('# R2') },
    ];
    const back = unzipStore(buildZip(entries));

    expect(back.map((e) => e.path)).toEqual(['r1.md', 'media/r1_img0', 'r2.md']);
    expect(back[1].bytes).toEqual(bin);
  });

  it('handles an empty archive (no entries)', () => {
    const archive = buildZip([]);
    const back = unzipStore(archive);
    expect(back).toHaveLength(0);
  });

  it('preserves UTF-8 filenames and content', () => {
    const archive = buildZip([{ path: 'café.md', bytes: bytesOf('naïve façade') }]);
    const back = unzipStore(archive);
    expect(back[0].path).toBe('café.md');
    expect(decoder.decode(back[0].bytes)).toBe('naïve façade');
  });

  it('is deterministic for identical input', () => {
    const entries: IZipEntry[] = [{ path: 'a', bytes: bytesOf('A') }];
    expect(buildZip(entries)).toEqual(buildZip(entries));
  });
});
