#!/usr/bin/env bash
# =============================================================================
# build.sh — Household Zakat Calculator — full bootstrap + build script
#
# Works on a completely fresh Mac with nothing installed.
# Run from the repo root:
#
#   bash scripts/build.sh          # build both Android APK + open iOS in Xcode
#   bash scripts/build.sh android  # Android only
#   bash scripts/build.sh ios      # iOS only
#   bash scripts/build.sh setup    # install deps only, don't build
#
# =============================================================================

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${BLUE}▶${RESET} $*"; }
success() { echo -e "${GREEN}✔${RESET} $*"; }
warn()    { echo -e "${YELLOW}⚠${RESET}  $*"; }
error()   { echo -e "${RED}✖${RESET} $*" >&2; }
header()  { echo -e "\n${BOLD}$*${RESET}\n$(printf '─%.0s' {1..60})"; }

# ── Argument ──────────────────────────────────────────────────────────────────
TARGET="${1:-both}"   # android | ios | both | setup

# ── Paths ────────────────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_HOME_PATH="/opt/homebrew/share/android-commandlinetools"
APK_OUT="$REPO_ROOT/android/app/build/outputs/apk/debug/app-debug.apk"

# ── Export Android env (needed by Gradle) ────────────────────────────────────
export ANDROID_HOME="$ANDROID_HOME_PATH"
export ANDROID_SDK_ROOT="$ANDROID_HOME_PATH"
export PATH="$ANDROID_HOME_PATH/cmdline-tools/latest/bin:$ANDROID_HOME_PATH/platform-tools:$PATH"

# =============================================================================
# SECTION 1 — DEPENDENCY INSTALLATION
# =============================================================================
header "Step 1 — Checking & installing dependencies"

# ── Homebrew ──────────────────────────────────────────────────────────────────
if ! command -v brew &>/dev/null; then
  info "Installing Homebrew (package manager for macOS)..."
  # Homebrew's own install script; piping to bash is their official method
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add brew to PATH for Apple Silicon
  eval "$(/opt/homebrew/bin/brew shellenv)" 2>/dev/null || true
  success "Homebrew installed"
else
  success "Homebrew already installed ($(brew --version | head -1))"
fi

# ── Node.js ───────────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  info "Installing Node.js (required to run Capacitor CLI)..."
  brew install node
  success "Node.js installed ($(node -v))"
else
  success "Node.js already installed ($(node -v))"
fi

# ── JDK 17 ───────────────────────────────────────────────────────────────────
# Gradle (Android build system) is a Java program — needs a JDK to run
if ! java -version 2>&1 | grep -qE "version \"(17|21)"; then
  info "Installing JDK 17 (required by Gradle / Android build system)..."
  brew install openjdk@17
  # Link so /usr/bin/java picks it up
  sudo ln -sfn "$(brew --prefix)/opt/openjdk@17/libexec/openjdk.jdk" \
    /Library/Java/JavaVirtualMachines/openjdk-17.jdk 2>/dev/null || true
  export JAVA_HOME="$(brew --prefix)/opt/openjdk@17"
  export PATH="$JAVA_HOME/bin:$PATH"
  success "JDK 17 installed"
else
  success "JDK already installed ($(java -version 2>&1 | head -1))"
  export JAVA_HOME="$(/usr/libexec/java_home 2>/dev/null || echo "")"
fi

# ── Android command-line tools ───────────────────────────────────────────────
if ! command -v sdkmanager &>/dev/null; then
  info "Installing Android command-line tools (sdkmanager, adb, avdmanager)..."
  brew install --cask android-commandlinetools
  success "Android command-line tools installed"
else
  success "Android command-line tools already installed"
fi

