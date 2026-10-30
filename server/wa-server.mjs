/**
 * Private chat-library server for Chat Backup Browser.
 *
 * Serves the built web app (build/) plus the WhatsApp export ZIPs found in a
 * single folder. Each ZIP is extracted once into a cache folder so the phone
 * can stream one photo/video/voice note at a time instead of downloading the
 * whole archive.
 *
 * Listens on 127.0.0.1 only. Remote access is meant to go through
 * `tailscale serve`, which proxies the tailnet HTTPS address to this port.
 *
 * Environment overrides:
 *   WA_DIR    folder with the export ZIPs   (default: ~/Documents/WA)
 *   WA_PORT   port to listen on             (default: 8190)
 *   WA_CACHE  extraction cache folder       (default: %LOCALAPPDATA%/ChatBackupBrowser/cache)
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_DIR = path.join(ROOT, 'build');
const WA_DIR =
	process.env.WA_DIR || path.join(os.homedir(), 'Documents', 'WA');
const PORT = Number(process.env.WA_PORT || 8190);
const HOST = '127.0.0.1';
const CACHE_DIR =
	process.env.WA_CACHE ||
	path.join(
		process.env.LOCALAPPDATA || path.join(os.homedir(), '.cache'),
		'ChatBackupBrowser',
		'cache',
	);

// Only answer requests addressed to this machine or its tailnet name. This
// blocks DNS-rebinding pages in a local browser from reading the chats.
const ALLOWED_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.[a-z0-9-]+\.ts\.net)(:\d+)?$/i;

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.webmanifest': 'application/manifest+json',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.bmp': 'image/bmp',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.wasm': 'application/wasm',
	'.txt': 'text/plain; charset=utf-8',
	'.vcf': 'text/vcard; charset=utf-8',
	'.mp4': 'video/mp4',
	'.mov': 'video/quicktime',
	'.3gp': 'video/3gpp',
	'.webm': 'video/webm',
	'.mkv': 'video/x-matroska',
	'.avi': 'video/x-msvideo',
	'.opus': 'audio/ogg',
	'.ogg': 'audio/ogg',
	'.mp3': 'audio/mpeg',
	'.m4a': 'audio/mp4',
	'.aac': 'audio/aac',
	'.wav': 'audio/wav',
	'.pdf': 'application/pdf',
};

// Archive contents that are safe to show inline; anything else downloads.
const INLINE_EXT = new Set([
	'.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp',
	'.mp4', '.mov', '.3gp', '.webm', '.mkv', '.avi',
	'.opus', '.ogg', '.mp3', '.m4a', '.aac', '.wav',
	'.txt', '.vcf', '.pdf',
]);

function log(...args) {
	console.log(new Date().toISOString(), ...args);
}

// ── Library ────────────────────────────────────────────────────────────────

async function listZips() {
	let names;
	try {
		names = await fs.readdir(WA_DIR);
	} catch {
		return [];
	}
	const chats = [];
	for (const name of names) {
		if (!name.toLowerCase().endsWith('.zip')) continue;
		const full = path.join(WA_DIR, name);
		const stat = await fs.stat(full).catch(() => null);
		if (!stat?.isFile()) continue;
		const id = createHash('sha256')
			.update(`${name}\0${stat.size}\0${stat.mtimeMs}`)
			.digest('hex')
			.slice(0, 16);
		chats.push({ id, name, size: stat.size, mtime: stat.mtimeMs, full });
	}
	chats.sort((a, b) => a.name.localeCompare(b.name));
	return chats;
}

async function findChat(id) {
	return (await listZips()).find((c) => c.id === id) ?? null;
}

const extracting = new Map();

/** Extracts a chat ZIP into the cache once; returns its manifest. */
function ensureExtracted(chat) {
	const dest = path.join(CACHE_DIR, chat.id);
	const manifestPath = path.join(dest, '.manifest.json');
	if (extracting.has(chat.id)) return extracting.get(chat.id);

	const job = (async () => {
		try {
			return JSON.parse(await fs.readFile(manifestPath, 'utf8'));
		} catch {
			// Not extracted yet
		}

		log(`extracting ${chat.name}`);
		const started = Date.now();
		const tmp = `${dest}.tmp-${process.pid}`;
		await fs.rm(tmp, { recursive: true, force: true });
		await fs.mkdir(tmp, { recursive: true });

		const zip = await JSZip.loadAsync(await fs.readFile(chat.full));
		const files = [];
		for (const [entryPath, entry] of Object.entries(zip.files)) {
			if (entry.dir) continue;
			const target = path.resolve(tmp, entryPath);
			// Zip-slip guard: never write outside the extraction folder
			if (!target.startsWith(tmp + path.sep)) continue;
			await fs.mkdir(path.dirname(target), { recursive: true });
			const data = await entry.async('nodebuffer');
			await fs.writeFile(target, data);
			files.push({ p: entryPath, s: data.length });
		}

		const manifest = { id: chat.id, name: chat.name, files };
		await fs.writeFile(
			path.join(tmp, '.manifest.json'),
			JSON.stringify(manifest),
		);
		await fs.rm(dest, { recursive: true, force: true });
		await fs.rename(tmp, dest);
		log(
			`extracted ${chat.name}: ${files.length} files in ${((Date.now() - started) / 1000).toFixed(1)}s`,
		);
		return manifest;
	})().finally(() => extracting.delete(chat.id));

	extracting.set(chat.id, job);
	return job;
}

/** Removes cache folders for ZIPs that no longer exist or have changed. */
async function pruneCache() {
	const live = new Set((await listZips()).map((c) => c.id));
	const entries = await fs.readdir(CACHE_DIR).catch(() => []);
	for (const name of entries) {
		if (!live.has(name)) {
			await fs.rm(path.join(CACHE_DIR, name), { recursive: true, force: true });
			log(`pruned cache ${name}`);
		}
	}
}

