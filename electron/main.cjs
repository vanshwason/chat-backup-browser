const {
	app,
	BrowserWindow,
	ipcMain,
	protocol,
	Menu,
	session,
	shell,
} = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const fs = require('node:fs');

let mainWindow;

// One-time migration from the app's previous name. Saved chats, bookmarks and
// settings live in the user-data folder, which is named after the product.
// Copy the storage folders over before Chromium opens them.
const LEGACY_USER_DATA = path.join(
	app.getPath('appData'),
	'WhatsApp Backup Reader',
);
const STORAGE_DIRS = ['IndexedDB', 'Local Storage'];
try {
	const userData = app.getPath('userData');
	if (
		userData !== LEGACY_USER_DATA &&
		fs.existsSync(LEGACY_USER_DATA) &&
		!STORAGE_DIRS.some((dir) => fs.existsSync(path.join(userData, dir)))
	) {
		for (const dir of STORAGE_DIRS) {
			const from = path.join(LEGACY_USER_DATA, dir);
			if (fs.existsSync(from)) {
				fs.cpSync(from, path.join(userData, dir), { recursive: true });
			}
		}
	}
} catch (err) {
	console.error('[Migration] Could not copy previous app data:', err);
}

// Configure auto-updater
autoUpdater.autoDownload = false; // Manual download control
autoUpdater.autoInstallOnAppQuit = true; // Install when app quits

// Get the build directory path
const getBuildPath = () => {
	// In production, __dirname is inside the app.asar
	return path.join(__dirname, '../build');
};

const DEV_URL = 'http://localhost:5173';
const REPO_PATH = '/vanshwason/chat-backup-browser';
// What the app may ask of the browser. Everything else is refused.
const ALLOWED_PERMISSIONS = new Set([
	'clipboard-sanitized-write',
	'fullscreen',
]);

const isAppUrl = (url) =>
	url.startsWith('app://localhost/') ||
	(process.env.NODE_ENV === 'development' && url.startsWith(DEV_URL));

// Only web links reach the OS: file:, smb: and the like could run something.
const openInBrowser = (url) => {
	try {
		const { protocol: scheme } = new URL(url);
		if (scheme === 'https:' || scheme === 'http:') shell.openExternal(url);
	} catch {
		// Not a URL: nothing to open
	}
};

// The renderer can only reach ZIP files, never arbitrary paths.
const validZipPath = (filePath) => {
	if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return null;
	if (filePath.split(/[/\\]+/).includes('..')) return null;
	const normalized = path.resolve(filePath);
	return path.extname(normalized).toLowerCase() === '.zip' ? normalized : null;
};

const createWindow = () => {
	// Build window options
	const windowOptions = {
		width: 1200,
		height: 800,
		minWidth: 800,
		minHeight: 600,
		webPreferences: {
			preload: path.join(__dirname, 'preload.cjs'),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
		titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
		backgroundColor: '#ECE5DD',
		icon: path.join(
			__dirname,
			'../static',
			process.platform === 'win32' ? 'icon.ico' : 'icon.png',
		),
		// Hide menu bar on Windows
		autoHideMenuBar: true,
	};

	// Only apply trafficLightPosition on macOS
	if (process.platform === 'darwin') {
		windowOptions.trafficLightPosition = { x: 15, y: 12 };
	}

	// Remove menu bar completely on Windows
	if (process.platform === 'win32') {
		Menu.setApplicationMenu(null);
	}

	// Create the browser window.
	mainWindow = new BrowserWindow(windowOptions);

	// This window only ever shows the app. Links open in the default browser.
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		openInBrowser(url);
		return { action: 'deny' };
	});
	mainWindow.webContents.on('will-navigate', (event, url) => {
		if (!isAppUrl(url)) {
			event.preventDefault();
			openInBrowser(url);
		}
	});

	// In development, load from Vite dev server
	// In production, load from built files using custom protocol
	if (process.env.NODE_ENV === 'development') {
		mainWindow.loadURL('http://localhost:5173');
		mainWindow.webContents.openDevTools();
	} else {
		// Load root path, not /index.html - SvelteKit router needs the path to be /
		mainWindow.loadURL('app://localhost/');
	}
};

