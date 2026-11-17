/**
 * ByTune Android — Phase 0 WebView "brain".
 *
 * Runs inside a hidden react-native-webview whose document origin is
 * https://www.youtube.com (via source.baseUrl). Everything that needs a real
 * browser JS engine lives here: the InnerTube session (youtubei.js), the
 * BotGuard PO-token mint (bgutils-js) and stream-URL resolution with the same
 * client-rotation strategy as the desktop app (electron/music-service.ts).
 *
 * Hermes cannot run youtubei.js (no Function constructor / EventTarget), so
 * the RN side talks to this brain over postMessage:
 *
 *   RN → brain  (window.__rnMessage, via injectJavaScript)
 *     { t: 'start' }                              boot session + mint PO token
 *     { t: 'resolve', videoId }                   resolve a stream URL
 *     { t: 'probeResult', rid, ok, status }       answer to a probe request
 *
 *   brain → RN   (ReactNativeWebView.postMessage)
 *     { t: 'log', m }
 *     { t: 'ready' }
 *     { t: 'probe', rid, url }
 *     { t: 'stream', videoId, url, mime, lufs, itag, clen, client }
 *     { t: 'error', stage, message }
 *
 * The desktop recipe this ports: electron/po-token.ts (challenge → snapshot →
 * GenerateIT → WebPoMinter) and electron/music-service.ts resolveStream
 * (client rotation, rendition pick, probe validation).
 */
import { Innertube, Platform } from 'youtubei.js/web';
import { BotGuardClient } from 'bgutils-js/botguard';
import { WebPoMinter } from 'bgutils-js/webpo';
import { buildURL, parseLooseJSON } from 'bgutils-js/utils';

/* eslint-disable @typescript-eslint/no-explicit-any */

// youtubei.js needs a JS evaluator for deciphering; a real browser has
// Function, so provide it here (the desktop app does the same inside JSDOM).
(Platform as any).shim.eval = async (data: any) => new Function(data.output)();

const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';
const GOOG_API_KEY = 'AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw';
const TOKEN_TTL_MS = 3 * 60 * 60 * 1000;

/**
 * Same rotation as electron/music-service.ts: VISIONOS serves plain
 * (non-SABR-gated) URLs, so it goes first; the rest follow the desktop order.
 */
const STREAM_CLIENTS = ['VISIONOS', 'IOS', 'ANDROID_VR', 'WEB', 'YTMUSIC', 'ANDROID', 'TV'] as const;

/**
 * YouTube's music itag ladder (electron/audio-format.ts): 141: 256k AAC ·
 * 251: ~160k Opus · 140: 128k AAC · 250: ~95k · 249: ~50k · 139: 48k HE-AAC.
 */
const AUDIO_ITAG_RANK: Record<number, number> = { 141: 6, 251: 5, 140: 4, 250: 3, 249: 2, 139: 1 };

const CHALLENGE_TIMEOUT_MS = 15_000;

interface ChallengeData {
  program: string;
  globalName: string;
  interpreterJS: string;
  ytcfg: Record<string, any> | null;
}

interface ResolvedStream {
  url: string;
  mime: string;
  lufs: number | null;
  itag?: number;
  clen?: number;
  client: string;
}

function send(m: any): void {
  (window as any).ReactNativeWebView?.postMessage(JSON.stringify(m));
}
const log = (m: string): void => send({ t: 'log', m });

const timeout = (ms: number): AbortSignal => AbortSignal.timeout(ms);

function waaHeaders(): Record<string, string> {
  return {
    'content-type': 'application/json+protobuf',
    'x-goog-api-key': GOOG_API_KEY,
    'x-user-agent': 'grpc-web-javascript/0.1',
  };
}

// ---------------------------------------------------------------------------
// Session + PO token
// ---------------------------------------------------------------------------

let fullSession: Innertube | null = null;
let poToken: string | undefined;
let mintedAt = 0;
/** ytcfg parsed from the last homepage fetch (contains VISITOR_DATA). */
let homepageYtcfg: Record<string, any> | null = null;

