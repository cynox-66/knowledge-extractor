/**
 * Minimal, dependency-free ZIP encoder (STORE method — no compression).
 *
 * Why hand-rolled: the background service worker must assemble a markdown/Obsidian
 * bundle without pulling in a third-party archiver (and without the CSP/eval
 * concerns some bring). STORE is deterministic, trivially correct, and lets the
 * markdown bytes round-trip verbatim — which keeps the encoder simple and the
 * tests strong (a stored entry's bytes appear unmodified in the archive).
 *
 * Scope (Beta-3 M4): the whole archive is built in memory. This is the
 * documented memory ceiling (architecture risk R3). A streaming/compressed
 * backend can replace this module behind {@link buildZip} without touching the
 * writer or coordinator.
 *
 * This module is pure: no chrome APIs, no storage, no I/O. Fully unit-testable.
 */

/** One file to place into the archive. */
export interface IZipEntry {
  /** Forward-slash relative path within the archive. */
  path: string;
  /** Raw file bytes (stored verbatim — no compression). */
  bytes: Uint8Array;
}

// ---- CRC-32 (IEEE 802.3) ---------------------------------------------------

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable !== null) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

/** Computes the CRC-32 checksum of a byte array. */
export function crc32(bytes: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---- ZIP assembly ----------------------------------------------------------

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIR_HEADER_SIG = 0x02014b50;
const END_OF_CENTRAL_DIR_SIG = 0x06054b50;
/** Bit 11 set ⇒ filename is UTF-8. */
const FLAG_UTF8 = 0x0800;
/** Version 2.0 — the minimum that supports the STORE method used here. */
const VERSION = 20;

const textEncoder = new TextEncoder();

interface CentralRecord {
  nameBytes: Uint8Array;
  crc: number;
  size: number;
  offset: number;
}

/**
 * Encodes the given entries into a single ZIP archive (STORE method).
 *
 * Entries are written in the order supplied; callers that need determinism
 * should pre-sort. Duplicate paths are written as-is (the archive is valid;
 * most unzip tools keep the last). Paths are emitted with UTF-8 flagged.
 */
export function buildZip(entries: readonly IZipEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: CentralRecord[] = [];
  let offset = 0;

  const push = (bytes: Uint8Array): void => {
    chunks.push(bytes);
    offset += bytes.length;
  };

  for (const entry of entries) {
    const nameBytes = textEncoder.encode(entry.path);
    const crc = crc32(entry.bytes);
    const size = entry.bytes.length;
    const localOffset = offset;

    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, LOCAL_FILE_HEADER_SIG, true);
    view.setUint16(4, VERSION, true);
    view.setUint16(6, FLAG_UTF8, true);
    view.setUint16(8, 0, true); // compression: store
    view.setUint16(10, 0, true); // mod time (fixed — deterministic output)
    view.setUint16(12, 0x21, true); // mod date: 1980-01-01 (DOS epoch)
    view.setUint32(14, crc, true);
    view.setUint32(18, size, true); // compressed size == size (store)
    view.setUint32(22, size, true); // uncompressed size
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true); // extra field length
    header.set(nameBytes, 30);

    push(header);
    push(entry.bytes);

    central.push({ nameBytes, crc, size, offset: localOffset });
  }

  const centralStart = offset;
  for (const rec of central) {
    const header = new Uint8Array(46 + rec.nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, CENTRAL_DIR_HEADER_SIG, true);
    view.setUint16(4, VERSION, true); // version made by
    view.setUint16(6, VERSION, true); // version needed
    view.setUint16(8, FLAG_UTF8, true);
    view.setUint16(10, 0, true); // compression: store
    view.setUint16(12, 0, true); // mod time
    view.setUint16(14, 0x21, true); // mod date
    view.setUint32(16, rec.crc, true);
    view.setUint32(20, rec.size, true);
    view.setUint32(24, rec.size, true);
    view.setUint16(28, rec.nameBytes.length, true);
    view.setUint16(30, 0, true); // extra length
    view.setUint16(32, 0, true); // comment length
    view.setUint16(34, 0, true); // disk number start
    view.setUint16(36, 0, true); // internal attributes
    view.setUint32(38, 0, true); // external attributes
    view.setUint32(42, rec.offset, true); // local header offset
    header.set(rec.nameBytes, 46);
    push(header);
  }
  const centralSize = offset - centralStart;

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, END_OF_CENTRAL_DIR_SIG, true);
  eocdView.setUint16(4, 0, true); // disk number
  eocdView.setUint16(6, 0, true); // disk with central dir
  eocdView.setUint16(8, central.length, true); // entries on this disk
  eocdView.setUint16(10, central.length, true); // total entries
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, centralStart, true);
  eocdView.setUint16(20, 0, true); // comment length
  push(eocd);

  // Concatenate all chunks into the final archive.
  const out = new Uint8Array(offset);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}
