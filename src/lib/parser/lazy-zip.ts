/**
 * Reads a ZIP without loading it into memory.
 *
 * Only the central directory is read up front; each entry's bytes are fetched
 * from the file when something asks for them. A 700 MB export costs a few
 * hundred KB of RAM instead of 700 MB, and opens without reading the whole file.
 *
 * The result has the same JSZip-like shape as a RemoteArchive, so the parser
 * and media code work with it unchanged. Anything this reader can't handle
 * (encrypted entries, unusual compression) throws, and callers fall back to
 * loading the whole file with JSZip.
 */

import type JSZip from 'jszip';
import type { RemoteArchive } from '../remote-library';

/** Anything the parser can open. */
export type ArchiveSource = File | ArrayBuffer | RemoteArchive;

/** Reads `length` bytes starting at `offset`. */
export type RangeReader = (
	offset: number,
	length: number,
) => Promise<ArrayBuffer>;

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_ENTRY_SIGNATURE = 0x02014b50;
const LOCAL_ENTRY_SIGNATURE = 0x04034b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;
const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

interface CentralEntry {
	name: string;
	method: number;
	compressedSize: number;
	size: number;
	localOffset: number;
}

function u64(view: DataView, offset: number): number {
	const value = view.getBigUint64(offset, true);
	if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new Error('ZIP value too large');
	}
	return Number(value);
}

/** Finds the central directory: its offset, size and entry count. */
async function readDirectoryLocation(
	size: number,
	read: RangeReader,
): Promise<{ offset: number; length: number }> {
	const tailLength = Math.min(size, EOCD_SIZE + MAX_COMMENT);
	const tailStart = size - tailLength;
	const tail = new DataView(await read(tailStart, tailLength));

	for (let i = tailLength - EOCD_SIZE; i >= 0; i--) {
		if (tail.getUint32(i, true) !== EOCD_SIGNATURE) continue;

		const entries = tail.getUint16(i + 10, true);
		const length = tail.getUint32(i + 12, true);
		const offset = tail.getUint32(i + 16, true);
		if (entries !== U16_MAX && length !== U32_MAX && offset !== U32_MAX) {
			return { offset, length };
		}

		// ZIP64: the real values are in a record the locator points to
		const locatorPos = i - 20;
		if (
			locatorPos < 0 ||
			tail.getUint32(locatorPos, true) !== ZIP64_LOCATOR_SIGNATURE
		) {
			throw new Error('ZIP64 locator not found');
		}
		const recordOffset = u64(tail, locatorPos + 8);
		const record = new DataView(await read(recordOffset, 56));
		if (record.getUint32(0, true) !== ZIP64_EOCD_SIGNATURE) {
			throw new Error('ZIP64 record not found');
		}
		return { offset: u64(record, 48), length: u64(record, 40) };
	}
	throw new Error('Not a ZIP file');
}

/** Applies the ZIP64 extra field to values too big for the 32-bit fields. */
function applyZip64Extra(
	view: DataView,
	start: number,
	end: number,
	entry: CentralEntry,
): void {
	let pos = start;
	while (pos + 4 <= end) {
		const id = view.getUint16(pos, true);
		const length = view.getUint16(pos + 2, true);
		if (id === 0x0001) {
			let field = pos + 4;
			if (entry.size === U32_MAX) {
				entry.size = u64(view, field);
				field += 8;
			}
			if (entry.compressedSize === U32_MAX) {
				entry.compressedSize = u64(view, field);
				field += 8;
			}
			if (entry.localOffset === U32_MAX) {
				entry.localOffset = u64(view, field);
			}
			return;
		}
		pos += 4 + length;
	}
}

