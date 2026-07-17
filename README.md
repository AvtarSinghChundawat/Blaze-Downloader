# 🚀 Blaze Downloader

A premium, lightning-fast desktop download manager that slices downloads into concurrent multi-threaded segments to maximize network bandwidth. Styled with a gorgeous glassmorphic dark/light UI and built using **Next.js 15 (React 19)**, **Tailwind CSS v4**, and **Electron.js**.

---

## ✨ Features

- ⚡ **Multi-Threaded Chunk Slicing**: Dynamically issues HTTP Range requests to slice files into up to 32 concurrent download segments (similar to IDM), bypassing server bandwidth limits.
- ⏸️ **Smart Pause & Resume**: Saves bytes-written pointers to local JSON metadata files (`.blaze`), allowing incomplete downloads to resume from where they left off.
- 📊 **Live Performance Graphs**: Real-time canvas-drawn speed graphs tracking connection speed charts dynamically.
- 📁 **Thread Segment Monitors**: Visual segment trackers showing active downloading grids and progress ratios for each network thread.
- 🎨 **Premium Glassmorphic Design**: Built with the sleek **Poppins** font, customizable glass panels, and interactive micro-animations.
- 🌗 **Responsive Light/Dark Mode**: Clean slate light theme and sleek high-contrast dark theme options, persisted locally.
- 📂 **Settings Panel**: Custom input layouts to modify default download folders and max-connection thread counts using customized dropdown select overlays.
- 🔐 **Production Hardened**: Intercepts keyboard input combinations and restricts DevTools (`devTools: false`) for maximum packaging security.

---

## 🛠️ Tech Stack

- **Application Wrapper**: [Electron.js](https://www.electronjs.org/) (Desktop environment)
- **Frontend Engine**: [Next.js 15](https://nextjs.org/) + [React 19](https://react.dev/)
- **Compiler**: Webpack (via Next.js `--webpack` fallback)
- **Design System**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Icons**: [Lucide React](https://lucide.dev/)

---

## 🚀 Quick Start (Development)

### Prerequisites

Make sure you have Node.js (v18+) and npm installed on your machine.

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/AvtarSinghChundawat/Blaze-Downloader.git
   cd Blaze-Downloader
   ```

2. Install dependencies (supporting React 19 peer overrides):
   ```bash
   npm install --legacy-peer-deps
   ```

### Running Dev Setup

To concurrently start the Next.js local server on port `3050` and open the Electron shell window, run:
```bash
npm run dev
```

---

## 📦 Building Standalone Installer (.exe)

To bundle the application into a single-file standalone Windows installer (`Blaze Downloader Setup.exe` with desktop and start menu shortcuts), run:

```bash
npm run dist
```

All compiled assets will be outputted to the newly created `/dist` folder.
