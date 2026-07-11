# HyeniMC 🚀

**A Minecraft launcher for the HyeniWorld community**

Manage and launch Minecraft with profiles, and install/update the HyeniWorld modpacks (HyeniPacks) with one click.

![Version](https://img.shields.io/badge/version-0.4.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-lightgrey)

[한국어](README.md) | **English**

---

## ⚠️ Important Notice

> **Image Copyright**  
> All Kang Hyeni–related images, illustrations, and artwork in this project are **copyrighted by Kang Hyeni**.  
> Unauthorized use, reproduction, distribution, or derivative works are prohibited. This launcher is **for the HyeniWorld community only**.  
> See [LICENSE.md](LICENSE.md) for details.

---

## 🧭 Project Layout (Two Apps)

HyeniMC consists of two apps that **share the React renderer (UI) and the SQLite database**.

| App | Stack | Audience | Role |
|-----|-------|----------|------|
| **User Launcher** | **Tauri v2 + Rust** | End users | Profiles, game launch, HyeniPacks, worker mods, resource/shader packs, crash reports. Lightweight, with self-updating. |
| **Creator Tool** | **Electron + Go** | Pack creators | HyeniPack authoring/export, mod & modpack search/install, dependency resolution, deployment management. **Feature-frozen** (hidden in the user launcher). |

> The single Electron launcher was **renewed into a Tauri + Rust user launcher**, while the original Electron app is **kept as a creator tool**. Both apps share the same `~/.hyenimc` (`%APPDATA%\hyenimc`) data in place. See [docs/architecture/](docs/architecture/) for the design.

---

## ✨ Features

### 🎮 User Launcher (Tauri)
- ✅ **Profile management**: create/edit/delete/favorite, isolated saves/mods/settings per profile
- ✅ **Game launch**: Vanilla · **Fabric · NeoForge · Forge** (loader auto-installed)
- ✅ **Microsoft login**: genuine accounts, multi-account, auto token refresh, **AES-256-GCM** encrypted storage
- ✅ **Java auto-detection**: scans installed JREs (lazily on tab open, no startup delay)
- ✅ **HyeniPacks (modpacks)**: online list/search install · local `.hyenipack` import · new-version detection → apply (preserves user files; blocks launch on breaking updates)
- ✅ **Worker mods**: sha256-verified install/update of required mods (HyeniHelper, etc.) for HyeniWorld server profiles
- ✅ **Resource/shader packs**: distinguishes pack-provided vs user-added (read-only) + open folder + live file watching
- ✅ **Crash reports**: export logs/report zip + open logs folder
- ✅ **Auto-update**: detect → download → replace install (removes an existing Electron build and preserves data)
- ✅ **Parallel downloads**: concurrent downloads + sha1/sha256 integrity checks + shared-resource dedup

### 🛠️ Creator Tool (Electron, creators only)
- ✅ **HyeniPack authoring/export** (manifest-based)
- ✅ **Mod search/install** (Modrinth · CurseForge) + **dependency resolution**
- ✅ **Modpack search/install** (.mrpack · .zip · CurseForge)
- ✅ **Deployment management** (integrated with the admin panel — publish/rollback mods & packs)

---

## 📦 Development & Build

### Prerequisites
- **Node.js** 20+ (shared renderer build)
- **Rust** stable (user launcher — Tauri v2)
- **Java** 17+ (to run the game)
- **Azure AD app** (for Microsoft login) — [Quickstart](docs/guides/QUICKSTART.md)
- *(Creator tool only)* **Go** 1.21+, **Buf CLI** (auto-installed via `npm install`)

### Environment
`build.rs`/`generate:config` reads `.env` at build time.
```bash
cp .env.example .env
# HYENIMC_WORKER_URL        : Cloudflare Worker URL
# AZURE_CLIENT_ID           : Azure Portal OAuth Client ID
# AUTHORIZED_SERVER_DOMAINS : allowed auth server domains
```

### User Launcher (Tauri)
```bash
npm install
npm run dev:tauri      # dev (vite + Rust app, hot reload)
npm run build:tauri    # release bundle (Windows NSIS / macOS dmg)
```
> `sync-version` propagates the `package.json` version into `tauri.conf.json`/`Cargo.toml` (single source of truth).

### Creator Tool (Electron)
```bash
npm run dev            # Electron dev (requires the Go backend)
npm run backend:build:win-x64   # build the Go sidecar (or :mac-arm64 / :mac-x64)
npm run package:win    # package (or :mac)
```
> The two apps share the same SQLite DB, so **running them at the same time is not recommended**.

### Release (User Launcher)
Pushing a `v*.*.*` tag runs [`.github/workflows/release-launcher.yml`](.github/workflows/release-launcher.yml), which builds & signs Windows/macOS bundles and publishes them plus `latest.json` (update feed) to a GitHub Release.

Required repo secrets: `TAURI_SIGNING_PRIVATE_KEY`, `HYENIMC_WORKER_URL`, `AZURE_CLIENT_ID`, `AUTHORIZED_SERVER_DOMAINS`. See the [QA & release doc](docs/architecture/QA_AND_RELEASE.md).

---

## 🏛️ Architecture

```
HyeniMC/
├── apps/launcher/          # User launcher (Tauri v2)
│   └── src-tauri/          # Rust app crate (hyenimc-app) + tauri.conf.json
├── crates/                 # Rust workspace
│   ├── hyenimc-core/       # DB, settings, accounts, token store
│   └── hyenimc-launcher/   # download, install, loaders, launch, HyeniPack, worker mods
├── src/
│   ├── renderer/           # React UI (shared by both apps)
│   ├── main/               # Creator-tool Electron main process
│   └── shared/             # shared types/constants
├── backend/                # Creator-tool Go backend (sidecar)
├── cloudflare-worker/      # deployment Worker + admin panel (/admin)
└── docs/                   # design, QA, guides
```

### Tech Stack
- **User launcher**: Tauri v2, Rust, rusqlite, reqwest, tauri-plugin-{updater,log,deep-link}
- **Creator tool**: Electron, Node.js, Go 1.21 (gRPC sidecar)
- **Shared renderer**: React 18, TypeScript, TailwindCSS, Vite
- **Mod loaders**: Fabric, NeoForge, Forge
- **Auth**: Microsoft OAuth 2.0, AES-256-GCM encryption, HyeniWorld deep-link auth (`hyenimc://`)
- **Update/deploy**: Tauri updater (user launcher, GitHub Releases + `latest.json`), electron-updater (creator tool)

---

## 📋 Roadmap

### ✅ Tauri renewal (M0–M6, done — v0.4.0)
- ✅ Rust workspace + Tauri v2 shell + **in-place SQLite** compatibility
- ✅ Profiles, accounts, game launch (Vanilla/Fabric/NeoForge/Forge), Java detection
- ✅ HyeniPack install/update, worker-mod management, resource/shader packs, crash reports
- ✅ Auto-update + Windows replace install (removes the Electron build, preserves data)
- ✅ End-to-end release pipeline proven (tag → signed bundles + `latest.json`)

### 🚧 Remaining
- 🔜 Final QA: breaking-update blocking, crash-report export
- 🔜 **macOS replace install** (Developer ID signing/notarization)
- 🔜 Electron → Tauri **migration bridge** (final electron-updater `latest.yml` release)

Details: [QA & release matrix](docs/architecture/QA_AND_RELEASE.md)

### 💡 Phase 11: Planned features
- 🔜 **Skin management** - change & preview skins
- 🔜 **Server list** - manage favorite servers
- 🔜 **World backup** - automatic backup & restore
- 🔜 **Performance profiles** - low-/high-spec optimization presets

---

## 📚 Documentation

All docs live in [docs/](docs/).

- **[Architecture/design](docs/architecture/)** — system design, HyeniPack spec, auth protocol, QA & release
- **[Quickstart](docs/guides/QUICKSTART.md)** — Microsoft OAuth setup
- **[Full doc index](docs/README.md)**

---

## 📄 License & Copyright

### Software License
The source code of this project is under the **MIT License**.

### ⚠️ Important: Image & Artwork Copyright

**All Kang Hyeni–related images, illustrations, and artwork in this project are copyrighted by Kang Hyeni.**

- ❌ **No unauthorized use**: Kang Hyeni images/illustrations may not be used without explicit permission from the copyright holder.
- ❌ **No commercial use**: any form of commercial use is prohibited.
- ❌ **Restricted derivatives**: derivative works/modifications without permission are prohibited.
- ✅ **Allowed scope**: this launcher may only be used for Kang Hyeni and the HyeniWorld community.
- 🔓 **Special permission**: use is allowed within the granted scope with explicit written permission from the copyright holder (Kang Hyeni).

### Usage Restrictions
This program is made **exclusively for Kang Hyeni and the HyeniWorld community**.
- Use for other purposes is not permitted.
- It may not be used for other streamers, communities, or servers.
- Any derivative launcher based on this program must remove all Kang Hyeni–related images and branding.

See [LICENSE.md](LICENSE.md) for details.

---

## 👨‍💻 Credits

Made with ❤️ for HyeniWorld

**⚠️ Disclaimer**: This project is not officially affiliated with Mojang Studios. Minecraft is a trademark of Mojang Studios.