function parseCentralDirectory(buffer: ArrayBuffer): CentralEntry[] {
	const view = new DataView(buffer);
	const bytes = new Uint8Array(buffer);
	const decoder = new TextDecoder();
	const entries: CentralEntry[] = [];

	let pos = 0;
	while (pos + 46 <= buffer.byteLength) {
		if (view.getUint32(pos, true) !== CENTRAL_ENTRY_SIGNATURE) break;

		const flags = view.getUint16(pos + 8, true);
		const method = view.getUint16(pos + 10, true);
		const nameLength = view.getUint16(pos + 28, true);
		const extraLength = view.getUint16(pos + 30, true);
		const commentLength = view.getUint16(pos + 32, true);
		const nameStart = pos + 46;
		const extraStart = nameStart + nameLength;

		if (flags & 1) throw new Error('Encrypted ZIP entries are not supported');
		if (method !== METHOD_STORED && method !== METHOD_DEFLATE) {
			throw new Error(`Unsupported ZIP compression method ${method}`);
		}

		const entry: CentralEntry = {
			name: decoder.decode(bytes.subarray(nameStart, extraStart)),
			method,
			compressedSize: view.getUint32(pos + 20, true),
			size: view.getUint32(pos + 24, true),
			localOffset: view.getUint32(pos + 42, true),
		};
		applyZip64Extra(view, extraStart, extraStart + extraLength, entry);
		entries.push(entry);

		pos = extraStart + extraLength + commentLength;
	}
	return entries;
}

async function inflate(data: ArrayBuffer): Promise<ArrayBuffer> {
	const stream = new Blob([data])
		.stream()
		.pipeThrough(new DecompressionStream('deflate-raw'));
	return new Response(stream).arrayBuffer();
}

async function readEntry(
	entry: CentralEntry,
	read: RangeReader,
): Promise<ArrayBuffer> {
	// Name and extra lengths can differ from the central directory's, so the
	// data offset has to come from the entry's own local header.
	const header = new DataView(await read(entry.localOffset, 30));
	if (header.getUint32(0, true) !== LOCAL_ENTRY_SIGNATURE) {
		throw new Error(`Corrupt ZIP entry: ${entry.name}`);
	}
	const dataOffset =
		entry.localOffset +
		30 +
		header.getUint16(26, true) +
		header.getUint16(28, true);

	const raw =
		entry.compressedSize > 0
			? await read(dataOffset, entry.compressedSize)
			: new ArrayBuffer(0);
	const data = entry.method === METHOD_DEFLATE ? await inflate(raw) : raw;

	if (data.byteLength !== entry.size) {
		throw new Error(`Corrupt ZIP entry: ${entry.name}`);
	}
	return data;
}

/** Opens a ZIP through `read`; throws if it can't be read this way. */
export async function openLazyZip(
	name: string,
	size: number,
	read: RangeReader,
): Promise<RemoteArchive> {
	if (typeof DecompressionStream === 'undefined') {
		throw new Error('DecompressionStream is not available');
	}

	const location = await readDirectoryLocation(size, read);
	const directory = await read(location.offset, location.length);

	const files: RemoteArchive['files'] = {};
	for (const entry of parseCentralDirectory(directory)) {
		const lazyEntry = {
			name: entry.name,
			dir: entry.name.endsWith('/'),
			// Read by zip-parser for the media size
			_data: { uncompressedSize: entry.size },
			async async(type: string) {
				const data = await readEntry(entry, read);
				if (type === 'string' || type === 'text') {
					return new TextDecoder().decode(data);
				}
				if (type === 'blob') return new Blob([data]);
				return data;
			},
		};
		files[entry.name] = lazyEntry as unknown as JSZip.JSZipObject;
	}
	return { name, files };
}

/** A RangeReader over a File: reads only the bytes asked for. */
export function fileRangeReader(file: File): RangeReader {
	return (offset, length) => file.slice(offset, offset + length).arrayBuffer();
}

/** Opens `file` lazily, or returns it for a full JSZip load if that fails. */
export async function openZipSource(file: File): Promise<File | RemoteArchive> {
	try {
		return await openLazyZip(file.name, file.size, fileRangeReader(file));
	} catch (e) {
		console.warn('Lazy ZIP reading unavailable, loading whole file:', e);
		return file;
	}
}
