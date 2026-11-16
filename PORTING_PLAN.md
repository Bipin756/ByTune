# ByTune Android — Porting Plan & Feature Inventory

**Target device:** Samsung S24 FE (personal use, no Play Store, no commercial release)
**Stack:** React Native + Expo (development builds, **not** Expo Go), audio engine `react-native-audio-api`
**Code location:** `mobile/` inside this repo, sharing TypeScript from `src/lib`, `src/stores`, and import-safe `electron/` logic
**Approved:** 2026-11-16

---

## How to read this file

- Every feature from the approved inventory is listed with a status.
- Statuses: **not started** · **in progress** · **done (tested on device)** · **done (not yet tested)** · **blocked** (with reason + proposed alternative).
- A feature is only ever marked **done (tested on device)** after the owner has confirmed the checklist item on their S24 FE. Nothing is marked done silently.
- Update this file after every phase, and after any bug-fix release.

## Phase plan

| Phase | Scope | Status |
|---|---|---|
| 0 | Proof: streamed YT track plays; keeps playing screen-off ≥10 min (past Android's ~3 min cutoff); lock-screen + notification controls work; a test EQ band is audibly active | **in progress** — app built, awaiting device test |
| 1 | Core player, search, home feed, queue, synced lyrics, liked songs, playlists, shuffle/repeat, sleep timer, notification/lock-screen controls, Now Playing screen | not started |
| 2 | Downloads, local music library, Replay stats, accounts + cloud sync (desktop-account compatible), Spotify import | not started |
| 3 | Rooms, 10-band EQ + presets, crossfade, Automix, skip silence, playback speed, volume leveling, visualizer, remaining mobile equivalents (Android PiP, gestures, etc.) | not started |
| 4 | Release pipeline: tagged GitHub Actions signed-APK releases, keystore setup + backup, Expo Updates (OTA), in-app latest-release check | not started |

**Phase 0 rule (agreed):** if any of the four proof items fails, STOP and report what failed. Do not hack around it. Fallback then is a standard player (e.g. expo-audio) with EQ/crossfade added later.

---

## How to resume (for a fresh session)

A fresh assistant session should be able to continue from this file alone.

1. **Repo:** `C:\Users\hp\Documents\Default Project\ByTune` — the owner's fork `Bipin756/ByTune` (upstream: `rishiteja21/ByTune`). The desktop app (root) is untouched; all mobile work is in `mobile/`.
2. **Read first:** this file top to bottom; then `FEATURE_PARITY.md` (desktop honesty matrix); `docs/ARCHITECTURE.md`; the inventory section below.
3. **Find current progress:** search this file for `in progress` and `blocked` — do those items first. Then the lowest-numbered phase marked *not started*.
4. **Build/run:** the Expo app is in `mobile/`. Use `npx expo run:android` (local) or EAS dev-build, per the setup notes in `mobile/README-mobile.md`. JDK 17 + Android SDK are installed on this machine (see `mobile/README-mobile.md` for paths).
5. **Never** mark anything *done* without the owner's device confirmation. Never skip a failing check silently — report and stop.
6. **Commit to the fork after every phase** (and after meaningful milestones), so history matches the phases.

## How to fix a bug and release (the one routine)

1. Reproduce & fix the bug in `mobile/` (or shared code) on a branch or directly on `main` for small fixes.
2. Bump the version in `mobile/app.json` (`version` + `versionCode`).
3. Update this file's notes if the bug touched an inventory item.
4. Push to the fork. For a normal fix: **just push** — no release is built (ordinary commits never release).
5. For a release the owner creates a version tag, e.g. `mobile-v1.0.1`, and pushes it: `git tag mobile-v1.0.1 && git push origin mobile-v1.0.1`. GitHub Actions then builds a signed release APK and publishes it as a GitHub Release. **Only tags trigger releases.**
6. JS/UI-only fixes can additionally ship over the air via Expo Updates (`eas update`); native-code changes, new permissions or new native modules always need a new APK (see Phase 4 section when built).
7. Old releases are kept so the owner can roll back by installing an older APK.

---

# Approved inventory (Android mappings)

Legend: ✅ ported as-is · 🔁 adapted to mobile equivalent · 🆕 new on mobile · ⚠️ ported with a known risk (explained) · ➖ desktop limitation carried over honestly

## 1. Playback

| Feature | Desktop implementation | Mobile mapping | Status | Notes |
|---|---|---|---|---|
| YT Music streaming (no sign-in) | youtubei.js + PO token + localhost stream proxy | youtubei.js in JS; PO tokens via hidden WebView; native audio DataSource/resolver replaces the proxy | not started | Phase 0 proves the core |
| Stream-client rotation (VISIONOS/IOS/ANDROID_VR/WEB/YTMUSIC/ANDROID/TV) + Piped fallback | `electron/music-service.ts` | Pure HTTP logic — ports verbatim | not started | |
| Play/pause, next/prev, seek, queue position | `src/lib/audio.ts` dual-deck engine | react-native-audio-api engine (Phase 1) | not started | |
| Shuffle (order-preserving, unshuffled cycle) | `stores/player.ts` | Pure TS — ports verbatim | not started | |
| Repeat off/all/one; prev restarts after 3 s | `stores/player.ts` | Pure TS — ports verbatim | not started | |
| Queue management (play next, add, remove, clear, reorder, AutoPlay-tail boundary) | `stores/player.ts` | Pure TS ports; drag → long-press drag handles | not started | |
| AutoPlay (endless radio, refill, "Don't play this", one-time offer) | `src/lib/autoplay.ts` | Pure TS — ports verbatim | not started | |
| Crossfade 0–12 s, dual-deck equal-power blend, pause-freezes-blend, abort paths | Web Audio fade timer | Same math on react-native-audio-api | not started | Phase 3; validate dual-deck gapless on device |
| Automix (BS.1770 loudness, silent edges, beat-grid alignment, ≤4 % tempo match) | `src/lib/analysis.ts` + `planBlend` | Decode/FFT pure JS on AudioBuffers | not started | Phase 3; CPU/battery check on device |
| Skip silence (−42 dBFS head/tail) | analysis + arm/seek logic | Same as Automix | not started | Phase 3 |
| Playback speed 0.5–2×, pitch-preserving | `preservesPitch` + rate | Native player rate support | not started | Phase 3 |
| Volume leveling (−19/−14/−11 LUFS, attenuation-only, glide) | loudness fetch + ReplayGain + measurement | Same gain math in Web Audio graph | not started | Phase 3 |
| **Background playback, screen-off ≥10 min** | N/A desktop | Foreground service + wake lock | not started | Phase 0 gate #2 |
| Sleep timer (5–720 min, `1h 30m` parsing, end-of-song, 10 s fade, room-aware) | `src/lib/sleepTimer.ts` | Pure TS + gain fade — ports verbatim | not started | Phase 1 |
| Buffering indicator; error recovery (client rotation retry, 5-skip stop, room sit-out) | `src/lib/audio.ts` | Ports; rotation verbatim | not started | Phase 1 |
| Gapless / read-ahead | browser range-buffering | Player buffering — no code needed | not started | |

## 2. Sound & quality

| Feature | Desktop | Mobile mapping | Status | Notes |
|---|---|---|---|---|
| Streaming quality Low/Med/High/Lossless (Low = real 64 k ceiling) | resolver caps | Ports verbatim | not started | Phase 1 (setting UI), resolver in Phase 0 |
| 10-band EQ (32 Hz–16 kHz, ±12 dB) + 5 built-in presets + ≤20 user presets | Web Audio biquads + headroom + limiter | Same graph via react-native-audio-api | not started | **Phase 0 gate #4 proves a test band**; full EQ Phase 3 |
| Prevent clipping (auto headroom) | pre-gain | Same | not started | Phase 3 |
| Output device picker | `setSinkId` + device list | System-handled on Android; keep auto-pause on device loss (audio-becoming-noisy) | not started | Phase 3 |
| Lossless/Hi-Res | BLOCKED (YT has none) | Same honest BLOCKED | ➖ carried over | |

## 3. Lyrics

| Feature | Desktop | Mobile mapping | Status | Notes |
|---|---|---|---|---|
| 13-provider chain (lrc.red → BiniLyrics → BetterLyrics → Portato → PaxSenix → LyricsPlus → Unison → YT captions → YT Music → KuGou → LRCLIB → Musixmatch → Genius) | `electron/lyrics.ts` | Pure TS fetch/parse — ports verbatim | not started | Phase 1 |
| Word-by-word karaoke sync, instrumental-gap pulse, click-to-seek, blur states | `SyncedLyrics.tsx` rAF sweep | RN animated equivalent; tap line to seek | not started | Phase 1 |
| Romanized lyrics | `src/lib/romanize.ts` | Pure TS — ports verbatim | not started | Phase 1 |
| Timing slider −3…+3 s + per-song nudge (≤500 songs) | settings + lyricsOffset store | Slider ports; `[`/`]` keys → settings-only | not started | Phase 1 |
| Genius HTML extraction (JSDOM) | `electron/lyrics.ts` | Swap to htmlparser2 | not started | Phase 1 |
| Embedded LRC/SYLT from local files | music-metadata | music-metadata JS parsers in RN | not started | Phase 2 |

## 4. Visuals / Now Playing

| Feature | Desktop | Mobile mapping | Status | Notes |
|---|---|---|---|---|
| Fullscreen Now Playing, ambient artwork theming, breathing art | `NowPlaying.tsx` | Becomes the default Now Playing screen | not started | Phase 1 |
| Animated canvas (community + Tidal; Apple fragmented MP4) | `<video>`; MSE for Apple clips | expo-video overlay; Apple MSE variant may degrade to plain loop — flagged here, not silent | not started | Phase 3 |
| 32-bar decorative visualizer | pure CSS | Rebuilt RN/Reanimated | not started | Phase 3 |
| Reduce animation / Full-bleed art / Legacy mesh / Animated cover toggles | CSS effects | Ports (RN equivalents) | not started | Phase 1/3 |
| Reduce dynamic blur / Liquid glass | CSS glass | RN closest equivalent; honest visual degradation allowed | not started | Phase 3 |
| Artwork full-res resolution (`=s1200` rewrites) | `electron/artwork.ts` | Pure TS — ports verbatim | not started | Phase 1 |

## 5. Downloads & offline

| Feature | Desktop | Mobile mapping | Status | Notes |
|---|---|---|---|---|
| Download queue (2 concurrent, retries, .part+rename, progress, cancel) | `electron/downloads.ts` | Logic ports; storage → app-scoped dir | not started | Phase 2 |
| Quality Standard/High/Lossless | settings | Ports | not started | Phase 2 |
| "Export compatible downloads" | writes to OS Music/ByTune | **Try MediaStore Music/ByTune first** (owner decision); if impossible, report + closest alternative | not started | Phase 2 |
| M4A tag/cover embedding | hand-rolled MP4 writer | Pure buffer math — ports verbatim | not started | Phase 2 |
| Offline playback of saved files; boot reconciliation | `downloaded-files.ts` | Ports via local resolver | not started | Phase 2 |
| Metadata/cover embedding BLOCKED | honest desktop status | Same | ➖ carried over | |

## 6. Local music library

| Feature | Desktop | Mobile mapping | Status | Notes |
|---|---|---|---|---|
| Folder import/scan/rescan, tags, art, durations | `electron/local-library.ts` + music-metadata | SAF folder access / MediaStore scan; JS parsers | not started | Phase 2 |
| Non-music filter (≥30 s, voice-note heuristics) | path heuristics | Filename/MediaStore heuristics | not started | Phase 2 |
| Songs/Albums/Artists/Folders tabs, sort, search | `LocalMusicView.tsx` | Ports | not started | Phase 2 |
| "Opened files" | OS file association | Share-intent / "Open with ByTune" | not started | Phase 2 |
| Genres view | PARTIAL desktop | Same partial parity | ➖ carried over | |

## 7. Discovery & catalog

| Feature | Desktop | Mobile mapping | Status | Notes |
|---|---|---|---|---|
| Home feed (recs profile, engagement, journal, "Jump back in", mood chips, shelves) | `src/lib/recs/*` (~2000 lines pure TS) | Ports verbatim; vertical mobile layout | not started | Phase 1 |
| Search: 7 filter pills, top result, infinite scroll, suggestions, recents | `SearchView.tsx` | Ports | not started | Phase 1 |
| Explore, moods, mood pages, charts, market | `ExploreView`, `MoodView`, `electron/moods.ts` | Ports | not started | Phase 1 |
| Podcasts + episodes + "play latest" | `PodcastsView` | Ports | not started | Phase 1 |
| Album/Artist pages (top songs, follow, stat chips), About blocks | `AlbumView`/`ArtistView` | Ports | not started | Phase 1 |

## 8. Library & playlists

| Feature | Desktop | Mobile mapping | Status | Notes |
|---|---|---|---|---|
| Liked songs; playlists (create/rename/delete/pin/add/remove/queue/export .m3u8+JSON) | `stores/library.ts`, `trackActions.ts` | Ports; context menu → long-press bottom sheet | not started | Phase 1 |
| Folders for playlists, drag-to-file | `FolderView`, `useSortable` | Long-press "Move to folder" | not started | Phase 1 |
| Drag-to-library / drop-onto-playlist | dnd everywhere | "Add to playlist" picker (`PlaylistPicker` logic reused) | not started | Phase 1 |
| Spotify import (public link / song list / CSV, no sign-in) + song-versions language | `electron/spotify-web.ts`, `track-match.ts` | Pure TS — ports verbatim | not started | Phase 2 |
| Spotify account connect (sp_dc) | locked-down Electron window | In-app WebView capture | not started | Phase 2 |

## 9. Accounts & data

| Feature | Desktop | Mobile mapping | Status | Notes |
|---|---|---|---|---|
| Guest mode; onboarding (7 steps); username/display-name rules | `OnboardingView`, `account-validators.ts` | Validators pure TS; flow restyled | not started | Phase 2 |
| Username+password auth; Google OAuth (PKCE); sign out | `electron/supabase.ts`, `bytune://` callback | expo AuthSession + app links; secrets → Keystore (expo-secure-store) | not started | Phase 2 |
| Cloud sync (7 stores, device-field stripping, tombstone merge, 8 MiB cap, per-owner archives) | `sync.ts`, `sync-merge.ts`, `deletion-sync.ts`, `cloud-payload.ts` | Pure TS — ports verbatim; **desktop-account compatible** | not started | Phase 2 |
| Backup export/import files | native dialogs | Share sheet / SAF picker | not started | Phase 2 |
| Reset app data (incl. guest-delete modal) | `app:resetData` | Ports | not started | Phase 2 |

## 10. Replay (stats)

| Feature | Desktop | Mobile mapping | Status | Notes |
|---|---|---|---|---|
| Listen recording (30 s–4 min rule, monthly buckets, 36-month retention) | `electron/stats.ts` | Pure bookkeeping — ports verbatim | not started | Phase 2 |
| Replay view: periods, day curve, tops, heatmap, share card 1080×1920 | `ReplayView.tsx` | Ports; share via view-shot + share sheet | not started | Phase 2 |
| Streak chip | `Streak.tsx` | Ports | not started | Phase 2 |

## 11. Desktop-native → mobile equivalents

| Desktop feature | Mobile equivalent | Status | Notes |
|---|---|---|---|
| Mini player (PiP window, square + compact bar) | Android PiP (S24 FE supports) + persistent mini-bar above tab bar; reuse `pipSync.ts` snapshot shape | not started | Phase 3 |
| SMTC + full-size cover + ByTuneMedia.exe | Media3 MediaSession: lock-screen + notification controls + full-size art | not started | **Phase 0 gate #3** |
| Media keys + double-press (1=play, 2+=next) | MediaSession media-button callbacks, same logic | not started | Phase 0/1 |
| Close to tray (Windows) | Background playback is the norm; swipe-from-recents stops | not started | Phase 1 |
| Window chrome, caption buttons, F11, hover states | N/A — system UI | ➖ dropped (by design) | |
| Mouse side-buttons / trackpad swipe / Alt+←→ | System back gesture | not started | Phase 1 |
| Right-click menus | Long-press bottom sheets (same menu-item schema) | not started | Phase 1 |
| Drag-and-drop everywhere | Share sheet + "Add to playlist" flows | not started | Phase 1/2 |
| File-drop "Drop to play" | Share-to-ByTune intent | not started | Phase 2 |
| In-app updates (Windows) | Dev builds via Expo now; APK releases via tags later; version banner kept | not started | Phase 4 |
| Deep links `bytune://room/CODE`, OAuth callback | Android App Links | not started | Phase 2/3 |

## 12. Keyboard shortcut mapping (nothing dropped silently)

| Desktop shortcut | Mobile equivalent | Status |
|---|---|---|
| Space = play/pause | Play button / headset / notification | not started |
| ←/→ = seek ±5 s | **Double-tap left/right of artwork = ±10 s** (owner decision) | not started |
| Shift+←/→ = prev/next | Notification/lock-screen buttons, headset double-press | not started |
| ↑/↓ = volume | Hardware volume buttons (system); in-app slider on Now Playing | not started |
| M = mute | In-app mute button | not started |
| S / R = shuffle / repeat | Player-bar buttons (already exist) | not started |
| Q = queue panel | Queue sheet (swipe up from mini-bar) | not started |
| L = lyrics | Lyrics tab on Now Playing | not started |
| N = fullscreen Now Playing | Default Now Playing; tap artwork | not started |
| `[` / `]` = lyrics nudge | Settings → Lyrics timing slider only | not started |
| `/`, Ctrl+F = search | Search tab | not started |
| Escape = close overlays | System back gesture | not started |
| Alt+←/→ = view history | System back gesture / top-bar back | not started |

## 13. Settings parity check (all 8 desktop sections)

- **Account:** all port (Phase 2).
- **Playback:** Crossfade, Automix, Skip silence, Autoplay, Don't repeat suggestions, Playback speed — port (Phase 3 for DSP). *Close to tray* → background-playback behavior (Phase 1).
- **Sound:** Streaming quality (P1), Volume leveling + EQ + presets + anti-clipping (Phase 3). *Output device* → system-handled + auto-pause on loss (Phase 3).
- **Lyrics:** all port (Phase 1).
- **Display:** Reduce animation, Full-bleed, Animated cover, Legacy mesh (P1/P3); *Reduce blur / Liquid glass* → RN equivalents, honest degradation noted (Phase 3).
- **Library:** Local folders/rescan/filter (Phase 2, SAF); *Download folder* → app storage; Download quality + Export-compatible → MediaStore attempt (Phase 2).
- **Your data:** Replay, export/import, reset (Phase 2).
- **About:** version + license (Phase 1); updates → banner (Phase 4).

**Desktop-inherited BLOCKEDs (not mobile omissions):** lossless streaming, Automix vocal/tempo-stretch, download metadata auto-embedding (desktop requires a tagger dep; mobile ships the hand-rolled M4A writer for cover+tags already planned in Phase 2 — this is a *parity improvement*, noted when done).

---

# Honesty rules (binding)

1. A feature is **done (tested on device)** only after the owner confirms it on the S24 FE. Otherwise write **done (not yet tested)**.
2. Report failures, failed tests and shortcuts openly. Never work around a failing gate quietly.
3. If something can't be ported as-is: say why, and propose the closest alternative here in this file.
4. After Phase 3 (and again after Phase 4), re-check everything against this inventory and list anything missing or degraded.