# ── Android SDK components ────────────────────────────────────────────────────
# platform-tools  → adb (install APKs on devices)
# platforms;36    → Android 16 SDK (what the app compiles against)
# build-tools;35  → aapt2, d8, apksigner (the actual compiler + packager)
MISSING_SDK=0
[[ -d "$ANDROID_HOME_PATH/platform-tools" ]]          || MISSING_SDK=1
[[ -d "$ANDROID_HOME_PATH/platforms/android-36" ]]    || MISSING_SDK=1
[[ -d "$ANDROID_HOME_PATH/build-tools/35.0.0" ]]      || MISSING_SDK=1

if [[ $MISSING_SDK -eq 1 ]]; then
  info "Installing Android SDK components (platform-tools, android-36, build-tools 35)..."
  yes | sdkmanager --sdk_root="$ANDROID_HOME_PATH" \
    "platform-tools" \
    "platforms;android-36" \
    "build-tools;35.0.0" 2>&1 | grep -v "^\[" || true
  success "Android SDK components installed"
else
  success "Android SDK components already present"
fi

# ── xcodes (iOS only — downloads Xcode without the App Store) ─────────────────
if [[ "$TARGET" == "ios" || "$TARGET" == "both" ]]; then
  if ! command -v xcodes &>/dev/null; then
    info "Installing xcodes (downloads Xcode from Apple's servers)..."
    brew install xcodes
    success "xcodes installed"
  else
    success "xcodes already installed"
  fi
fi

# ── Capacitor npm packages ─────────────────────────────────────────────────────
header "Step 2 — Installing Capacitor packages"
cd "$REPO_ROOT"

if [[ ! -d node_modules ]]; then
  info "Running npm install (@capacitor/core, cli, android, ios)..."
  npm install
  success "npm packages installed"
else
  success "node_modules already present — skipping npm install"
fi

# Stop here if setup-only mode
if [[ "$TARGET" == "setup" ]]; then
  success "Setup complete. Run 'bash scripts/build.sh android' or 'bash scripts/build.sh ios' to build."
  exit 0
fi

# =============================================================================
# SECTION 2 — ANDROID BUILD
# =============================================================================
build_android() {
  header "Step 3 — Building Android APK"

  info "Syncing web assets into Android project (zakaat/ → android/app/src/main/assets/public/)..."
  npx cap sync android
  success "Web assets synced"

  info "Building debug APK with Gradle (this takes 1–3 min on first run)..."
  cd "$REPO_ROOT/android"
  ./gradlew assembleDebug

  if [[ -f "$APK_OUT" ]]; then
    SIZE=$(du -sh "$APK_OUT" | cut -f1)
    success "APK built successfully!"
    echo ""
    echo -e "  ${BOLD}Output:${RESET} $APK_OUT"
    echo -e "  ${BOLD}Size:${RESET}   $SIZE"
    echo ""
    echo -e "  ${BOLD}Install on a connected Android device:${RESET}"
    echo -e "    adb install $APK_OUT"
    echo ""
  else
    error "Gradle finished but APK not found at expected path."
    exit 1
  fi

  cd "$REPO_ROOT"
}

