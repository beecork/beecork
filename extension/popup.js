// Beecork Skeleton — popup control center.
// Connection is automatic (the token is fetched from the local bridge); the
// user only flips capture on and approves sites.

const PORT = 8317; // keep in sync with background.js — see the note there
const PAIR = `http://localhost:${PORT}/pair`;
const $ = (id) => document.getElementById(id);

async function getCfg() {
  const c = await chrome.storage.local.get(["token", "enabled", "pairedSites"]);
  return {
    token: c.token || "",
    enabled: !!c.enabled,
    pairedSites: Array.isArray(c.pairedSites) ? c.pairedSites : [],
  };
}

async function setCfg(patch) {
  await chrome.storage.local.set(patch);
  render();
}

// Try to connect to the local bridge if we aren't already paired.
async function ensurePaired() {
  const { token } = await getCfg();
  if (token) return true;
  try {
    const r = await fetch(PAIR);
    if (!r.ok) return false;
    const t = (await r.text()).trim();
    if (!t) return false;
    await chrome.storage.local.set({ token: t });
    return true;
  } catch {
    return false; // bridge not running
  }
}

// Dev origins default to auto-watch (frictionless); everything else is on-demand.
function isLocal(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin);
}

async function render() {
  const cfg = await getCfg();
  $("enabled").checked = cfg.enabled;

  const s = $("status");
  if (!cfg.token) {
    s.textContent = "Not connected — run beecork; it starts the inbox itself.";
    s.className = "badge warn";
  } else if (cfg.enabled) {
    s.textContent = "Connected ✓ · capture ON";
    s.className = "badge ok";
  } else {
    s.textContent = "Connected ✓ · capture OFF";
    s.className = "muted";
  }

  const sites = cfg.pairedSites;
  $("noSites").style.display = sites.length ? "none" : "block";
  const box = $("sites");
  box.textContent = "";
  sites.forEach((site, i) => {
    const row = document.createElement("div");
    row.className = "site";

    const origin = document.createElement("span");
    origin.className = "origin";
    origin.textContent = site.origin;
    origin.title = site.origin;

    const autoLabel = document.createElement("label");
    const auto = document.createElement("input");
    auto.type = "checkbox";
    auto.checked = !!site.auto;
    auto.onchange = async () => {
      const c = await getCfg();
      if (c.pairedSites[i]) c.pairedSites[i].auto = auto.checked;
      await setCfg({ pairedSites: c.pairedSites });
    };
    autoLabel.append(auto, document.createTextNode(" auto"));

    const x = document.createElement("button");
    x.className = "x";
    x.textContent = "✕";
    x.title = "Remove";
    x.onclick = async () => {
      const c = await getCfg();
      c.pairedSites.splice(i, 1);
      await setCfg({ pairedSites: c.pairedSites });
    };

    row.append(origin, autoLabel, x);
    box.appendChild(row);
  });
}

$("enabled").onchange = () => setCfg({ enabled: $("enabled").checked });

$("pair").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let origin = null;
  try {
    origin = new URL(tab.url).origin;
  } catch {
    /* no url */
  }
  if (!origin || !/^https?:/.test(origin)) {
    $("status").textContent = "Can’t pair this page (only http/https tabs).";
    $("status").className = "badge warn";
    return;
  }
  const c = await getCfg();
  if (c.pairedSites.some((s) => s.origin === origin)) return; // already paired
  c.pairedSites.push({ origin, auto: isLocal(origin) }); // dev → auto, prod → on-demand
  await setCfg({ pairedSites: c.pairedSites });
};

// Connect automatically the moment the popup opens, then draw.
ensurePaired().then(render);
