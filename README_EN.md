# HyeniMC 🚀

**Beautiful and Fast Cross-Platform Minecraft Launcher**

A profile-based Minecraft launcher for the HyeniWorld community.

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)

[한국어](README.md) | **English**

---

## ⚠️ Important Notice

> **Image Copyright Notice**  
> All Hyeni-related images, illustrations, and artwork included in this project are **copyrighted by Hyeni**.  
> Unauthorized use, reproduction, distribution, and derivative works are prohibited. This launcher is **exclusively for the HyeniWorld community**.  
> For details, please refer to [LICENSE.md](LICENSE.md) or [LICENSE_EN.md](LICENSE_EN.md).

---

## ✨ Key Features

### 🎮 Game Management
- ✅ **Profile Management**: Create, edit, and delete multiple profiles
- ✅ **Profile Isolation**: Independent saves, mods, and settings for each profile
- ✅ **Version Selection**: Support for all Minecraft versions (1.0 ~ latest)
- ✅ **Auto Download**: Automatic download of game files, libraries, and assets
- ✅ **Parallel Downloads**: **4x faster** with up to 20 concurrent downloads

### 🔐 Account Management
- ✅ **Microsoft Login**: Multiplayer with genuine accounts
- ✅ **Offline Mode**: Support for singleplayer and cracked servers
- ✅ **Multi-Account**: Add and switch between multiple accounts
- ✅ **Auto Token Refresh**: Automatically maintain login status
- ✅ **Encrypted Storage**: Secure token storage with AES-256-GCM

### ⚙️ System
- ✅ **Auto Java Detection**: Automatically detect all Java installations
- ✅ **Platform Optimization**: macOS (Apple Silicon/Intel), Windows, Linux support
- ✅ **Retry Logic**: Automatic retry on network errors (exponential backoff)
- ✅ **Checksum Verification**: File integrity with SHA1 hash
- ✅ **Shared Resources**: Save disk space by preventing library/asset duplication

### 🧩 Mods & Modpacks
- ✅ **Mod Loaders**: Full support for Fabric, NeoForge, Quilt
- ✅ **Mod Search**: Integrated search for Modrinth and CurseForge
- ✅ **Auto Updates**: Check and update installed mods to latest versions
- ✅ **Dependency Resolution**: Automatically install required mods
- ✅ **Modpack Support**: Import and install .mrpack, .zip files
- ✅ **HyeniHelper**: Automatic management of HyeniWorld-exclusive mod

### 🎨 Resources & Customization
- ✅ **Resource Packs**: Install, activate, and manage
- ✅ **Shader Packs**: Support for Optifine and Iris shaders
- ✅ **Real-time Detection**: Automatically detect and reflect file changes

### 🎨 UI/UX
- ✅ **Modern Design**: Clean and intuitive interface
- ✅ **Real-time Progress**: Overall & individual file progress display
- ✅ **Dark Mode**: Eye-friendly dark theme
- ✅ **Hyeni Theme**: Custom theme exclusive to HyeniWorld

---

## 📦 Installation & Development

### Prerequisites
- **Node.js** 18+
- **Go** 1.21+
- **Java** 17+ (for running the game)
- **Azure AD App** (for Microsoft login) - [Quick Setup Guide](docs/guides/QUICKSTART.md)
- **Buf CLI** (for Protobuf code generation) - Automatically installed via `npm install`

### Development Setup

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/HyeniMC.git
cd HyeniMC

# 2. Install dependencies
npm install

# 3. Generate Protobuf code
npm run proto:gen

# 4. Microsoft login setup
# Register Azure AD app following docs/guides/SETUP_GUIDE.md
cd src/main/services
cp auth-config.example.ts auth-config.ts
# Enter Client ID in auth-config.ts
cd ../../..

# 5. Build backend
npm run backend:build:mac-universal  # macOS
# or
npm run backend:build:win-x64        # Windows

# 6. Run in development mode
npm run dev
```

### Build & Package

```bash
# Generate Protobuf code (required)
npm run proto:gen

# Production build
npm run build

