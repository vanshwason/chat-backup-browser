<h1 align="center">Chat Backup Browser</h1>

<p align="center">
  <img src="static/icon.png" width="112" height="112" alt="" />
</p>

<p align="center">
  <b>Browse your WhatsApp chat exports offline, on your computer and on your phone.</b><br/>
  Fast with huge chats. Nothing leaves your devices.
</p>

<p align="center">
  <a href="https://github.com/vanshwason/chat-backup-browser/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/vanshwason/chat-backup-browser/ci.yml?branch=dev&style=flat-square&label=checks" alt="Checks" /></a>
  <a href="https://github.com/vanshwason/chat-backup-browser/releases/latest"><img src="https://img.shields.io/github/v/release/vanshwason/chat-backup-browser?style=flat-square" alt="Latest release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square" alt="AGPL-3.0" /></a>
</p>

> Not affiliated with, endorsed or sponsored by WhatsApp or Meta. Based on
> [whats-reader](https://github.com/rodrigogs/whats-reader) by Rodrigo Gomes da Silva. See [NOTICE.md](NOTICE.md).

---

## What it does

Export a chat from WhatsApp ("Export chat", with media). You get a `.zip`. Open
it here and you get the whole conversation back, looking like WhatsApp:

- **Messages, photos, videos, voice notes, stickers and documents**, inline
- **Search** inside a chat or across all your chats
- **Media gallery** by date, with filters and bulk download
- **Bookmarks** with notes
- **Statistics**: who talks most, when, media per person, calls, view-once, replies
- **View as**: pick which participant is you, so your messages sit on the right
- **Voice note transcription** with Whisper, running on your device
- **Light and dark themes**, 10 interface languages

### Three ways to use it

| | What it is | Best for |
|---|---|---|
| **Desktop app** | Windows, macOS or Linux app | Everyday reading. Reopens your chats automatically. |
| **Phone** | Your computer serves the chats to your phone over your own private network ([Tailscale](https://tailscale.com)) | Reading on the go, with a WhatsApp-style mobile layout |
| **Web** | Runs in any browser, nothing installed | Trying it out |

All three use the same code, and all processing happens on your own devices.

## Get started

**Just want the app?** Download the installer for your system from the [latest release](https://github.com/vanshwason/chat-backup-browser/releases/latest).

To build it yourself or set up phone access, follow **[docs/SETUP.md](docs/SETUP.md)**. In short:

```bash
git clone https://github.com/vanshwason/chat-backup-browser.git
cd chat-backup-browser
npm install
npm run dev              # web version at http://localhost:5173
npm run electron:build   # desktop installer in dist-electron/
```

You need [Node.js](https://nodejs.org/) 22.12 or newer (24 recommended).

## Exporting a chat from WhatsApp

**Android:** open the chat → **⋮** → **More** → **Export chat** → **Include media**.<br/>
**iPhone:** open the chat → tap the name at the top → **Export Chat** → **Attach Media**.

Save the `.zip` to your computer. Big chats can take a few minutes to export.

## Privacy

- Works fully offline once loaded. No accounts, analytics, telemetry or cookies.
- ZIPs are read on your device. The phone server only listens on your own
  computer and is reached through your private Tailscale network, never the
  public internet.
- Open source under AGPL-3.0, so you can check all of it. Open DevTools →
  Network while using the app to see that nothing is sent anywhere.

The one exception is voice note transcription. The first time you use it, it
downloads the Whisper speech model; after that it runs locally.

## Development

| Command | What it does |
|---|---|
| `npm run dev` | Web app with hot reload at localhost:5173 |
| `npm run electron:dev` | Desktop app in development mode |
| `npm run build` | Production web build into `build/` |
| `npm run electron:build` | Desktop installer for your OS into `dist-electron/` |
| `npm run check` | TypeScript and Svelte checks |
| `npm run lint` / `npm run lint:fix` | Biome lint and format |
| `npm test` | Unit tests (Vitest) |
| `node branding/generate-icons.mjs` | Rebuild every icon from `branding/logo.svg` |

Built with SvelteKit and Svelte 5, Tailwind CSS 4, Electron, JSZip,
Transformers.js and Paraglide JS. See [CONTRIBUTING.md](CONTRIBUTING.md) for
conventions; performance with huge chats is a hard requirement.

Example chats for testing are in [`examples/chats/`](examples/chats/).

## License

[AGPL-3.0](LICENSE). Copyright © Rodrigo Gomes da Silva and contributors
(original whats-reader), and © 2026 vanshwason (Chat Backup Browser changes).