// Register custom protocol for serving local files
// This allows absolute paths like /favicon.ico to work
protocol.registerSchemesAsPrivileged([
	{
		scheme: 'app',
		privileges: {
			standard: true,
			secure: true,
			supportFetchAPI: true,
		},
	},
]);

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(() => {
	session.defaultSession.setPermissionRequestHandler(
		(_webContents, permission, callback) => {
			callback(ALLOWED_PERMISSIONS.has(permission));
		},
	);

	// Register protocol handler for 'app://' scheme
	protocol.handle('app', async (request) => {
		// Parse the URL to get just the pathname
		const requestUrl = new URL(request.url);
		let pathname = requestUrl.pathname;

		// Remove leading slash and decode
		pathname = decodeURIComponent(pathname.replace(/^\/+/, ''));

		// Default to index.html for empty path or root
		if (!pathname || pathname === '' || pathname === '.') {
			pathname = 'index.html';
		}

		const buildPath = getBuildPath();
		const filePath = path.resolve(buildPath, pathname);

		// The pathname is decoded, so "..%2F" must not escape the build folder
		if (!filePath.startsWith(buildPath + path.sep)) {
			return new Response('Forbidden', { status: 403 });
		}

		// Determine MIME type based on extension
		const ext = path.extname(pathname).toLowerCase();
		const mimeTypes = {
			'.html': 'text/html',
			'.js': 'text/javascript',
			'.mjs': 'text/javascript',
			'.css': 'text/css',
			'.json': 'application/json',
			'.png': 'image/png',
			'.jpg': 'image/jpeg',
			'.jpeg': 'image/jpeg',
			'.gif': 'image/gif',
			'.svg': 'image/svg+xml',
			'.ico': 'image/x-icon',
			'.woff': 'font/woff',
			'.woff2': 'font/woff2',
			'.ttf': 'font/ttf',
			'.wasm': 'application/wasm',
			'.webmanifest': 'application/manifest+json',
		};
		const mimeType = mimeTypes[ext] || 'application/octet-stream';

		try {
			// Read file using fs (works with ASAR)
			const data = fs.readFileSync(filePath);
			return new Response(data, {
				headers: {
					'Content-Type': mimeType,
					'X-Content-Type-Options': 'nosniff',
				},
			});
		} catch (err) {
			console.error('[Protocol] Error reading file:', filePath, err.message);
			return new Response('Not Found', { status: 404 });
		}
	});

	createWindow();

	// Setup auto-updater (production only)
	if (process.env.NODE_ENV !== 'development') {
		setupAutoUpdater();
	}

	// On OS X it's common to re-create a window in the app when the
	// dock icon is clicked and there are no other windows open.
	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});

// IPC Handlers for file operations
// Size of a ZIP, or null if it isn't there (for example moved or deleted)
ipcMain.handle('file:zipSize', async (_event, filePath) => {
	const normalized = validZipPath(filePath);
	if (!normalized) return null;
	try {
		const stat = await fs.promises.lstat(normalized);
		return stat.isFile() && !stat.isSymbolicLink() ? stat.size : null;
	} catch {
		return null;
	}
});

// Read part of a ZIP, so large exports never have to be held in memory
ipcMain.handle(
	'file:readZipRange',
	async (_event, filePath, offset, length) => {
		const normalized = validZipPath(filePath);
		if (
			!normalized ||
			!Number.isSafeInteger(offset) ||
			!Number.isSafeInteger(length) ||
			offset < 0 ||
			length < 0
		) {
			throw new Error('Invalid read request');
		}
		const stat = await fs.promises.lstat(normalized);
		if (!stat.isFile() || stat.isSymbolicLink()) {
			throw new Error('Path is not a regular file');
		}
		const size = Math.min(length, Math.max(0, stat.size - offset));
		const data = new ArrayBuffer(size);
		const fd = await fs.promises.open(normalized, fs.constants.O_RDONLY);
		try {
			await fd.read(new Uint8Array(data), 0, size, offset);
		} finally {
			await fd.close();
		}
		return data;
	},
);

