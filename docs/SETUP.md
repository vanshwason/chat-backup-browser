# Setup guide

This guide sets up Chat Backup Browser in two parts:

1. **The desktop app** on your computer.
2. **Phone access**, optional: your computer serves your chats to your phone.

Commands are for Windows (PowerShell). macOS and Linux work the same way
except where noted.

---

## 0. What you need

| Requirement | Why | Get it |
|---|---|---|
| **Node.js 22.12+** (24 recommended) | Builds and runs the app | [nodejs.org](https://nodejs.org/), LTS installer |
| **Git** | Downloads the code | [git-scm.com](https://git-scm.com/) |
| **About 2 GB of free disk space** | Dependencies and build output | |
| **WhatsApp chat exports** (`.zip`) | Your chats | See [Exporting a chat](#exporting-a-chat) |
| **Tailscale** on computer and phone | Phone access only | [tailscale.com/download](https://tailscale.com/download) |

Check Node:

```bash
node --version
```

## 1. Get the code

```bash
git clone https://github.com/vanshwason/chat-backup-browser.git
cd chat-backup-browser
npm install
```

`npm install` takes a few minutes the first time.

---

## 2. Desktop app

### Build and install

```bash
npm run electron:build:win
```

On macOS use `npm run electron:build:mac`, on Linux `npm run electron:build:linux`.

The installer is written to `dist-electron/`, for example
`Chat Backup Browser-Setup-<version>-x64.exe`. Run it.

The installer isn't code-signed, so Windows SmartScreen may warn that the app
is unrecognised. Choose **More info → Run anyway**.

### Coming from WhatsApp Backup Reader

If you used the original app (whats-reader / "WhatsApp Backup Reader"),
Chat Backup Browser copies your saved chats, bookmarks and settings from it the
first time it starts. After checking that everything is there, uninstall
**WhatsApp Backup Reader** from *Settings → Apps*. Otherwise its own updater
keeps installing upstream versions.

### Using it

- Drag `.zip` exports onto the window, or click the drop area to pick them.
- Chats you open are remembered. Next time you start the app, they reopen by
  themselves.
- Close a chat with **×** in the sidebar and it won't reopen. To also forget
  its bookmarks and settings, switch off **Remember conversation** first.
- If you move or delete a ZIP, the app tells you on the next start. Open it
  again from its new location.

### Run without installing (development)

```bash
npm run electron:dev
```

---

## 3. Phone access (optional)

Your computer keeps your chat exports in one folder and runs a small private
server. Your phone opens it through **Tailscale**, a private network between
your own devices. The server only listens on your computer itself
(`127.0.0.1`); nothing is reachable from the internet.

```
Phone (Safari/Chrome) ──Tailscale (encrypted, private)──► your computer
                                                         tailscale serve → 127.0.0.1:8190
                                                         server/wa-server.mjs
                                                         Documents\WA\*.zip
```

### 3.1 Put your exports in the chats folder

Create `Documents\WA` and copy your WhatsApp export `.zip` files into it.

To use a different folder, set the `WA_DIR` environment variable before
starting the server.

### 3.2 Build the web app

```bash
npm run build
```

The server serves this build. Run it again whenever you update the code.

### 3.3 Start the server automatically at logon (Windows)

```powershell
powershell -ExecutionPolicy Bypass -File server\install-autostart.ps1
```

This registers a hidden task called **Chat Backup Browser server** and starts
it. It also removes the task from older versions ("WhatsApp Reader server").

- Log: `%LOCALAPPDATA%\ChatBackupBrowser\server.log`
- Unpacked chats (cache): `%LOCALAPPDATA%\ChatBackupBrowser\cache`
- Remove it: add `-Uninstall` to the command above.

On macOS or Linux, or to run it by hand:

```bash
node server/wa-server.mjs
```

The first start unpacks every ZIP once. A 700 MB export takes under a minute.
Later starts reuse the unpacked files.

### 3.4 Set up Tailscale

1. Install Tailscale on the computer and on the phone, and sign in to **the
   same account** on both.
2. On the computer, publish the server to your private network:

   ```bash
   tailscale serve --bg 8190
   ```

3. Find the address:

   ```bash
   tailscale serve status
   ```

   It looks like `https://<computer-name>.<tailnet>.ts.net`.

### 3.5 Open it on your phone

1. Make sure **Tailscale is switched on** in the phone's Tailscale app.
2. Open the `https://….ts.net` address in Safari or Chrome.
3. Optional: **Share → Add to Home Screen** to use it like an app.

The first time you open each chat, it asks **"Which one is you?"** so your
messages appear on the right. Your answer is remembered on that phone.

### Adding or updating chats

- **Add:** copy the new export `.zip` into `Documents\WA`, then reload the page
  on your phone. No restart needed.
- **Update:** replace the old ZIP with the new export. It's unpacked again
  automatically.
- **Remove:** delete the ZIP and reload.

---

## Exporting a chat

**Android:** open the chat → **⋮** → **More** → **Export chat** → **Include media**.

**iPhone:** open the chat → tap the contact or group name → **Export Chat** →
**Attach Media**.

Send the `.zip` to your computer (Drive, AirDrop, USB, email to yourself).

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Phone: "server can't be found" | Tailscale is off on the phone, or the computer is asleep or offline. Turn Tailscale on in the phone app. |
| Phone: page loads but no chats | No ZIPs in `Documents\WA`, or the server isn't running. Check `server.log`. |
| Server not running after a reboot | Run `Start-ScheduledTask -TaskName 'Chat Backup Browser server'`, or reinstall with `install-autostart.ps1`. |
| "The web app isn't built yet" | Run `npm run build`, then the install script again. |
| Desktop app shows an old version | Uninstall WhatsApp Backup Reader; reinstall from `dist-electron/`. |
| A chat is slow | Report it with the chat's message count. Speed with huge chats is a priority. |