function visitorDataOf(yt: Innertube): { vd: string; source: string } {
  // Primary: the session's own context (desktop: music-service.ts phase 1).
  const fromSession = (yt as any)?.session?.context?.client?.visitorData;
  if (typeof fromSession === 'string' && fromSession) {
    return { vd: fromSession, source: 'session' };
  }
  // Fallback 1: VISITOR_DATA from the homepage ytcfg (same document origin).
  const fromYtcfg = homepageYtcfg?.VISITOR_DATA;
  if (typeof fromYtcfg === 'string' && fromYtcfg) {
    return { vd: fromYtcfg, source: 'homepage ytcfg' };
  }
  throw new Error('no visitor data in session or homepage ytcfg');
}

async function createBaseSession(): Promise<Innertube> {
  // Same first phase as the desktop: a light session just to obtain
  // visitor data for token minting.
  return await Innertube.create({
    retrieve_player: false,
    enable_session_cache: false,
  });
}

async function createFullSession(visitorData: string, token: string): Promise<Innertube> {
  return await Innertube.create({
    retrieve_player: true,
    visitor_data: visitorData,
    po_token: token,
    generate_session_locally: false,
  });
}

/** Fetch the YouTube homepage once; keeps ytcfg for the visitor-data fallback. */
let homepageHtml: string | null = null;
async function ensureHomepage(): Promise<string | null> {
  if (homepageHtml) return homepageHtml;
  try {
    const res = await fetch('https://www.youtube.com/', {
      credentials: 'omit',
      signal: timeout(CHALLENGE_TIMEOUT_MS),
    });
    const html = await res.text();
    homepageHtml = html;
    const ytcfgMatch = html.match(/ytcfg\.set\(({.+?})\);/s);
    if (ytcfgMatch) {
      try {
        homepageYtcfg = JSON.parse(ytcfgMatch[1]);
      } catch {
        homepageYtcfg = null;
      }
    }
    return html;
  } catch (err: any) {
    log(`homepage fetch failed: ${err?.message ?? err}`);
    return null;
  }
}

/** Challenge pair extracted from the YouTube homepage (same-origin here). */
async function challengeFromHomepage(): Promise<ChallengeData | undefined> {
  try {
    const html = await ensureHomepage();
    if (!html) return undefined;

    const ytcfg: Record<string, any> | null = homepageYtcfg;

    const attMatch = html.match(/window\.ytAtN\(\s*({[\s\S]*?})\s*\)/);
    if (!attMatch) {
      log('homepage challenge: no ytAtN payload');
      return undefined;
    }
    const attData: any = (parseLooseJSON as any)(attMatch[1]);
    const bgChallenge = attData?.R?.bgChallenge;
    if (!bgChallenge?.program || !bgChallenge?.globalName) {
      log('homepage challenge: missing program/globalName');
      return undefined;
    }

    const interpreterUrlWrapped =
      bgChallenge?.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
    let interpreterJS: string | undefined =
      bgChallenge?.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
    if (!interpreterJS) {
      if (!interpreterUrlWrapped) {
        log('homepage challenge: no interpreter available');
        return undefined;
      }
      const jsRes = await fetch(`https:${interpreterUrlWrapped}`, { signal: timeout(CHALLENGE_TIMEOUT_MS) });
      interpreterJS = await jsRes.text();
    }
    return { program: bgChallenge.program, globalName: bgChallenge.globalName, interpreterJS, ytcfg };
  } catch (err: any) {
    log(`homepage challenge fetch failed: ${err?.message ?? err}`);
    return undefined;
  }
}

/** att/get fallback challenge (same as electron/po-token.ts). */
async function challengeFromAttGet(): Promise<ChallengeData | undefined> {
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/att/get?prettyPrint=false', {
      method: 'POST',
      headers: waaHeaders(),
      signal: timeout(CHALLENGE_TIMEOUT_MS),
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: '2.20260817.01.00' } },
        engagementType: 'ENGAGEMENT_TYPE_UNBOUND',
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const attestation: any = await res.json();
    const bgChallenge = attestation?.bgChallenge;
    if (!bgChallenge?.program || !bgChallenge?.globalName) throw new Error('no bgChallenge');

    const interpreterUrlWrapped =
      bgChallenge?.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
    let interpreterJS: string | undefined =
      bgChallenge?.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
    if (!interpreterJS) {
      if (!interpreterUrlWrapped) throw new Error('no interpreter available');
      const jsRes = await fetch(`https:${interpreterUrlWrapped}`, { signal: timeout(CHALLENGE_TIMEOUT_MS) });
      interpreterJS = await jsRes.text();
    }
    return { program: bgChallenge.program, globalName: bgChallenge.globalName, interpreterJS, ytcfg: null };
  } catch (err: any) {
    log(`att/get challenge failed: ${err?.message ?? err}`);
    return undefined;
  }
}