// ── HTTP helpers ───────────────────────────────────────────────────────────

const SECURITY_HEADERS = {
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'no-referrer',
	'X-Frame-Options': 'DENY',
};

function sendJson(res, status, body) {
	res.writeHead(status, {
		...SECURITY_HEADERS,
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'no-store',
	});
	res.end(JSON.stringify(body));
}

function sendError(res, status, message) {
	res.writeHead(status, {
		...SECURITY_HEADERS,
		'Content-Type': 'text/plain; charset=utf-8',
	});
	res.end(message);
}

/** Streams a file with HTTP Range support (needed for video on iOS). */
async function sendFile(req, res, filePath, extraHeaders = {}) {
	const stat = await fs.stat(filePath).catch(() => null);
	if (!stat?.isFile()) return sendError(res, 404, 'Not found');

	const ext = path.extname(filePath).toLowerCase();
	const headers = {
		...SECURITY_HEADERS,
		'Content-Type': MIME[ext] || 'application/octet-stream',
		'Accept-Ranges': 'bytes',
		'Last-Modified': stat.mtime.toUTCString(),
		...extraHeaders,
	};

	const range = req.headers.range;
	if (range) {
		const match = /^bytes=(\d*)-(\d*)$/.exec(range);
		let start = match?.[1] ? Number(match[1]) : Number.NaN;
		let end = match?.[2] ? Number(match[2]) : stat.size - 1;
		if (match && !match[1] && match[2]) {
			// Suffix range: last N bytes
			start = Math.max(0, stat.size - Number(match[2]));
			end = stat.size - 1;
		}
		if (!match || Number.isNaN(start) || start > end || start >= stat.size) {
			res.writeHead(416, { ...headers, 'Content-Range': `bytes */${stat.size}` });
			return res.end();
		}
		end = Math.min(end, stat.size - 1);
		res.writeHead(206, {
			...headers,
			'Content-Range': `bytes ${start}-${end}/${stat.size}`,
			'Content-Length': end - start + 1,
		});
		if (req.method === 'HEAD') return res.end();
		createReadStream(filePath, { start, end }).pipe(res);
		return;
	}

	res.writeHead(200, { ...headers, 'Content-Length': stat.size });
	if (req.method === 'HEAD') return res.end();
	createReadStream(filePath).pipe(res);
}

// ── Routes ─────────────────────────────────────────────────────────────────

async function handleApi(req, res, url) {
	const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

	if (parts[1] === 'library' && parts.length === 2) {
		const chats = await listZips();
		return sendJson(res, 200, {
			chats: chats.map(({ id, name, size, mtime }) => ({ id, name, size, mtime })),
		});
	}

	if (parts[1] === 'chats' && parts[2]) {
		const chat = await findChat(parts[2]);
		if (!chat) return sendError(res, 404, 'Unknown chat');
		const manifest = await ensureExtracted(chat);

		if (parts[3] === 'manifest' && parts.length === 4) {
			return sendJson(res, 200, manifest);
		}

		if (parts[3] === 'file') {
			const entryPath = url.pathname
				.split('/')
				.slice(5)
				.map((p) => decodeURIComponent(p))
				.join('/');
			const base = path.join(CACHE_DIR, chat.id);
			const target = path.resolve(base, entryPath);
			if (!target.startsWith(base + path.sep) || path.basename(target) === '.manifest.json') {
				return sendError(res, 400, 'Bad path');
			}
			const ext = path.extname(target).toLowerCase();
			return sendFile(req, res, target, {
				'Cache-Control': 'private, max-age=31536000, immutable',
				// Archive files can never run as a page on this origin
				'Content-Security-Policy': 'sandbox',
				'Content-Disposition': INLINE_EXT.has(ext) ? 'inline' : 'attachment',
			});
		}
	}

	return sendError(res, 404, 'Not found');
}

async function handleStatic(req, res, url) {
	let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
	let target = path.resolve(BUILD_DIR, rel || 'index.html');
	if (!target.startsWith(BUILD_DIR + path.sep)) {
		return sendError(res, 400, 'Bad path');
	}

	const stat = await fs.stat(target).catch(() => null);
	if (!stat?.isFile()) {
		// SPA fallback
		rel = 'index.html';
		target = path.join(BUILD_DIR, 'index.html');
	}
	const immutable = rel.startsWith('_app/immutable/');
	return sendFile(req, res, target, {
		'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
	});
}

const server = http.createServer(async (req, res) => {
	try {
		if (!ALLOWED_HOST.test(req.headers.host || '')) {
			return sendError(res, 421, 'Misdirected request');
		}
		if (req.method !== 'GET' && req.method !== 'HEAD') {
			return sendError(res, 405, 'Method not allowed');
		}
		const url = new URL(req.url || '/', 'http://localhost');
		if (url.pathname.startsWith('/api/')) {
			await handleApi(req, res, url);
		} else {
			await handleStatic(req, res, url);
		}
	} catch (err) {
		log('error', req.url, err);
		if (!res.headersSent) sendError(res, 500, 'Server error');
		else res.destroy();
	}
});

await fs.mkdir(CACHE_DIR, { recursive: true });
server.listen(PORT, HOST, async () => {
	log(`Chat Backup Browser server on http://${HOST}:${PORT}`);
	log(`chats folder: ${WA_DIR}`);
	log(`cache folder: ${CACHE_DIR}`);
	await pruneCache();
	// Warm the cache so the first visit from the phone is quick
	for (const chat of await listZips()) {
		await ensureExtracted(chat).catch((err) =>
			log(`failed to extract ${chat.name}:`, err.message),
		);
	}
});
