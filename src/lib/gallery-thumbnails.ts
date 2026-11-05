/**
 * Thumbnail generation for the media gallery.
 *
 * Creates small image thumbnails without using the full-media cache.
 * This avoids keeping many large blobs in memory just to render a grid.
 */

import type { MediaFile } from './parser/zip-parser';

const DEFAULT_MAX_SIZE = 256;
const DEFAULT_QUALITY = 0.82;
const MAX_THUMBNAILS = 300;
const MAX_CONCURRENT_THUMBNAILS = 2;

const thumbnailUrlCache = new Map<string, string>();
const thumbnailPromiseCache = new Map<string, Promise<string | null>>();
const thumbnailAccessOrder: string[] = []; // Track access order for LRU eviction

interface QueuedWork {
	run: () => void;
	/** Lower runs first, e.g. distance from the middle of the screen */
	priority?: () => number;
}

export interface WorkOptions {
	/** Aborting drops the work if it hasn't started */
	signal?: AbortSignal;
	priority?: () => number;
}

let inFlight = 0;
let paused = false;
const queue: QueuedWork[] = [];

function startQueuedWork(): void {
	while (!paused && inFlight < MAX_CONCURRENT_THUMBNAILS && queue.length) {
		// Ties go to the newest request: it belongs to what is on screen now
		let best = queue.length - 1;
		let bestPriority = queue[best].priority?.() ?? 0;
		for (let i = best - 1; i >= 0; i--) {
			const priority = queue[i].priority?.() ?? 0;
			if (priority < bestPriority) {
				best = i;
				bestPriority = priority;
			}
		}
		queue.splice(best, 1)[0].run();
	}
}

/**
 * Holds back new media work (gallery tiles, chat bubbles) during a fast
 * swipe, like a game streaming in only what is in view: when the swipe slows
 * or stops, work for what sits nearest the middle of the screen starts first.
 */
export function setMediaLoadingPaused(value: boolean): void {
	if (paused === value) return;
	paused = value;
	startQueuedWork();
}

// A scroll faster than this counts as a fling; loads wait for it to settle
const FAST_SCROLL_PX_PER_MS = 2;
const SCROLL_SETTLE_MS = 150;

/**
 * Returns a scroll handler for a list of media: it pauses new loads while the
 * list is flung and resumes them once it slows down or stops.
 */
export function createFlingDetector(getElement: () => HTMLElement | null): {
	onScroll: () => void;
	stop: () => void;
} {
	let lastTop = 0;
	let lastTime = 0;
	let settleTimer: ReturnType<typeof setTimeout> | undefined;
	return {
		onScroll() {
			const el = getElement();
			if (!el) return;
			const now = performance.now();
			const speed =
				Math.abs(el.scrollTop - lastTop) / Math.max(1, now - lastTime);
			lastTop = el.scrollTop;
			lastTime = now;
			setMediaLoadingPaused(speed > FAST_SCROLL_PX_PER_MS);
			clearTimeout(settleTimer);
			settleTimer = setTimeout(
				() => setMediaLoadingPaused(false),
				SCROLL_SETTLE_MS,
			);
		},
		stop() {
			clearTimeout(settleTimer);
			setMediaLoadingPaused(false);
		},
	};
}

/**
 * Runs gallery work (thumbnails, durations, previews) a few at a time, best
 * priority first. Work aborted while waiting never runs, so swiping through
 * hundreds of tiles doesn't leave the visible ones queued behind them.
 */
export function runLimited<T>(
	fn: () => Promise<T>,
	options: WorkOptions = {},
): Promise<T> {
	const { signal, priority } = options;
	return new Promise((resolve, reject) => {
		const aborted = () => reject(new DOMException('Aborted', 'AbortError'));
		if (signal?.aborted) {
			aborted();
			return;
		}
		const work: QueuedWork = {
			priority,
			run: () => {
				signal?.removeEventListener('abort', onAbort);
				inFlight++;
				fn()
					.then(resolve, reject)
					.finally(() => {
						inFlight--;
						startQueuedWork();
					});
			},
		};
		const onAbort = () => {
			const index = queue.indexOf(work);
			if (index === -1) return;
			queue.splice(index, 1);
			aborted();
		};
		signal?.addEventListener('abort', onAbort, { once: true });
		queue.push(work);
		startQueuedWork();
	});
}

export function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError';
}

function evictOldestThumbnails(): void {
	if (thumbnailUrlCache.size <= MAX_THUMBNAILS) return;

	const overflow = thumbnailUrlCache.size - MAX_THUMBNAILS;

	// Evict least recently used thumbnails (from front of access order array)
	for (let i = 0; i < overflow; i++) {
		const key = thumbnailAccessOrder.shift();
		if (!key) break;

		const url = thumbnailUrlCache.get(key);
		if (url) URL.revokeObjectURL(url);
		thumbnailUrlCache.delete(key);
	}
}

function getImageMimeType(filename: string): string {
	const ext = filename.toLowerCase().split('.').pop() || '';
	if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
	if (ext === 'png') return 'image/png';
	if (ext === 'gif') return 'image/gif';
	if (ext === 'webp') return 'image/webp';
	if (ext === 'bmp') return 'image/bmp';
	if (ext === 'svg') return 'image/svg+xml';
	// Use image/jpeg as safer default for unrecognized image files
	return 'image/jpeg';
}