async function mintWithChallenge(challenge: ChallengeData, visitorData: string): Promise<string> {
  // BotGuard reads yt.config_ (EVENT_ID etc.) for homepage challenges.
  if (challenge.ytcfg) {
    (window as any).yt = { config_: challenge.ytcfg };
  }
  if (!(window as any)[challenge.globalName]) {
    new Function(challenge.interpreterJS)();
  }
  if (!(window as any)[challenge.globalName]) {
    throw new Error(`Interpreter did not define global '${challenge.globalName}'`);
  }

  const botguard = await BotGuardClient.create({
    globalObject: window as any,
    globalName: challenge.globalName,
    program: challenge.program,
  });

  const webPoSignalOutput: any[] = [];
  const snapshot = await botguard.snapshot({ webPoSignalOutput } as any, 20000);
  log(`BotGuard snapshot: len=${String(snapshot ?? '').length}`);
  if (!snapshot) throw new Error('BotGuard snapshot returned nothing');

  const itRes = await fetch(buildURL('GenerateIT'), {
    method: 'POST',
    headers: waaHeaders(),
    signal: timeout(CHALLENGE_TIMEOUT_MS),
    body: JSON.stringify([REQUEST_KEY, snapshot]),
  });
  const itRaw = await itRes.text();
  let parsed: any;
  try {
    parsed = JSON.parse(itRaw);
  } catch {
    throw new Error(`GenerateIT returned non-JSON (HTTP ${itRes.status}): ${itRaw.slice(0, 120)}`);
  }
  let integrityToken: string | undefined;
  let estimatedTtlSecs: number | undefined;
  if (Array.isArray(parsed)) {
    integrityToken = parsed.find((v: unknown) => typeof v === 'string' && v.length >= 40) as string | undefined;
    estimatedTtlSecs = parsed.find((v: unknown) => typeof v === 'number') as number | undefined;
  } else if (parsed && typeof parsed === 'object') {
    integrityToken = parsed.integrityToken ?? parsed.token;
    estimatedTtlSecs = parsed.estimatedTtlSecs;
  } else {
    throw new Error(`GenerateIT unexpected response (HTTP ${itRes.status})`);
  }
  if (!integrityToken) {
    throw new Error(`GenerateIT returned no integrity token (HTTP ${itRes.status})`);
  }

  const integrityTokenData = {
    integrityToken,
    estimatedTtlSecs,
    mintRefreshThreshold: Array.isArray(parsed) ? null : parsed?.mintRefreshThreshold,
    websafeFallbackToken: integrityToken,
  };

  const minter = await WebPoMinter.create(integrityTokenData, webPoSignalOutput);
  const token = await minter.mintAsWebsafeString(visitorData);
  if (!token) throw new Error('Minting returned no token');

  void botguard.shutdown().catch(() => undefined);
  return token;
}

async function mintPoToken(visitorData: string): Promise<string> {
  const challenge = (await challengeFromHomepage()) ?? (await challengeFromAttGet());
  if (!challenge) throw new Error('Could not obtain a BotGuard challenge');
  try {
    return await mintWithChallenge(challenge, visitorData);
  } catch (err: any) {
    if (challenge.ytcfg) {
      log(`homepage-challenge mint failed, retrying with att/get: ${err?.message ?? err}`);
      const fallback = await challengeFromAttGet();
      if (fallback) return await mintWithChallenge(fallback, visitorData);
    }
    throw err;
  }
}