# Platform-specific packaging (includes backend build)
npm run package:mac    # macOS
npm run package:win    # Windows
npm run package:linux  # Linux
```

### GitHub Actions Automated Deployment

For releases, GitHub Secrets configuration is required:

1. **GitHub Repository → Settings → Secrets and variables → Actions**
2. Add the following Secret:
   - `AZURE_CLIENT_ID`: Microsoft OAuth Client ID from Azure Portal

For more details, refer to the [Version Management Guide](docs/deployment/VERSION_MANAGEMENT.md).

---

## 🏛️ Architecture

```
HyeniMC/
├── src/
│   ├── main/              # Electron main process
│   │   ├── backend/       # Go backend server (HTTP API)
│   │   ├── services/      # Game launcher, download manager
│   │   └── ipc/           # IPC handlers
│   ├── renderer/          # React UI
│   │   ├── components/    # React components
│   │   └── pages/         # Pages
│   └── shared/            # Shared types/constants
├── proto/                 # gRPC protocol definitions
└── bin/                   # Built executables
```

### Tech Stack
- **Frontend**: React 18, TypeScript, TailwindCSS, Vite, Zustand
- **Backend**: Electron 28, Node.js, Go 1.21
- **API Integration**: Modrinth API, CurseForge API (Cloudflare Worker)
- **Mod Loaders**: Fabric, NeoForge, Quilt
- **Authentication**: Microsoft OAuth 2.0, AES-256-GCM encryption
- **Auto Updates**: electron-updater, GitHub Releases

---

## 🚀 Performance Optimization

- **Parallel Downloads**: 4x faster with 20 concurrent connections
- **Checksum Verification**: File integrity with SHA1 hash
- **Incremental Downloads**: Skip already downloaded files
- **Memory Optimization**: Minimize memory usage with streaming downloads

---

## 📋 Development Roadmap

### ✅ Phase 1-4: Basic Launcher (Completed)
- ✅ Profile management (create, edit, delete, clone)
- ✅ Version management (all Minecraft versions)
- ✅ Auto Java detection and management
- ✅ Vanilla Minecraft execution
- ✅ Profile isolation and independent path structure
- ✅ Parallel download optimization (20 concurrent)
- ✅ Auto-update system

### ✅ Phase 5: Account Management (Completed)
- ✅ Microsoft OAuth 2.0 login
- ✅ Offline account support
- ✅ Multi-account management and switching
- ✅ Auto token refresh
- ✅ AES-256-GCM encrypted storage

### ✅ Phase 6-8: Mod Support (Completed)
- ✅ **Fabric Loader** - Full support
- ✅ **NeoForge Loader** - Full support
- ✅ **Quilt Loader** - Full support
- ✅ **Mod Search & Install** (Modrinth, CurseForge)
- ✅ **Mod Management UI** - Enable/disable, delete
- ✅ **Auto Mod Updates** - Check and update to latest versions
- ✅ **Auto Dependency Resolution** - Automatically install required mods
- ✅ **HyeniHelper Mod** - Auto-update and management

### ✅ Phase 9-10: Modpacks & Resources (Completed)
- ✅ **Modpack Search & Install** (Modrinth, CurseForge)
- ✅ **Modpack Import** - .mrpack, .zip support
- ✅ **Resource Pack Management** - Install, activate, delete
- ✅ **Shader Pack Management** - Optifine, Iris shader support
- ✅ **File Watching** - Real-time mod/resource pack change detection

### 🚧 Phase 11: Additional Features (Planned)
- 🔜 **Skin Management** - Change and preview skins
- 🔜 **Server List** - Manage favorite servers
- 🔜 **World Backup** - Automatic backup and restore
- 🔜 **Performance Profiles** - Low/high-end optimization presets

---

## 📚 Documentation

All documentation is organized in the [docs/](docs/) directory.

### Quick Links
- **[Project Structure](docs/PROJECT_STRUCTURE.md)** 📁 - Full directory structure and file descriptions
- **[Quick Start Guide](docs/guides/QUICKSTART.md)** - Microsoft OAuth setup
- **[Development Guide](docs/development/DEVELOPMENT.md)** - Development environment setup
- **[Version Management](docs/deployment/VERSION_MANAGEMENT.md)** ⭐ - Release and deployment guide
- **[Testing Guide](docs/development/TESTING.md)** - Feature-specific testing methods
- **[Architecture](docs/architecture/DESIGN.md)** - System design and tech stack

### Full Documentation List
📖 [docs/README.md](docs/README.md) - All documentation list and structure

---

## 🤝 Contributing

Contributions are always welcome! Please send a Pull Request.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License & Copyright

### Software License
The source code of this project is licensed under the **MIT License**.

### ⚠️ Important: Image and Artwork Copyright

**All Hyeni-related images, illustrations, and artwork included in this project are copyrighted by Hyeni.**

- ❌ **Unauthorized Use Prohibited**: Hyeni images and illustrations cannot be used without explicit permission from the copyright holder.
- ❌ **Commercial Use Prohibited**: Any form of commercial use is prohibited.
- ❌ **Derivative Works Restricted**: Derivative works and modifications without permission from the copyright holder are prohibited.
- ✅ **Permitted Use**: This launcher may only be used for Hyeni and the HyeniWorld community.
- 🔓 **Special Permission**: If explicit written permission is obtained from the copyright holder (Hyeni), use is permitted within the scope of the permission.

### Usage Restrictions
This program is **exclusively for Hyeni and the HyeniWorld community**.
- Use for other purposes is not permitted.
- Cannot be used for other streamers, communities, or servers.
- When creating a derivative launcher based on this program, all Hyeni-related images and branding must be removed.

For details, please refer to [LICENSE.md](LICENSE.md) or [LICENSE_EN.md](LICENSE_EN.md).

---

## 👨‍💻 Creator

Made with ❤️ for HyeniWorld

**⚠️ Disclaimer**: This project is not officially associated with Mojang Studios. Minecraft is a trademark of Mojang Studios.
