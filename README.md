# ClipStack

**A lightweight, privacy-first clipboard manager for macOS and Windows.**

ClipStack lives silently in your menu bar or system tray, capturing everything you copy and making it instantly searchable with a global keyboard shortcut. All data stays on your device — no cloud, no telemetry, no tracking.

---

## Features

- **Automatic capture** — silently monitors your clipboard at all times
- **Persistent history** — survives restarts, stored in a local SQLite database
- **Instant search** — filter your entire history as you type
- **Pin clips** — keep frequently used clips at the top
- **One-key access** — global shortcut (`⌘⇧V` / `Ctrl+Shift+V`) opens the overlay from anywhere
- **Keyboard navigation** — arrow keys + Enter to copy without touching the mouse
- **Image support** — captures and previews copied images
- **Dark & light mode** — follows system preference automatically
- **Privacy-first** — 100% local, no accounts, no internet connection required
- **Minimal footprint** — < 30 MB RAM, < 0.1% CPU when idle
- **Launch at startup** — runs before you even log in

---

## Screenshots

> _Screenshots coming soon. Run the app locally to see it in action._

| Clipboard History | Settings |
|---|---|
| _(screenshot placeholder)_ | _(screenshot placeholder)_ |

---

## Installation

### macOS

1. Download `ClipStack_x.x.x_aarch64.dmg` (Apple Silicon) or `ClipStack_x.x.x_x64.dmg` (Intel) from the [Releases](../../releases) page.
2. Open the `.dmg` and drag **ClipStack** to your Applications folder.
3. Launch ClipStack from Applications. macOS may ask you to confirm opening an app from an unidentified developer — click **Open**.
4. ClipStack will appear in your menu bar. Press `⌘⇧V` to open the history overlay.

### Windows

1. Download `ClipStack_x.x.x_x64-setup.exe` from the [Releases](../../releases) page.
2. Run the installer and follow the prompts.
3. ClipStack starts automatically and appears in the system tray.
4. Press `Ctrl+Shift+V` to open the history overlay.

---

## Building from Source

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| **Rust** | ≥ 1.77 | [rustup.rs](https://rustup.rs) |
| **Node.js** | ≥ 20 | [nodejs.org](https://nodejs.org) |
| **npm** | ≥ 10 | bundled with Node |
| **Xcode CLI tools** | latest | macOS only — `xcode-select --install` |

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/clipstack.git
cd clipstack

# 2. Install JavaScript dependencies
npm install

# 3. Start in development mode (hot-reload)
npm run tauri dev

# 4. Build a production binary for your current platform
npm run tauri build
```

The production output will be in `src-tauri/target/release/bundle/`.

---

## Project Structure

```
clipstack/
├── src/                        # React + TypeScript frontend
│   ├── components/             # UI components
│   │   ├── ClipItem.tsx        # Single clipboard entry row
│   │   ├── ClipList.tsx        # Scrollable history list
│   │   ├── ConfirmDialog.tsx   # Modal confirmation prompt
│   │   ├── SearchBar.tsx       # Search input
│   │   └── SettingsPanel.tsx   # Settings view
│   ├── hooks/                  # React hooks
│   │   ├── useClips.ts         # Clipboard history state + actions
│   │   ├── useKeyboard.ts      # Arrow key / Enter navigation
│   │   └── useSettings.ts      # Settings load + persist
│   ├── lib/                    # Shared utilities
│   │   ├── api.ts              # Typed Tauri invoke wrappers
│   │   └── formatTime.ts       # Relative timestamp formatter
│   ├── types/                  # TypeScript type definitions
│   │   └── index.ts
│   ├── App.tsx                 # Root component
│   ├── index.css               # Design system + component styles
│   └── main.tsx                # React entry point
│
├── src-tauri/                  # Rust + Tauri backend
│   ├── src/
│   │   ├── clipboard.rs        # Background clipboard monitor thread
│   │   ├── commands.rs         # Tauri IPC commands (frontend API)
│   │   ├── db.rs               # SQLite persistence layer
│   │   ├── lib.rs              # App setup and wiring
│   │   ├── main.rs             # Binary entry point
│   │   ├── state.rs            # Shared app state (AppState, Settings)
│   │   └── tray.rs             # System tray / menu bar setup
│   ├── capabilities/
│   │   └── default.json        # Tauri permission declarations
│   ├── icons/                  # App icons for all platforms
│   ├── Cargo.toml              # Rust dependencies
│   ├── build.rs                # Tauri build script
│   └── tauri.conf.json         # Tauri app configuration
│
├── index.html                  # HTML entry point
├── vite.config.ts              # Vite bundler config
├── tsconfig.json               # TypeScript config
├── package.json                # npm dependencies + scripts
├── .gitignore
├── LICENSE                     # MIT
└── README.md
```

---

## Settings

Open the settings panel by clicking the gear icon in the top-right of the overlay.

| Setting | Default | Description |
|---|---|---|
| Global Shortcut | `CommandOrControl+Shift+V` | Keyboard shortcut to open ClipStack |
| History Limit | 500 | Maximum clips retained (oldest deleted first) |
| Appearance | System | Follow system / force dark / force light |
| Launch at Startup | On | Start ClipStack when you log in |
| Excluded Apps | _(none)_ | Apps whose clipboard events are ignored |

---

## Privacy

- **All data is stored locally** in a SQLite database at:
  - macOS: `~/Library/Application Support/com.clipstack.app/clipstack.db`
  - Windows: `%APPDATA%\com.clipstack.app\clipstack.db`
- **No network requests** are ever made by ClipStack.
- **No analytics, telemetry, or crash reporting.**
- You can delete the database file at any time to wipe all history.

---

## Contributing

Pull requests are welcome. Please open an issue first to discuss what you'd like to change.

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes with a clear message
4. Open a PR against `main`

---

## License

[MIT](LICENSE) © ClipStack Contributors