/** Boot the full InnerTube session: visitor data → PO token → real session. */
async function bootSession(): Promise<void> {
  // Warm the homepage first: cookies + challenge + ytcfg (VISITOR_DATA fallback).
  await ensureHomepage();

  log('creating base session…');
  const base = await createBaseSession();
  let visitor: { vd: string; source: string };
  try {
    visitor = visitorDataOf(base);
  } catch (err: any) {
    log(`session had no visitor data (${err?.message}); retrying with local generation…`);
    // Last resort: a locally generated visitor id (youtubei.js always
    // produces one with generate_session_locally). Token binds to it.
    const local = await Innertube.create({
      retrieve_player: false,
      enable_session_cache: false,
      generate_session_locally: true,
    });
    visitor = visitorDataOf(local);
  }
  const visitorData = visitor.vd;
  log(`visitor data ok via ${visitor.source} (${visitorData.length} chars)`);

  log('minting PO token…');
  poToken = await mintPoToken(visitorData);
  mintedAt = Date.now();
  log(`PO token minted (${poToken.length} chars)`);

  log('creating full session (retrieves player for deciphering)…');
  fullSession = await createFullSession(visitorData, poToken);
  log('full session ready');
}

// ---------------------------------------------------------------------------
// Stream resolution (port of electron/music-service.ts resolveStream)
// ---------------------------------------------------------------------------

const resolveCache = new Map<string, { value: ResolvedStream; expiresAt: number }>();
let preferredClientIdx = 0;
let probeRid = 0;
const pendingProbes = new Map<string, (ok: boolean) => void>();

/**
 * The RN side validates the URL from the same network path the native player
 * will use (it has no CORS, so an open-range request works there). Open range
 * is deliberate: SABR-gated URLs answer tiny ranges with 206 but 403 real
 * streaming requests.
 */
function nativeProbe(url: string): Promise<boolean> {
  const rid = `p${++probeRid}`;
  return new Promise((resolve) => {
    pendingProbes.set(rid, resolve);
    send({ t: 'probe', rid, url });
    setTimeout(() => {
      if (pendingProbes.has(rid)) {
        pendingProbes.delete(rid);
        resolve(false);
      }
    }, 12_000);
  });
}

function audioScore(f: any): number {
  const rank = AUDIO_ITAG_RANK[f?.itag] ?? 0;
  return rank * 1e9 + (f?.bitrate ?? 0);
}

function formatLufs(f: any): number | null {
  const abs = f?.track_absolute_loudness_lkfs;
  if (typeof abs === 'number' && Number.isFinite(abs)) return abs;
  const db = f?.loudness_db;
  if (typeof db === 'number' && Number.isFinite(db)) return db - 14;
  return null;
}

async function formatUrl(format: any, yt: Innertube): Promise<string | null> {
  if (typeof format?.url === 'string' && format.url) return format.url;
  try {
    if (typeof format?.decipher === 'function' && yt?.session?.player) {
      const out = await format.decipher(yt.session.player);
      if (typeof out === 'string' && out) return out;
      if (typeof format?.url === 'string' && format.url) return format.url;
    }
  } catch {
    /* fall through */
  }
  return null;
}

async function pickAudio(info: any, yt: Innertube): Promise<{ url: string; mime: string; lufs: number | null; itag?: number; clen?: number } | null> {
  const sd = info?.streaming_data;
  if (!sd) return null;
  let candidates: any[] = (sd.adaptive_formats ?? []).filter((f: any) => f?.has_audio && !f?.has_video);
  if (!candidates.length) {
    candidates = (sd.formats ?? []).filter((f: any) => f?.has_audio && !f?.has_video);
  }
  if (!candidates.length && typeof sd.url === 'string') {
    return { url: sd.url, mime: String(sd.mime_type ?? 'audio/mp4'), lufs: null };
  }
  if (!candidates.length) return null;
  // "Stable volume" (DRC) and dubbed copies reuse the plain track's itags —
  // prefer the plain copy (electron/audio-format.ts).
  const plain = candidates.filter((f) => !f.is_drc && f.is_original !== false);
  if (plain.length) candidates = plain;
  candidates.sort((a, b) => audioScore(b) - audioScore(a));
  const preferred = candidates[0];
  const url = await formatUrl(preferred, yt);
  if (!url) return null;
  const num = (v: unknown): number | undefined =>
    Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined;
  return {
    url,
    mime: String(preferred.mime_type ?? 'audio/mp4'),
    lufs: formatLufs(preferred),
    itag: num(preferred.itag),
    clen: num(preferred.content_length),
  };
}