async function canvasToBlob(
	canvas: HTMLCanvasElement | OffscreenCanvas,
	type: string,
	quality: number,
): Promise<Blob> {
	if ('convertToBlob' in canvas) {
		return (canvas as OffscreenCanvas).convertToBlob({ type, quality });
	}

	return new Promise((resolve, reject) => {
		(canvas as HTMLCanvasElement).toBlob(
			(blob) => {
				if (!blob) {
					reject(new Error('Failed to create thumbnail blob'));
					return;
				}
				resolve(blob);
			},
			type,
			quality,
		);
	});
}

export async function getImageThumbnailUrl(
	media: MediaFile,
	options?: { maxSize?: number; quality?: number } & WorkOptions,
): Promise<string | null> {
	if (media.type !== 'image') return null;
	if (!media._zipEntry) return null;

	const key = media.path;
	const cached = thumbnailUrlCache.get(key);
	if (cached) {
		// Move to end of access order (most recently used)
		const idx = thumbnailAccessOrder.indexOf(key);
		if (idx !== -1) {
			thumbnailAccessOrder.splice(idx, 1);
		}
		thumbnailAccessOrder.push(key);
		return cached;
	}

	const pending = thumbnailPromiseCache.get(key);
	if (pending) return pending;

	const promise = runLimited(async () => {
		try {
			const maxSize = options?.maxSize ?? DEFAULT_MAX_SIZE;
			const quality = options?.quality ?? DEFAULT_QUALITY;

			const arrayBuffer = await media._zipEntry?.async('arraybuffer');
			if (!arrayBuffer) return null;

			const mimeType = getImageMimeType(media.name);
			const blob = new Blob([arrayBuffer], { type: mimeType });

			// Special handling for SVG files
			if (mimeType === 'image/svg+xml') {
				// For SVG, we can directly create an object URL
				// SVG files are usually small and scale perfectly, but still follow
				// the same cache eviction policy as raster images for consistency
				const url = URL.createObjectURL(blob);
				thumbnailUrlCache.set(key, url);
				const existingIdx = thumbnailAccessOrder.indexOf(key);
				if (existingIdx !== -1) {
					thumbnailAccessOrder.splice(existingIdx, 1);
				}
				thumbnailAccessOrder.push(key);
				evictOldestThumbnails();
				return url;
			}

			// For raster images, use ImageBitmap for efficient decoding and scaling
			if (typeof createImageBitmap === 'undefined') return null;

			// Decode and downscale using ImageBitmap resize options.
			const bitmap = await createImageBitmap(blob);
			const scale = Math.min(
				1,
				maxSize / Math.max(bitmap.width || 1, bitmap.height || 1),
			);
			const targetWidth = Math.max(1, Math.round(bitmap.width * scale));
			const targetHeight = Math.max(1, Math.round(bitmap.height * scale));

			let resized: ImageBitmap;
			try {
				resized = await createImageBitmap(blob, {
					resizeWidth: targetWidth,
					resizeHeight: targetHeight,
					resizeQuality: 'high',
				});
				// Close original bitmap if resize succeeded
				if (resized !== bitmap) {
					bitmap.close();
				}
			} catch (error) {
				// Fallback to original if resize options are not supported.
				if (typeof console !== 'undefined') {
					console.debug(
						'createImageBitmap resize options failed, using original bitmap instead',
						error,
					);
				}
				resized = bitmap;
			}

			const canvas: HTMLCanvasElement | OffscreenCanvas =
				typeof OffscreenCanvas !== 'undefined'
					? new OffscreenCanvas(targetWidth, targetHeight)
					: Object.assign(document.createElement('canvas'), {
							width: targetWidth,
							height: targetHeight,
						});

			let ctx:
				| CanvasRenderingContext2D
				| OffscreenCanvasRenderingContext2D
				| null = null;
			if (
				typeof OffscreenCanvas !== 'undefined' &&
				canvas instanceof OffscreenCanvas
			) {
				ctx = canvas.getContext('2d');
			} else {
				ctx = (canvas as HTMLCanvasElement).getContext('2d');
			}
			if (!ctx) {
				resized.close();
				return null;
			}

			ctx.drawImage(resized, 0, 0, targetWidth, targetHeight);

			// Close the ImageBitmap to free memory
			resized.close();

			const outBlob = await canvasToBlob(canvas, 'image/webp', quality);
			const url = URL.createObjectURL(outBlob);

			thumbnailUrlCache.set(key, url);
			// Track access order for LRU - check for duplicates first
			const existingIdx = thumbnailAccessOrder.indexOf(key);
			if (existingIdx !== -1) {
				thumbnailAccessOrder.splice(existingIdx, 1);
			}
			thumbnailAccessOrder.push(key);
			evictOldestThumbnails();

			return url;
		} finally {
			thumbnailPromiseCache.delete(key);
		}
	}, options);

	thumbnailPromiseCache.set(key, promise);
	// An aborted wait leaves nothing cached, so the next request starts over
	promise.catch(() => thumbnailPromiseCache.delete(key));
	return promise;
}

export function cleanupThumbnailUrls(): void {
	for (const url of thumbnailUrlCache.values()) {
		URL.revokeObjectURL(url);
	}
	thumbnailUrlCache.clear();
	thumbnailPromiseCache.clear();
	thumbnailAccessOrder.length = 0; // Clear access order tracking
}