// Read file from absolute path (for persistence)
ipcMain.handle('file:readFromPath', async (_event, filePath) => {
	try {
		const normalized = validZipPath(filePath);
		if (!normalized) {
			return { success: false, error: 'Invalid file path' };
		}

		// Pre-check with lstat to reject symlinks (works cross-platform including Windows)
		const lst = await fs.promises.lstat(normalized);
		if (!lst.isFile() || lst.isSymbolicLink()) {
			return { success: false, error: 'Path is not a regular file' };
		}

		// Use O_NOFOLLOW when available to reject symlinks atomically (not supported on Windows)
		const openFlags =
			typeof fs.constants.O_NOFOLLOW === 'number'
				? fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
				: fs.constants.O_RDONLY;
		const fd = await fs.promises.open(normalized, openFlags);
		try {
			const content = await fd.readFile();
			return {
				success: true,
				buffer: content.buffer.slice(
					content.byteOffset,
					content.byteOffset + content.byteLength,
				),
				name: path.basename(normalized),
			};
		} finally {
			await fd.close();
		}
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
});

ipcMain.handle('shell:openExternal', async (_event, url) => {
	// Only this project's own GitHub pages may be opened from here
	const parsed = new URL(url);
	if (
		parsed.protocol !== 'https:' ||
		parsed.hostname !== 'github.com' ||
		(parsed.pathname !== REPO_PATH &&
			!parsed.pathname.startsWith(`${REPO_PATH}/`))
	) {
		throw new Error('Invalid URL');
	}
	await shell.openExternal(url);
});
// Auto-updater setup and IPC handlers
function setupAutoUpdater() {
	// Check for updates on startup (after 5 seconds to let app stabilize)
	setTimeout(() => {
		autoUpdater.checkForUpdates().catch((err) => {
			console.error('Auto-updater check failed:', err);
		});
	}, 5000);

	// Auto-updater events
	autoUpdater.on('checking-for-update', () => {
		sendUpdateStatusToRenderer('checking-for-update');
	});

	autoUpdater.on('update-available', (info) => {
		sendUpdateStatusToRenderer('update-available', info);
	});

	autoUpdater.on('update-not-available', (info) => {
		sendUpdateStatusToRenderer('update-not-available', info);
	});

	autoUpdater.on('error', (err) => {
		sendUpdateStatusToRenderer('error', { message: err.message });
	});

	autoUpdater.on('download-progress', (progressObj) => {
		sendUpdateStatusToRenderer('download-progress', progressObj);
	});

	autoUpdater.on('update-downloaded', (info) => {
		sendUpdateStatusToRenderer('update-downloaded', info);
	});
}

function sendUpdateStatusToRenderer(event, data = {}) {
	if (mainWindow && !mainWindow.isDestroyed()) {
		mainWindow.webContents.send('auto-update-status', { event, data });
	}
}

// IPC handlers for manual update control
ipcMain.handle('updater:checkForUpdates', async () => {
	try {
		const result = await autoUpdater.checkForUpdates();
		return { success: true, data: result };
	} catch (error) {
		return { success: false, error: error.message };
	}
});

ipcMain.handle('updater:downloadUpdate', async () => {
	try {
		await autoUpdater.downloadUpdate();
		return { success: true };
	} catch (error) {
		return { success: false, error: error.message };
	}
});

ipcMain.handle('updater:quitAndInstall', () => {
	autoUpdater.quitAndInstall(false, true);
});
