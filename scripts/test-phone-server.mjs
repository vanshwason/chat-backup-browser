/**
 * Smoke test for the phone server (server/wa-server.mjs).
 *
 * Zips an example chat into a temporary chats folder, starts the server on a
 * spare port against it, and checks the endpoints the mobile UI uses.
 * Needs a web build first (`npm run build`).
 *
 *   node scripts/test-phone-server.mjs
 */
import { spawn } from 'node:child_process';
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE = path.join(ROOT, 'examples/chats/android-private-chat');
const PORT = 8199;
const BASE = `http://127.0.0.1:${PORT}`;

const tmp = await mkdtemp(path.join(os.tmpdir(), 'cbb-server-test-'));
const chatsDir = path.join(tmp, 'chats');
const cacheDir = path.join(tmp, 'cache');

let server;
let failed = false;

function check(name, ok, detail = '') {
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
	if (!ok) failed = true;
}

try {
	// Build a WhatsApp-style export ZIP from the example folder
	const zip = new JSZip();
	for (const name of await readdir(EXAMPLE)) {
		zip.file(name, await readFile(path.join(EXAMPLE, name)));
	}
	await mkdir(chatsDir);
	await writeFile(
		path.join(chatsDir, 'WhatsApp Chat - Alice.zip'),
		await zip.generateAsync({ type: 'nodebuffer' }),
	);

	server = spawn(process.execPath, [path.join(ROOT, 'server/wa-server.mjs')], {
		env: {
			...process.env,
			WA_DIR: chatsDir,
			WA_CACHE: cacheDir,
			WA_PORT: String(PORT),
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let output = '';
	server.stdout.on('data', (d) => (output += d));
	server.stderr.on('data', (d) => (output += d));

	// Wait for the server to listen
	let up = false;
	for (let i = 0; i < 50 && !up; i++) {
		await new Promise((r) => setTimeout(r, 200));
		up = await fetch(`${BASE}/api/library`).then(
			(r) => r.ok,
			() => false,
		);
	}
	check('server starts', up, up ? '' : output.trim().slice(-300));
	if (!up) throw new Error('server did not start');

	const library = await (await fetch(`${BASE}/api/library`)).json();
	check('library lists the chat', library.chats?.length === 1);
	const id = library.chats[0].id;

	const manifestRes = await fetch(`${BASE}/api/chats/${id}/manifest`);
	const manifest = await manifestRes.json();
	const names = manifest.files?.map((f) => f.p) ?? [];
	check('manifest lists the export files', names.length >= 5, `${names.length} files`);

	const txt = names.find((n) => n.endsWith('.txt'));
	const txtRes = await fetch(
		`${BASE}/api/chats/${id}/file/${txt.split('/').map(encodeURIComponent).join('/')}`,
	);
	check('chat text is served', txtRes.ok && (await txtRes.text()).length > 0);

	const img = names.find((n) => n.endsWith('.jpg'));
	const rangeRes = await fetch(
		`${BASE}/api/chats/${id}/file/${encodeURIComponent(img)}`,
		{ headers: { Range: 'bytes=0-9' } },
	);
	check(
		'media supports range requests',
		rangeRes.status === 206 && (await rangeRes.arrayBuffer()).byteLength === 10,
	);

	const traversal = await fetch(`${BASE}/api/chats/${id}/file/..%2F..%2Fsecret`);
	check('path traversal is rejected', traversal.status === 400);

	// fetch() can't override Host, so use node:http for the DNS-rebinding check
	const foreignStatus = await new Promise((resolve, reject) => {
		http
			.get(
				{
					host: '127.0.0.1',
					port: PORT,
					path: '/api/library',
					headers: { Host: 'evil.example.com' },
				},
				(res) => {
					res.resume();
					resolve(res.statusCode);
				},
			)
			.on('error', reject);
	});
	check('unknown Host header is rejected', foreignStatus === 421);

	const page = await fetch(`${BASE}/`);
	check(
		'web app is served',
		page.ok && (await page.text()).includes('Chat Backup Browser'),
	);
} catch (err) {
	check('smoke test ran', false, err.message);
} finally {
	server?.kill();
	await rm(tmp, { recursive: true, force: true }).catch(() => {});
}

process.exit(failed ? 1 : 0);
