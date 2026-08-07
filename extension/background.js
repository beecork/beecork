// Beecork Skeleton — background service worker.
//
// You pair once (a token + a list of approved sites, set in the popup). While
// capture is enabled, every open tab on an "auto" paired site is watched
// automatically — its console errors, uncaught exceptions, and failed network
// requests are captured via the Chrome DevTools Protocol (chrome.debugger) and
// POSTed to your local inbox (the bridge), which your coding agent reads. Works
// on localhost AND production, because it rides your real, logged-in tab.
//
// Safety: nothing off the approved-sites list is ever watched; the token means
// only this extension can write to the inbox; secrets are redacted before they
// leave the tab (redact.js). Still TODO (see ROADMAP): the reverse channel so
// beecork can request an on-demand site be watched for an investigation.

import { redact } from "./redact.js";

// The inbox port. An extension can't read env vars, so this is fixed — which means
// beecork's BEECORK_SKELETON_PORT override moves the inbox somewhere the extension
// won't follow. That override is for isolated runs (tests/evals) with no extension in
// the loop; if you ever change it for real use, change this constant to match.
const PORT = 8317;
const BASE = `http://localhost:${PORT}`;
const INBOX = `${BASE}/ingest`;
const PAIR = `${BASE}/pair`;
const WATCH_REQUESTS = `${BASE}/watch-requests`;
const watched = new Set(); // tabIds we've attached
const tabOrigins = new Map(); // tabId -> the tab's origin, stamped on each signal as `page` (lets beecork scope per project)
const reqInfo = new Map(); // requestId -> { method, url } — correlates network events
let requestedOrigins = new Set(); // origins beecork asked to watch (honored only if approved)

// In-memory mirror of the popup's settings (chrome.storage.local).
let config = { token: "", enabled: false, pairedSites: [] };

// --- Listeners (registered synchronously so they exist when the SW wakes) ---

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  await loadConfig();
  reconcile();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // Re-evaluate when a tab finishes loading or changes URL.
  if (changeInfo.status === "complete" || changeInfo.url) reconcile();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  watched.delete(tabId);
  tabOrigins.delete(tabId);
});

chrome.debugger.onEvent.addListener(onDebuggerEvent);

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId != null) {
    watched.delete(source.tabId);
    tabOrigins.delete(source.tabId);
    chrome.action.setBadgeText({ tabId: source.tabId, text: "" });
  }
});

chrome.runtime.onStartup.addListener(init);
chrome.runtime.onInstalled.addListener(init);
chrome.alarms.onAlarm.addListener(async (a) => {
  // Heartbeat: keep paired + re-reconcile so auto-watch survives SW eviction.
  if (a.name === "reconcile") {
    await loadConfig();
    await ensurePaired();
    reconcile();
  }
});

// Kick things off (not awaited — the SW must finish top-level work synchronously).
init();

async function init() {
  // 30s heartbeat (the MV3 minimum) so beecork's on-demand watch requests take
  // effect promptly and auto-watch survives service-worker eviction.
  chrome.alarms.create("reconcile", { periodInMinutes: 0.5 });
  await loadConfig();
  await ensurePaired();
  await reconcile();
}

// Auto-pair: fetch the token from the local bridge once. The bridge only hands
// it to the extension (web pages are refused), so the user never touches it.
async function ensurePaired() {
  if (config.token) return;
  try {
    const r = await fetch(PAIR);
    if (!r.ok) return;
    const token = (await r.text()).trim();
    if (token) {
      await chrome.storage.local.set({ token });
      config.token = token;
    }
  } catch {
    /* bridge not running yet — the heartbeat will retry */
  }
}

// --- Config ---

async function loadConfig() {
  try {
    const c = await chrome.storage.local.get(["token", "enabled", "pairedSites"]);
    config = {
      token: c.token || "",
      enabled: !!c.enabled,
      pairedSites: Array.isArray(c.pairedSites) ? c.pairedSites : [],
    };
  } catch {
    /* storage unavailable — keep last known config */
  }
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function shouldWatch(tab) {
  if (!config.enabled || !tab || tab.id == null) return false;
  const origin = originOf(tab.url || "");
  if (!origin) return false;
  const site = config.pairedSites.find((s) => s.origin === origin);
  if (!site) return false; // never watch a site the user hasn't approved
  // Approved: watch if it's an auto site, OR beecork has asked to watch it on demand.
  return site.auto || requestedOrigins.has(origin);
}

// Pull beecork's on-demand watch requests from the bridge (honored only for approved sites).
async function fetchWatchRequests() {
  try {
    const r = await fetch(WATCH_REQUESTS);
    if (!r.ok) return;
    const data = await r.json();
    requestedOrigins = new Set(Array.isArray(data.origins) ? data.origins : []);
  } catch {
    /* bridge down — leave the last known set */
  }
}

// --- Attach / detach reconciliation ---

async function reconcile() {
  await fetchWatchRequests(); // refresh beecork's on-demand requests before deciding
  let tabs;
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }
  const want = new Set();
  // Record each wanted tab's current origin here (fresh every reconcile — which runs on tab URL
  // changes too), so onDebuggerEvent can stamp `page` even after a navigation.
  for (const t of tabs) if (shouldWatch(t)) { want.add(t.id); tabOrigins.set(t.id, originOf(t.url)); }

  for (const id of want) if (!watched.has(id)) await start(id);
  for (const id of [...watched]) if (!want.has(id)) await stop(id);
}