function cacheKey(videoId: string): string {
  return videoId;
}

function streamTtlMs(url: string, now: number): number {
  const expire = Number(/[?&/]expire[=/](\d{9,11})/.exec(url)?.[1]);
  if (!expire) return 10 * 60_000;
  return Math.min(6 * 3_600_000, Math.max(0, expire * 1000 - now - 5 * 60_000));
}

let resolving: Promise<ResolvedStream> | null = null;

async function resolveStreamInner(videoId: string): Promise<ResolvedStream> {
  let lastErr: unknown = null;

  // Two rounds: the second runs on a freshly minted PO token.
  for (let round = 0; round < 2; round++) {
    const yt = fullSession;
    for (let i = 0; i < STREAM_CLIENTS.length; i++) {
      const idx = (preferredClientIdx + i) % STREAM_CLIENTS.length;
      const client = STREAM_CLIENTS[idx];
      try {
        log(`trying client ${client}…`);
        const info = await yt!.getBasicInfo(videoId, { client, po_token: poToken } as any);
        const picked = await pickAudio(info, yt!);
        if (!picked) throw new Error(`no audio format for client ${client}`);
        const status = (info as any)?.playability_status?.status ?? '?';
        log(`${client}: playability=${status} itag=${picked.itag} ${picked.mime}`);
        if (!(await nativeProbe(picked.url))) throw new Error(`stream rejected for client ${client}`);
        preferredClientIdx = idx;
        return {
          url: picked.url,
          mime: picked.mime,
          lufs: picked.lufs,
          itag: picked.itag,
          clen: picked.clen,
          client,
        };
      } catch (err) {
        lastErr = err;
        log(`${client} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (round === 0) {
      log(`all clients failed (${lastErr instanceof Error ? lastErr.message : lastErr}), rebuilding session with a fresh PO token…`);
      await bootSession();
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function resolveStream(videoId: string): Promise<ResolvedStream> {
  if (!/^[\w-]{6,25}$/.test(videoId)) throw new Error('Invalid video id');
  const key = cacheKey(videoId);
  const hit = resolveCache.get(key);
  if (hit && Date.now() < hit.expiresAt) return hit.value;
  if (resolving) return resolving;

  resolving = (async () => {
    const value = await resolveStreamInner(videoId);
    resolveCache.set(key, { value, expiresAt: Date.now() + streamTtlMs(value.url, Date.now()) });
    return value;
  })();

  try {
    return await resolving;
  } finally {
    resolving = null;
  }
}

// ---------------------------------------------------------------------------
// Message pump
// ---------------------------------------------------------------------------

async function onStart(): Promise<void> {
  try {
    await bootSession();
    send({ t: 'ready' });
  } catch (err: any) {
    send({ t: 'error', stage: 'boot', message: err?.message ?? String(err) });
  }
}

async function onResolve(videoId: string): Promise<void> {
  try {
    if (!fullSession || !poToken || Date.now() - mintedAt > TOKEN_TTL_MS) {
      await bootSession();
    }
    const value = await resolveStream(videoId);
    log(`resolved via ${value.client} (LUFS ${value.lufs ?? '?'})`);
    send({ t: 'stream', videoId, ...value });
  } catch (err: any) {
    send({ t: 'error', stage: 'resolve', message: err?.message ?? String(err) });
  }
}

(window as any).__rnMessage = (msg: any) => {
  try {
    switch (msg?.t) {
      case 'start':
        void onStart();
        break;
      case 'resolve':
        void onResolve(String(msg.videoId ?? ''));
        break;
      case 'probeResult': {
        const pending = pendingProbes.get(String(msg.rid));
        if (pending) {
          pendingProbes.delete(String(msg.rid));
          pending(!!msg.ok);
        }
        break;
      }
      default:
        break;
    }
  } catch (err: any) {
    send({ t: 'error', stage: 'message', message: err?.message ?? String(err) });
  }
};

log('brain loaded');
