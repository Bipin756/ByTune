# ByTune Mobile (Android)

React Native + Expo app inside the ByTune repo. Personal use, Android first
(Samsung S24 FE). **Expo development builds only — Expo Go cannot run this app**
(native code from `react-native-audio-api`).

This file is the operational handbook; progress tracking lives in
`../PORTING_PLAN.md`.

## Architecture in one paragraph

Hermes (React Native's JS engine) cannot run `youtubei.js` (no `Function`
constructor, no EventTarget). So the app is split: a hidden
`react-native-webview` — the **brain** — runs the whole YouTube side
(youtubei.js session, BotGuard PO-token minting via bgutils-js, stream-URL
resolution with the desktop's client-rotation strategy). Its document origin is
`https://www.youtube.com` (WebView `source={{ html, baseUrl }}`), which is what
makes the BotGuard snapshot valid and InnerTube requests same-origin. The brain
talks to the RN side over postMessage (`src/brain/brain.ts` ↔ `App.tsx` /
future services). Playback, EQ and lock-screen controls are native:
`react-native-audio-api` (`<Audio>` tag → `createMediaElementSource` → EQ chain
→ destination, `PlaybackNotificationManager`, FFmpeg byte-range streaming).

Porting recipe sources (desktop): `electron/po-token.ts`,
`electron/music-service.ts` (`resolveStream`, client list), `electron/audio-format.ts`
(itag ladder), `src/stores/*` (state), `src/lib/*` (pure logic).

## Machine setup (already done on this PC)

- Git 2.56, Node 26 LTS, npm 11
- JDK 17: `C:\Program Files\Eclipse Adoptium\jdk-17.0.21.9-hotspot`
- Android SDK: `%LOCALAPPDATA%\Android\Sdk` (cmdline-tools, platform-tools,
  build-tools 35, platform android-36, **NDK 27.1.12297006** installed via
  `sdkmanager "ndk;27.1.12297006"`; licenses accepted)
- Env vars set (user scope): `JAVA_HOME`, `ANDROID_HOME`, PATH extended
- **Repo location:** `C:\dev\ByTune` — NOT under Documents. Android builds fail
  on Windows when the project path is long (`react-native-audio-api`'s CMake
  mirrors the absolute source path into object-file names, and long paths
  exceed MAX_PATH). Never move it back into `Documents`.
- **node_modules junction (required, do not remove):**
  `C:\dev\ByTune\mobile\node_modules` is an NTFS junction to
  `C:\nm\node_modules`. Even at `C:\dev`, the C++ build's doubled paths hit the
  260-char limit inside `react-native-audio-api`; the junction shortens the
  physical location so they fit. Recreate after moving machines:

  ```powershell
  New-Item -ItemType Directory -Force C:\nm | Out-Null
  Move-Item .\mobile\node_modules C:\nm\node_modules
  New-Item -ItemType Junction -Path .\mobile\node_modules -Target C:\nm\node_modules
  ```

  Note: node resolves the junction to its real path, so the physical location
  MUST be nested as `C:\nm\node_modules` (top-level `C:\nm` breaks
  `require.resolve` upward walks).
- **Install helper:** `mobile\install-bytune.cmd` — double-click to install the
  latest release APK over USB.

PowerShell note: `npm.ps1` is blocked by execution policy — always call
`npm.cmd` / `npx.cmd`.

## Build & run

```powershell
cd mobile
npm run build:brain        # rebuilds assets/brain.html.txt from src/brain/brain.ts
npx expo prebuild -p android   # only after changing app.json / plugins
cd android
.\gradlew.bat assembleRelease   # self-contained APK (no Metro needed)
# APK: android\app\build\outputs\apk\release\app-release.apk
```

For fast iteration (JS-only changes): `gradlew.bat assembleDebug` +
`npx expo start` and connect the phone over USB (`adb reverse tcp:8081 tcp:8081`).
Release APKs embed the JS bundle; no PC needed to test them.

Install on the S24 FE: enable Developer options (Settings → About phone →
Software information → tap Build number 7×), enable USB debugging, plug in,
then `adb install -r app-release.apk` (accept the on-phone prompt).

## Testing checklist conventions

Every phase ships with a checklist the owner runs on the phone. A feature is
marked done in PORTING_PLAN.md **only** after the owner confirms it. Failures
are reported and stop work — no silent workarounds (see Honesty rules in
PORTING_PLAN.md).

## Known quirks (Phase 0)

- `react-native-webview` 14.0.1's class types collapse to `never` under
  RN 0.88 → App uses a one-line typed shim (`WebViewAny`). Runtime unaffected.
- Piped mirror fallback (desktop's last resort) is intentionally **not** in the
  Phase 0 brain; it ports in Phase 1 if needed.
- The brain bundle is minified into `assets/brain.html.txt`; commit it when it
  changes (`npm run build:brain` regenerates it deterministically).