async function start(tabId) {
  if (watched.has(tabId)) return;

  // The DevTools protocol allows only ONE debugger client per tab. Rather than
  // attach blindly and collide when DevTools or another extension (e.g.
  // Claude-in-Chrome) already owns the tab, ask first and stand down if it's
  // taken — a later reconcile adopts it once it's free. An active attachment
  // keeps our service worker alive, so `watched` reliably lists the tabs WE
  // hold; any other attached tab belongs to a different client, so we skip it.
  let target;
  try {
    target = (await chrome.debugger.getTargets()).find((t) => t.tabId === tabId);
  } catch {
    return; // couldn't enumerate targets — the next reconcile retries
  }
  if (!target || target.attached) return;

  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
    await chrome.debugger.sendCommand({ tabId }, "Log.enable");
    await chrome.debugger.sendCommand({ tabId }, "Network.enable");
  } catch {
    // Lost a race: the tab navigated to a restricted page, or another client
    // grabbed it between the check above and the attach. Undo any half-attach
    // and leave it — reconcile retries once the tab settles.
    try { await chrome.debugger.detach({ tabId }); } catch {}
    return;
  }
  watched.add(tabId);
  chrome.action.setBadgeText({ tabId, text: "●" });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#c0392b" });
  post({ kind: "watch", text: `watching tab ${tabId}`, ts: Date.now() });
}

async function stop(tabId) {
  watched.delete(tabId);
  tabOrigins.delete(tabId);
  chrome.action.setBadgeText({ tabId, text: "" });
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    /* already detached */
  }
}

// --- Sending to the inbox ---

async function post(signal) {
  if (!config.token) await loadConfig(); // race: event before init finished
  if (!config.token) return; // not paired — fail closed
  try {
    await fetch(INBOX, {
      method: "POST",
      // text/plain keeps it a "simple request" (no CORS preflight)
      headers: { "Content-Type": "text/plain" },
      // Scrub secrets in the browser; attach the pairing token for the bridge.
      body: JSON.stringify({ ...redact(signal), token: config.token }),
    });
  } catch (e) {
    console.warn("[skeleton] inbox unreachable (is the bridge running?):", e);
  }
}

// --- The DevTools-protocol event stream for every attached tab ---

function onDebuggerEvent(source, method, params) {
  const tabId = source.tabId;
  if (tabId == null || !watched.has(tabId)) return;
  const page = tabOrigins.get(tabId); // origin of the tab this signal came from — what beecork scopes on

  if (method === "Runtime.consoleAPICalled" && params.type === "error") {
    post({
      kind: "console",
      level: "error",
      text: (params.args || []).map(argToText).join(" "),
      url: params.stackTrace?.callFrames?.[0]?.url,
      page,
      ts: Date.now(),
    });
  } else if (method === "Runtime.exceptionThrown") {
    const d = params.exceptionDetails || {};
    post({
      kind: "pageError",
      level: "error",
      text: d.exception?.description || d.text || "Uncaught exception",
      url: d.url,
      page,
      ts: Date.now(),
    });
  } else if (method === "Log.entryAdded" && params.entry?.level === "error") {
    // Skip network-sourced log spam ("Failed to load resource: 404") — the
    // Network channel below already reports those with method/url/status.
    if (params.entry.source === "network") return;
    post({
      kind: "log",
      level: "error",
      text: params.entry.text,
      url: params.entry.url,
      page,
      ts: Date.now(),
    });
  } else if (method === "Network.requestWillBeSent") {
    reqInfo.set(params.requestId, { method: params.request?.method, url: params.request?.url });
  } else if (method === "Network.responseReceived") {
    const info = reqInfo.get(params.requestId);
    const status = params.response?.status;
    if (status >= 400) {
      post({
        kind: "network",
        level: "error",
        method: info?.method,
        url: params.response?.url,
        status,
        page,
        ts: Date.now(),
      });
    }
    // Keep the entry (marked handled) so a trailing loadingFailed — e.g. the
    // net::ERR_ABORTED that fires when a body goes unread — doesn't double-report.
    if (info) info.responded = true;
  } else if (method === "Network.loadingFailed") {
    const info = reqInfo.get(params.requestId);
    const err = params.errorText || "";
    // Report genuine transport failures (DNS, refused, CORS) — but not a benign
    // abort, and not a request we already reported an HTTP error for.
    if (info && !info.responded && err !== "net::ERR_ABORTED") {
      post({
        kind: "network",
        level: "error",
        method: info.method,
        url: info.url,
        status: 0,
        text: err,
        page,
        ts: Date.now(),
      });
    }
    reqInfo.delete(params.requestId);
  } else if (method === "Network.loadingFinished") {
    reqInfo.delete(params.requestId); // succeeded — forget it
  }
}

// Console args arrive as DevTools "RemoteObject"s — flatten to readable text.
function argToText(arg) {
  if (arg == null) return String(arg);
  if (arg.value !== undefined) return String(arg.value);
  if (arg.description) return arg.description;
  return arg.type || "";
}
