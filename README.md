# Household Zakat Calculator

Offline-first Zakat calculator for the Athar family. Vanilla HTML/JS/CSS PWA, wrapped in [Capacitor](https://capacitorjs.com/) for native Android and iOS.

**Live web app:** [atharsmy.com/zakaat](https://atharsmy.com/zakaat/)

> **How it works:** There is no framework, no build step, and no bundler. The app is plain HTML, CSS, and JavaScript in the `zakaat/` folder. Capacitor acts as a thin native shell — it copies those files into a native Android (Gradle) or iOS (Xcode) project and serves them inside a WebView. The result is a real `.apk` / `.ipa` that installs like any other app, with full access to the device home screen, offline storage, and push notifications if needed later.

---

## Contents

- [Run the web app locally](#run-the-web-app-locally)
- [Build Android APK](#build-android-apk)
- [Build iOS app](#build-ios-app)
- [Push to Git](#push-to-git)
- [Project structure](#project-structure)

---

## Run the web app locally

The web app has no build step. You just need something to serve the files over HTTP — browsers block certain APIs (service workers, some storage) when you open an HTML file directly from disk via a `file://` URL.

### Option A — Python (zero install, recommended)

```bash
cd zakaat
python3 -m http.server 8080
```

**What it does:** starts Python's built-in HTTP server, which serves every file in the `zakaat/` folder at `http://localhost:8080`. Python ships with macOS — nothing extra to install.

**What you get:** the full app running at [http://localhost:8080](http://localhost:8080), including the service worker (offline support) and localStorage.

**Why use it:** fastest way to get started, no dependencies, identical to how GitHub Pages serves the file in production.

---

### Option B — npx serve

```bash
npx serve zakaat -p 8080
```

**What it does:** `npx` downloads and runs the `serve` package (a small Node.js static file server) without permanently installing it. `-p 8080` sets the port.

**What you get:** same as Option A, but with a nicer terminal UI showing each request.

**Why use it:** if you already have Node installed and prefer seeing request logs.

---

### Option C — VS Code Live Server

Install the [Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) extension → right-click `zakaat/index.html` → **Open with Live Server**.

**What it does:** starts an HTTP server and automatically reloads the browser tab every time you save a file.

**What you get:** live-reloading dev experience — edit CSS or JS, save, and the browser refreshes instantly without you doing anything.

**Why use it:** best for active development. Hot-reload saves a lot of manual refreshing.

> **Service worker note:** the SW scope is `/zakaat/`, so it only registers when the app is served from that path. With Live Server, open `zakaat/index.html` — not the root `index.html`.

---

## Build Android APK

### Why an APK and not just the web app?

An APK installs on a phone's home screen like any other app. It works fully offline, can receive push notifications, and doesn't require opening a browser. The debug APK (built below) can be sideloaded onto any Android phone without needing a Google account or the Play Store.

---

### Prerequisites

| Tool | Min version | Why it's needed |
|------|-------------|-----------------|
| Node.js | 18 | Runs Capacitor CLI (`npx cap`) |
| JDK 17 | 17 | Gradle (the Android build tool) is a Java program |
| Android SDK | — | Contains the Android compiler, platform libraries, and build tools |

**Install Node.js:**
```bash
brew install node
```
> Node is the JavaScript runtime that runs Capacitor's command-line tool. Without it you can't run `npx cap sync` or `npx cap add android`.

**Install JDK 17:**
```bash
brew install openjdk@17
```
> Android's build system (Gradle) is written in Java. It needs a JDK to compile the native Android wrapper code. JDK 21 also works.

**Install Android command-line tools:**
```bash
brew install --cask android-commandlinetools
```
> This installs `sdkmanager` (downloads SDK components), `adb` (communicates with Android devices), and `avdmanager` (manages emulators). It does **not** install Android Studio — you get the same tools without the GUI.

**Set environment variables** (add to `~/.zshrc`, then `source ~/.zshrc`):
```bash
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export ANDROID_SDK_ROOT=$ANDROID_HOME
export PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH
```
> `ANDROID_HOME` tells Gradle and Capacitor where the SDK lives. Without this, every tool tries a different default path and usually fails. `PATH` additions let you run `adb`, `sdkmanager`, etc. directly in the terminal.

**Install SDK components** (one-time):
```bash
yes | sdkmanager --sdk_root=$ANDROID_HOME \
  "platform-tools" "platforms;android-36" "build-tools;35.0.0"
```
> - **platform-tools** — includes `adb`, used to push APKs to real devices
> - **platforms;android-36** — the Android 16 SDK; Gradle needs this to compile against the right Android APIs
> - **build-tools;35.0.0** — `aapt2`, `d8`, `apksigner` and other tools that actually compile and package the APK
>
> `yes |` automatically accepts the Google licence agreements for each component.

---

### First-time setup

**Step 1 — install Capacitor packages:**
```bash
npm install
```
> Reads `package.json` and downloads `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, and `@capacitor/ios` into `node_modules/`. These are the JavaScript libraries that bridge the web app to native device APIs.

**Step 2 — sync web assets into the Android project:**
```bash
npx cap sync android
```
> Does two things in one command:
> 1. **Copies** everything in `zakaat/` into `android/app/src/main/assets/public/` — this is the web app the WebView will load
> 2. **Updates** any Capacitor plugin config inside the native project
>
> Run this every time you change HTML, CSS, or JS files. If you skip it, the native app runs the old version of your web code.

---

### Build debug APK (sideload / testing)

```bash
cd android
./gradlew assembleDebug
```

**What it does:** `gradlew` is the Gradle wrapper — a script that downloads the correct version of Gradle if needed, then compiles all the Java/Kotlin code in the `android/` project, bundles the web assets, and packages everything into an APK. `assembleDebug` targets the debug build variant, which is signed with an auto-generated debug key so it can be installed without your own keystore.

**What you get:** `android/app/build/outputs/apk/debug/app-debug.apk` — a ~5 MB file you can install on any Android device.

**Why use it:** for testing and sideloading. The debug APK is unsigned with your personal key, so you can't upload it to the Play Store, but it installs on any device with "Install from unknown sources" enabled.

**Install on a connected Android device:**
```bash
adb install android/app/build/outputs/apk/debug/app-debug.apk
```
> `adb` (Android Debug Bridge) talks to your phone over USB. It pushes the APK and triggers the install. The phone must have **USB debugging** enabled (Settings → Developer Options → USB Debugging).

---

### Build release APK (Play Store / distribution)

A release APK is signed with your personal key. Google Play requires this — it uses the key to verify that updates come from the same developer as the original submission.

**Step 1 — generate a keystore** (one-time only — keep this file and its passwords forever):

```bash
keytool -genkey -v \
  -keystore zakat-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias zakat
```

**What it does:** `keytool` is a Java utility (bundled with the JDK) that creates a `.jks` (Java KeyStore) file — a container holding a private key and a self-signed certificate. The flags mean:
- `-keyalg RSA -keysize 2048` — RSA 2048-bit encryption (the Play Store minimum)
- `-validity 10000` — key valid for ~27 years
- `-alias zakat` — the name of this key entry inside the keystore

**What you get:** `zakat-release.jks` — guard this like a password. If you lose it, you can never update the app on the Play Store.

> ⚠️ Add `zakat-release.jks` to `.gitignore` — never commit private keys.

**Step 2 — wire the keystore into Gradle** (edit `android/app/build.gradle`):

```groovy
android {
    signingConfigs {
        release {
            storeFile     file("../../zakat-release.jks")
            storePassword "YOUR_STORE_PASSWORD"
            keyAlias      "zakat"
            keyPassword   "YOUR_KEY_PASSWORD"
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
        }
    }
}
```

**Step 3 — build:**

```bash
# Signed APK — for direct distribution or sideloading
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk

# Android App Bundle — required format for the Play Store
cd android && ./gradlew bundleRelease
# → android/app/build/outputs/bundle/release/app-release.aab
```

**APK vs AAB:**
- **APK** — a self-contained installable file. Use for direct distribution (share via link, WhatsApp, email).
- **AAB** — Google's preferred format. Google Play splits it into smaller per-device downloads. Required for new Play Store submissions.

---

### Rebuild after web changes

```bash
# From the repo root
npx cap sync android
cd android && ./gradlew assembleDebug
```

> **Why both commands?** `npx cap sync` copies the updated web files into the Android project. `./gradlew assembleDebug` repackages them into an APK. If you only run Gradle without syncing first, the APK will contain the old web code.

---

## Build iOS app

> **macOS + Xcode is a hard requirement.** Apple only allows iOS apps to be compiled on macOS using Xcode. This isn't a tooling limitation — it's Apple's policy. If you're on Windows or Linux, you'll need a Mac (physical or cloud-based via [Codemagic](https://codemagic.io) or [Bitrise](https://bitrise.io)).

---

### Prerequisites

| Tool | Why it's needed |
|------|-----------------|
| Xcode 15+ | Apple's IDE; contains the iOS compiler (`swiftc`), simulator, and code signer |
| Apple Developer account | Required to sign the app so it can run on real devices and be submitted to the App Store ($99/year) |

**Install Xcode:** Mac App Store → search "Xcode" → download (~15 GB).

**After Xcode installs:**
```bash
xcode-select --install
```
> Installs the Xcode Command Line Tools — `git`, `make`, `clang`, and friends — into `/Library/Developer/CommandLineTools`. Capacitor's iOS commands need these even if you're working in the Xcode GUI.

```bash
sudo xcodebuild -license accept
```
> Accepts the Xcode and Apple SDK licence agreements non-interactively. Without this, Xcode refuses to build anything.

---

### First-time setup

```bash
npm install
npx cap sync ios
```

**`npm install`** — downloads the Capacitor packages (same as Android — only needed once per machine).

**`npx cap sync ios`** — copies `zakaat/` into `ios/App/App/public/` and updates the Swift package manifest (`CapApp-SPM/Package.swift`) so Xcode knows which Capacitor plugins to include. Run this every time you change web files.

---

### Open the project in Xcode

```bash
npx cap open ios
```

**What it does:** opens `ios/App/App.xcodeproj` in Xcode. Always use this command rather than double-clicking the `.xcodeproj` file — it ensures the workspace is opened with the correct settings.

**In Xcode, do this once:**

1. Click the **App** target in the left sidebar
2. Go to **Signing & Capabilities**
3. Set **Team** to your Apple Developer account
4. Confirm **Bundle Identifier** is `com.atharsmy.zakat`
5. Set **Minimum Deployments** to iOS 15.0 (covers ~97% of iPhones)

> Xcode automatically manages provisioning profiles once a Team is set — it creates and downloads a profile that ties your app ID to your developer account.

---

### Run on the iOS Simulator

```bash
npx cap run ios --target="iPhone 16"
```

**What it does:** compiles the app and launches it inside the iOS Simulator (a virtual iPhone that runs on your Mac). No Apple Developer account needed for the simulator.

**Why use it:** fast iteration — no cable, no device, no signing. The simulator boots in seconds.

Alternatively, in Xcode: select a simulator from the device picker at the top → press **▶ Run (⌘R)**.

---

### Run on a real iPhone

1. Connect your iPhone via USB
2. In Xcode, select your device from the picker (it will say "iPhone" with your device name)
3. Press **▶ Run (⌘R)**

> The first time, your iPhone will show a "Trust this computer?" prompt — tap **Trust** and enter your passcode. Your Apple Developer account must be set as the Team; without it, Xcode can't sign the app for a real device.

---

### Archive for TestFlight / App Store

In Xcode: **Product → Archive**

> This creates a release build, runs code optimisations, and packages it into a distributable `.xcarchive`. It's the equivalent of `./gradlew assembleRelease` on Android.

Then: **Distribute App → App Store Connect → Upload**

> Uploads the archive to Apple's servers. Once processed (~10–20 min), the build appears in TestFlight (internal testing) and can be submitted for App Store review.

Visit [appstoreconnect.apple.com](https://appstoreconnect.apple.com) to fill in the store listing and submit.

> App Store review typically takes 1–3 days. Apple reviews all apps manually.

---

### Rebuild after web changes

```bash
npx cap sync ios
# Then in Xcode: ⌘R to run, or Product → Archive for a release build
```

---

## Push to Git

### Daily workflow

```bash
git status
```
> Shows which files have been modified, added, or deleted since the last commit. Always run this first to see what you're about to commit.

```bash
git diff
```
> Shows the actual line-by-line changes in modified files — the red lines are removed, green lines are added. Useful for reviewing your own changes before committing.

```bash
git add -p
```
> **Interactive staging.** Shows each change chunk-by-chunk and asks `y/n` whether to include it in the commit. Recommended over `git add .` because it lets you review every change and split unrelated edits into separate commits.

```bash
git add .
```
> Stages every changed and new file at once (respecting `.gitignore`). Faster but less careful — good for committing everything in one shot when you're confident about what changed.

```bash
git commit -m "your message"
```
> Creates a snapshot of the staged files in the local git history. The message should describe *what* changed and *why*, e.g. `"fix: swap madhab selector to segmented control"` rather than `"update"`.

```bash
git push origin gh-pages
```
> Uploads the local commits to GitHub. `origin` is the remote (GitHub). `gh-pages` is the branch — GitHub Pages serves this branch as the live website at `atharsmy.com`.

---

### What is and isn't tracked in git

| Tracked | Not tracked (`.gitignore`) |
|---------|--------------------------|
| `zakaat/` — all web source files | `node_modules/` — npm packages (recreated by `npm install`) |
| `ios/` — Xcode project (has custom Info.plist + icons) | `android/` — Gradle project (fully regenerated by `npx cap sync`) |
| `capacitor.config.json` | `*.jks` — keystores (security: never commit private keys) |
| `package.json` / `package-lock.json` | `.DS_Store` — macOS metadata |
| `README.md`, `MOBILE_BUILD.md` | |

---

### Full rebuild from a fresh clone

```bash
# 1. Download the repo
git clone https://github.com/SMYWEBSITES/atharsmy.com.git
cd atharsmy.com
```
> `git clone` creates a local copy of the repository. Everything tracked in git is downloaded; `node_modules/` and `android/` are not (they're gitignored — you recreate them locally).

```bash
# 2. Install Capacitor packages
npm install
```
> Reads `package.json` and downloads all dependencies into `node_modules/`. Must run before any `npx cap` command.

```bash
# 3. Recreate the Android native project
npx cap sync android
```
> Since `android/` isn't tracked in git, this command regenerates it from scratch and copies the web assets into it.

```bash
# 4. Build Android APK
cd android && ./gradlew assembleDebug
```

```bash
# 5. Sync iOS (project is tracked, but public/ assets need updating)
npx cap sync ios

# 6. Open in Xcode and build from there
npx cap open ios
```

---

## Project structure

```
atharsmy.com/
│
├── zakaat/                         ← The web app — this is what Capacitor wraps
│   ├── index.html                  ← Single-page entry point; all tabs rendered here
│   ├── styles.css                  ← All app styles
│   ├── sw.js                       ← Service worker; enables offline mode (skipped inside Capacitor)
│   ├── manifest.json               ← PWA manifest; defines icon, name, theme for "Add to Home Screen"
│   ├── app/                        ← JavaScript modules
│   │   ├── zakat.js                ← Core calculation engine (nisab, madhab rules, all asset types)
│   │   ├── ui.js                   ← DOM rendering and tab controller
│   │   ├── storage.js              ← localStorage read/write
│   │   ├── rates.js                ← Live gold/silver price fetching
│   │   ├── rates_history.js        ← Historical rate chart
│   │   ├── excel.js                ← Excel export (lazy-loads xlsx.full.min.js on demand)
│   │   ├── gdrive.js               ← Google Drive backup/restore
│   │   └── help.js                 ← About/guide tab content
│   ├── js/                         ← Copies of analytics.js + gtag-bootstrap.js
│   │   │                             (the originals live in /js/ and are served only on the web;
│   │   │                              these copies are bundled inside the mobile app)
│   │   ├── analytics.js
│   │   └── gtag-bootstrap.js
│   └── assets/                     ← Static assets
│       ├── logo.svg                ← App logo (also used as browser favicon)
│       ├── icon-192.png            ← PWA icon (small)
│       ├── icon-512.png            ← PWA icon (large); source for iOS AppIcon
│       └── kaaba-hero.jpg          ← Hero image on the guide tab
│
├── ios/                            ← Native Xcode project (tracked in git)
│   └── App/
│       ├── App.xcodeproj/          ← Xcode project file; open this via `npx cap open ios`
│       ├── App/
│       │   ├── Info.plist          ← iOS app metadata: bundle ID, permissions, status bar style
│       │   ├── Assets.xcassets/    ← App icon (1024×1024) and launch screen images
│       │   ├── AppDelegate.swift   ← iOS app lifecycle hooks
│       │   └── public/             ← Web assets copied here by `npx cap sync` [gitignored]
│       └── CapApp-SPM/             ← Swift Package Manager manifest for Capacitor plugins
│
├── android/                        ← Native Gradle project [gitignored — regenerated by npx cap sync]
│   └── app/build/outputs/apk/      ← APK files appear here after ./gradlew assembleDebug
│
├── capacitor.config.json           ← Capacitor configuration
│                                     appId: com.atharsmy.zakat
│                                     webDir: zakaat  (the folder Capacitor copies into the native app)
│                                     server.hostname: zakaat.app (keeps the origin stable for CSP)
│
├── package.json                    ← npm dependencies: @capacitor/{core,cli,android,ios}
├── package-lock.json               ← Exact dependency versions (lockfile — commit this)
├── .gitignore                      ← Excludes node_modules/, android/, *.jks
├── README.md                       ← This file
└── MOBILE_BUILD.md                 ← Extended mobile reference (signing, Codemagic, troubleshooting)
```