# =============================================================================
# SECTION 3 — iOS BUILD
# =============================================================================
build_ios() {
  header "Step 3 — Building iOS app"

  # Check macOS
  if [[ "$(uname)" != "Darwin" ]]; then
    error "iOS builds require macOS. This script is running on $(uname)."
    exit 1
  fi

  # Check / install Xcode
  if ! xcodebuild -version &>/dev/null; then
    warn "Xcode is not installed."
    echo ""
    echo "  xcodes will now download and install Xcode 16.4 (~10 GB)."
    echo "  You will be prompted for your Apple ID — this is required by Apple."
    echo ""
    read -rp "  Press Enter to continue, or Ctrl-C to cancel... "
    xcodes install "16.4" --experimental-unxip
    sudo xcode-select -s /Applications/Xcode-16.4.0.app/Contents/Developer
    sudo xcodebuild -license accept
    success "Xcode 16.4 installed and selected"
  else
    XCODE_VER=$(xcodebuild -version | head -1)
    success "Xcode already installed ($XCODE_VER)"
  fi

  # Sync web assets into iOS project
  info "Syncing web assets into iOS project (zakaat/ → ios/App/App/public/)..."
  cd "$REPO_ROOT"
  npx cap sync ios
  success "Web assets synced"

  # Build for simulator (no signing required)
  info "Building app for iOS Simulator..."
  SIMULATOR_ID=$(xcrun simctl list devices available --json \
    | python3 -c "
import sys, json
devs = json.load(sys.stdin)['devices']
iphones = [(k, d) for k, devs_list in devs.items() for d in devs_list
           if 'iPhone' in d.get('name','') and d.get('isAvailable')]
iphones.sort(key=lambda x: x[0], reverse=True)
print(iphones[0][1]['udid']) if iphones else print('')
" 2>/dev/null || echo "")

  if [[ -z "$SIMULATOR_ID" ]]; then
    warn "No iPhone simulator found. Falling back to opening in Xcode."
    npx cap open ios
    echo ""
    echo "  Xcode is now open. To build:"
    echo "  1. Select your Team under Signing & Capabilities"
    echo "  2. Pick a simulator from the device picker"
    echo "  3. Press ⌘R (or click ▶ Run)"
    return
  fi

  # Boot simulator if not running
  SIM_STATE=$(xcrun simctl list devices --json \
    | python3 -c "
import sys, json
devs = json.load(sys.stdin)['devices']
for v in devs.values():
  for d in v:
    if d.get('udid') == '$SIMULATOR_ID':
      print(d.get('state',''))
" 2>/dev/null || echo "Shutdown")

  if [[ "$SIM_STATE" != "Booted" ]]; then
    info "Booting iOS Simulator..."
    xcrun simctl boot "$SIMULATOR_ID"
  fi

  # xcodebuild for simulator (no signing needed)
  info "Compiling with xcodebuild for simulator..."
  cd "$REPO_ROOT/ios/App"
  xcodebuild \
    -workspace App.xcodeproj/project.xcworkspace \
    -scheme App \
    -sdk iphonesimulator \
    -configuration Debug \
    -destination "id=$SIMULATOR_ID" \
    build 2>&1 | xcpretty 2>/dev/null || \
  xcodebuild \
    -workspace App.xcodeproj/project.xcworkspace \
    -scheme App \
    -sdk iphonesimulator \
    -configuration Debug \
    -destination "id=$SIMULATOR_ID" \
    build 2>&1 | grep -E "error:|warning:|BUILD SUCCEEDED|BUILD FAILED"

  APP_PATH=$(find ~/Library/Developer/Xcode/DerivedData -name "App.app" \
    -path "*/Debug-iphonesimulator/*" 2>/dev/null | head -1)

  if [[ -n "$APP_PATH" ]]; then
    success "iOS app built successfully!"
    echo ""
    echo -e "  ${BOLD}App bundle:${RESET} $APP_PATH"
    echo ""
    info "Installing and launching on simulator..."
    xcrun simctl install "$SIMULATOR_ID" "$APP_PATH"
    xcrun simctl launch "$SIMULATOR_ID" com.atharsmy.zakat
    open -a Simulator
    success "App launched in iOS Simulator"
  else
    warn "Build finished but .app bundle not found."
    info "Opening Xcode so you can build manually..."
    cd "$REPO_ROOT"
    npx cap open ios
  fi

  cd "$REPO_ROOT"
}

# =============================================================================
# SECTION 4 — DISPATCH
# =============================================================================
case "$TARGET" in
  android)
    build_android
    ;;
  ios)
    build_ios
    ;;
  both)
    build_android
    build_ios
    ;;
  *)
    error "Unknown target '$TARGET'. Use: android | ios | both | setup"
    exit 1
    ;;
esac

header "Done"
success "All done. Happy Zakat calculating! 🌙"
