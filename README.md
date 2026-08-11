# Household Zakat Calculator

Offline-first Zakat calculator for the Athar family. Vanilla HTML/JS/CSS PWA, wrapped in Capacitor for native Android and iOS.

**Live web app:** [atharsmy.com/zakaat](https://atharsmy.com/zakaat/)

---

## Contents

- [Run the web app locally](#run-the-web-app-locally)
- [Build Android APK](#build-android-apk)
- [Build iOS app](#build-ios-app)
- [Push to Git](#push-to-git)
- [Project structure](#project-structure)

---

## Run the web app locally

No build step — it's plain HTML/JS. Any static file server works.

### Option A — Python (zero install)

```bash
cd zakaat
python3 -m http.server 8080
```
Open → [http://localhost:8080](http://localhost:8080)

### Option B — npx serve

```bash
npx serve zakaat -p 8080
```
Open → [http://localhost:8080](http://localhost:8080)

### Option C — VS Code Live Server

Install the [Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) extension, right-click `zakaat/index.html` → **Open with Live Server**.

> **Note:** The service worker scope is `/zakaat/`, so it only registers correctly when served from that path (Option A/B above, not by opening `index.html` directly as a `file://` URL).

---

## Build Android APK

### Prerequisites

| Tool | Min version | Install |
|------|-------------|---------|
| Node.js | 18 | [nodejs.org](https://nodejs.org) or `brew install node` |
| JDK | 17 | `brew install openjdk@17` |
| Android SDK | — | `brew install --cask android-commandlinetools` |

**Set environment variables** (add to `~/.zshrc`):

```bash
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export ANDROID_SDK_ROOT=$ANDROID_HOME
export PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH
```

**Install SDK components** (one-time):

```bash
yes | sdkmanager --sdk_root=$ANDROID_HOME \
  "platform-tools" "platforms;android-36" "build-tools;35.0.0"
```

### First-time setup

```bash
npm install
npx cap sync android
```

### Build debug APK (sideload / testing)

```bash
cd android
./gradlew assembleDebug
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`

**Install on a connected device:**

```bash
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

### Build release APK (Play Store)

**Step 1 — generate a keystore** (one-time, keep it safe, never commit):

```bash
keytool -genkey -v \
  -keystore zakat-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias zakat
```

**Step 2 — add signing config to `android/app/build.gradle`:**

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
cd android && ./gradlew assembleRelease
# Output: android/app/build/outputs/apk/release/app-release.apk

# For Play Store (.aab):
cd android && ./gradlew bundleRelease
# Output: android/app/build/outputs/bundle/release/app-release.aab
```

### Rebuild after web changes

```bash
npx cap sync android
cd android && ./gradlew assembleDebug
```

---

## Build iOS app

> **macOS + Xcode required.** iOS can only be built on a Mac.

### Prerequisites

| Tool | Install |
|------|---------|
| Xcode 15+ | Mac App Store |
| Apple Developer account | [developer.apple.com](https://developer.apple.com/enroll/) — $99/year |

**After installing Xcode:**

```bash
xcode-select --install
sudo xcodebuild -license accept
```

### First-time setup

```bash
npm install
npx cap sync ios
```

### Open in Xcode

```bash
npx cap open ios
```

**In Xcode, do this once:**

1. Select the **App** target → **Signing & Capabilities**
2. Set **Team** → your Apple Developer account
3. Confirm **Bundle Identifier** is `com.atharsmy.zakat`
4. Set **Deployment Target** → iOS 15.0

### Run on simulator

```bash
npx cap run ios --target="iPhone 16"
```

Or in Xcode: choose a simulator from the device picker → press **▶ Run**.

### Run on a real device

Connect your iPhone via USB, select it in Xcode's device picker, press **▶ Run**.

### Archive for TestFlight / App Store

In Xcode: **Product → Archive → Distribute App → App Store Connect → Upload**

Then visit [appstoreconnect.apple.com](https://appstoreconnect.apple.com) to submit for review.

### Rebuild after web changes

```bash
npx cap sync ios
# Then rebuild / re-run from Xcode
```

---

## Push to Git

Standard workflow:

```bash
# Check what changed
git status
git diff

# Stage changes
git add -p          # interactive, recommended
# or
git add .           # stage everything (respects .gitignore)

# Commit
git commit -m "your message"

# Push
git push origin gh-pages
```

> The `android/`, `ios/`, and `node_modules/` directories are in `.gitignore` — only source files and config are tracked.
>
> After cloning on a new machine, run `npm install && npx cap sync` to recreate them.

### Full rebuild from a fresh clone

```bash
git clone https://github.com/SMYWEBSITES/atharsmy.com.git
cd atharsmy.com

npm install
npx cap sync          # recreates android/ and ios/

# Android
cd android && ./gradlew assembleDebug

# iOS (macOS + Xcode only)
npx cap open ios      # then build from Xcode
```

---

## Project structure

```
atharsmy.com/
├── zakaat/                    ← Web app (Capacitor web root)
│   ├── index.html             ← Entry point
│   ├── styles.css
│   ├── sw.js                  ← Service worker (skipped inside Capacitor)
│   ├── manifest.json          ← PWA manifest
│   ├── app/                   ← JS modules (zakat.js, ui.js, storage.js …)
│   ├── js/                    ← analytics.js + gtag-bootstrap.js (bundled copy for mobile)
│   └── assets/                ← Icons, logo, hero image
│
├── android/                   ← Generated Android project [gitignored]
│   └── app/build/outputs/apk/ ← APK output
│
├── ios/                       ← Generated iOS Xcode project [gitignored]
│
├── capacitor.config.json      ← Capacitor config (appId, webDir, hostname)
├── package.json               ← @capacitor/{core,cli,android,ios}
├── .gitignore
├── README.md                  ← This file
└── MOBILE_BUILD.md            ← Extended mobile build reference
```
