# Household Zakat Calculator — Mobile Build Guide

Capacitor 8 wraps the existing PWA (`zakaat/`) into native Android and iOS shells.  
**No rewrite.** ~95% code reuse. The web app runs inside a native WebView.

---

## Contents

- [Prerequisites](#prerequisites)
- [First-time setup](#first-time-setup)
- [Android — debug APK](#android--debug-apk)
- [Android — signed release APK](#android--signed-release-apk)
- [iOS — Xcode build](#ios--xcode-build)
- [Updating after web changes](#updating-after-web-changes)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### All platforms

| Tool | Min version | Check |
|------|-------------|-------|
| Node.js | 18 | `node -v` |
| npm | 9 | `npm -v` |
| JDK | 17 | `java -version` |

Install Node via [nodejs.org](https://nodejs.org) or `brew install node`.  
Install JDK 17 via `brew install openjdk@17` (or use JDK 21 — also works).

### Android (any OS)

1. **Android command-line tools** — the fastest path on macOS is Homebrew:
   ```bash
   brew install --cask android-commandlinetools
   ```
   This installs `sdkmanager`, `adb`, and `avdmanager` to `/opt/homebrew/share/android-commandlinetools`.

2. **SDK components** — accept the licences and install:
   ```bash
   export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
   yes | sdkmanager --sdk_root=$ANDROID_HOME \
     "platform-tools" \
     "platforms;android-36" \
     "build-tools;35.0.0"
   ```
   > Gradle will auto-download any missing SDK component the first time you build.

3. Set environment variables (add to `~/.zshrc` or `~/.bashrc`):
   ```bash
   export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
   export ANDROID_SDK_ROOT=$ANDROID_HOME
   export PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH
   ```

### iOS (macOS only)

- **Xcode 15+** — install from the Mac App Store, then:
  ```bash
  xcode-select --install
  sudo xcodebuild -license accept
  ```
- **Apple Developer Program** — $99/year, required to sign and distribute. Enrol at [developer.apple.com](https://developer.apple.com/enroll/).

---

## First-time setup

```bash
# 1. Clone the repo
git clone https://github.com/SMYWEBSITES/atharsmy.com.git
cd atharsmy.com

# 2. Install Capacitor dependencies
npm install

# 3. (Re-)sync web assets into both native projects
npx cap sync
```

> `npx cap sync` copies the `zakaat/` folder into `android/app/src/main/assets/public`
> and `ios/App/App/public`. Run it every time you change web files.

---

## Android — debug APK

A debug APK can be installed on any Android device (USB debugging or "Install from unknown sources").

```bash
cd android
./gradlew assembleDebug
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`

**Install via ADB:**
```bash
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

**Install via file transfer:** copy the `.apk` to the phone and open it.

---

## Android — signed release APK

Required for the Google Play Store. Run this once and keep the keystore safe — you need the **same** key for every future update.

### 1. Generate a keystore (one-time)

```bash
keytool -genkey -v \
  -keystore zakat-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias zakat
```

Store `zakat-release.jks` somewhere safe and **never commit it to git**.

### 2. Configure signing in Gradle

Edit `android/app/build.gradle` — add a `signingConfigs` block and reference it in the `release` buildType:

```groovy
android {
    signingConfigs {
        release {
            storeFile     file("../../zakat-release.jks")   // path relative to android/app/
            storePassword "YOUR_STORE_PASSWORD"
            keyAlias      "zakat"
            keyPassword   "YOUR_KEY_PASSWORD"
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
}
```

> **Tip:** use environment variables or a `keystore.properties` file instead of hardcoding passwords.

### 3. Build

```bash
cd android
./gradlew assembleRelease
```

Output: `android/app/build/outputs/apk/release/app-release.apk`

To build an **AAB** (required by Play Store):
```bash
./gradlew bundleRelease
```
Output: `android/app/build/outputs/bundle/release/app-release.aab`

---

## iOS — Xcode build

iOS can only be built on macOS with Xcode.

```bash
# Open the Xcode workspace (always use this, not the .xcodeproj)
npx cap open ios
```

Inside Xcode:

1. Select the **App** target → **Signing & Capabilities**
2. Set **Team** to your Apple Developer account
3. Confirm **Bundle Identifier** is `com.atharsmy.zakat`
4. Set **Deployment Target** to iOS 15.0
5. Replace the app icon: drop a 1024×1024 PNG (no transparency) onto `App/Assets.xcassets/AppIcon`

**Run on simulator:**
```bash
npx cap run ios --target="iPhone 16"
```

**Archive for App Store / TestFlight:**  
Xcode → **Product → Archive → Distribute App → App Store Connect → Upload**

---

## Updating after web changes

After editing any HTML, CSS, or JS in `zakaat/`:

```bash
# From the repo root
npx cap sync

# Then rebuild whichever platform you need:
cd android && ./gradlew assembleDebug     # Android debug
cd android && ./gradlew assembleRelease   # Android release
# or open Xcode for iOS
```

---

## Project structure

```
atharsmy.com/
├── zakaat/                    ← Web app (the Capacitor web root)
│   ├── index.html
│   ├── styles.css
│   ├── sw.js                  ← Service worker (skipped inside Capacitor)
│   ├── app/                   ← JS modules
│   └── js/                    ← analytics.js + gtag-bootstrap.js (copies for mobile)
│
├── android/                   ← Generated native Android project (Gradle)
│   └── app/build/outputs/apk/ ← APK output
│
├── ios/                       ← Generated native iOS project (Xcode)
│
├── capacitor.config.json      ← Capacitor config (appId, webDir, server hostname)
├── package.json               ← npm deps (@capacitor/core, /cli, /android, /ios)
└── MOBILE_BUILD.md            ← This file
```

---

## Troubleshooting

### `ANDROID_HOME` not found
Make sure you've exported `ANDROID_HOME` and sourced your shell profile:
```bash
source ~/.zshrc
echo $ANDROID_HOME
```

### Gradle fails with "SDK location not found"
Create `android/local.properties` (never commit this):
```
sdk.dir=/opt/homebrew/share/android-commandlinetools
```

### iOS Simulator SSL errors (on ABG / Zscaler network)
The simulator doesn't inherit macOS's trusted certificates. Fix:
1. Open **Keychain Access** → search for *Zscaler Root CA* → export as `.cer`
2. Drag the `.cer` into the simulator window
3. **Settings → General → VPN & Device Management** → install the profile
4. **Settings → General → About → Certificate Trust Settings** → enable full trust

### Google Drive sign-in doesn't work in the app
Register your bundle ID as an OAuth redirect URI in Google Cloud Console:
- **Authorized redirect URI:** `com.atharsmy.zakat:/`
- For iOS, also add the reversed client ID as a URL Scheme in Xcode

### App shows blank screen
Run `npx cap sync` — the web assets may not have been copied into the native project yet.
