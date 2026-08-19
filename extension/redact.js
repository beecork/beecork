// Beecork Skeleton — secret redaction.
//
// Runs inside the extension, BEFORE any signal leaves the browser. The whole
// point of the tool is on-demand visibility without shipping your secrets to a
// file — so we scrub the two places a secret can realistically appear in what
// we capture: sensitive query params in URLs, and secret-shaped tokens in free
// text (console/exception/log messages). The NETWORK channel never carries headers or bodies — but
// console text very often does (a logged fetch error, a dumped request), which is why the patterns
// below include header shapes like "Authorization: Basic" and "Cookie:".
//
// Heuristic, not bulletproof — it favors catching common shapes over cleverness.

// Query-param keys whose *values* are secrets (matched case-insensitively).
const SECRET_PARAM =
  /(?:^|_|-)?(?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|apikey|token|secret|password|passwd|pwd|auth|session[_-]?id|sessionid|session|jwt|otp|csrf|sig|signature|credential|client[_-]?secret)$/i;

// Keys that are USUALLY not secrets — `?code=US`, `?key=name` are everyday debug data — but carry a
// real one often enough to matter (an OAuth authorization code is exchangeable for a token). Masked
// only when the VALUE looks like a secret, which is what keeps the false-positive count at zero.
const AMBIGUOUS_PARAM = /^(?:code|key|sid|state|nonce|auth[_-]?code)$/i;
const looksSecret = (v) => typeof v === "string" && v.length >= 12 && /[A-Za-z]/.test(v) && /[0-9_\-\/.]/.test(v);

// A path segment that is almost certainly a credential: long, mixed-case/alphanumeric, and not a
// build hash or a UUID. Password-reset and magic links put the secret in the PATH, where searchParams
// cannot see it. The two exclusions matter — without them every failed `main.<hash>.chunk.js` and
// every REST `/orders/<uuid>` in an error message would be masked, destroying the debug output this
// tool exists to provide.
const HIGH_ENTROPY = /^(?=.{24,}$)(?=.*[a-z])(?=.*[A-Z0-9])[A-Za-z0-9._~-]+$/;
const ASSET_FILE = /\.(?:js|mjs|cjs|css|map|json|png|jpe?g|gif|svg|webp|avif|woff2?|ttf|ico|wasm|html?|txt|xml|pdf)$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isSecretSegment = (seg) => HIGH_ENTROPY.test(seg) && !ASSET_FILE.test(seg) && !UUID.test(seg);

// Secret-shaped tokens embedded in free text.
const TEXT_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, // Authorization: Bearer ... leaked into a log
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, // JWTs
  // Every modern provider key breaks the old \bsk-[A-Za-z0-9]{16,} shape, which stopped at the first
  // hyphen: sk-ant-api03-… (Anthropic), sk-or-v1-… (OpenRouter — the format BEECORK ITSELF issues),
  // sk_live_… (Stripe, underscore not hyphen).
  /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g, // GitHub fine-grained PATs
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google API keys
  /\bBasic\s+[A-Za-z0-9+/=]{12,}/gi, // Authorization: Basic <base64>
  /(?:^|\b)(?:set-)?cookie:\s*\S+/gi, // a logged Cookie / Set-Cookie header
  /\b(?:aws_)?secret_access_key["'\s:=]+[A-Za-z0-9/+=]{30,}/gi,
  /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END[A-Z ]*PRIVATE KEY-----|$)/g,
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key IDs
  /\bghp_[A-Za-z0-9]{20,}/g, // GitHub personal tokens
  /\bgh[oprsu]_[A-Za-z0-9]{20,}/g, // other GitHub token types
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/gi, // Slack tokens
];

// URL-looking substrings inside free text, so we can scrub their query params too.
const URL_IN_TEXT = /https?:\/\/[^\s"'<>)\]}]+/g;

const MASK = "***";

function redactUrl(u) {
  if (typeof u !== "string") return u;
  try {
    const url = new URL(u);
    let changed = false;
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_PARAM.test(key) || (AMBIGUOUS_PARAM.test(key) && looksSecret(url.searchParams.get(key)))) {
        url.searchParams.set(key, MASK);
        changed = true;
      }
    }
    // userinfo — https://admin:s3cr3t@host/
    if (url.username || url.password) {
      if (url.username) url.username = MASK;
      if (url.password) url.password = MASK;
      changed = true;
    }
    // The FRAGMENT, which searchParams never sees: OAuth implicit flow puts the access token there.
    if (url.hash.length > 1) {
      const frag = new URLSearchParams(url.hash.slice(1));
      let fragChanged = false;
      for (const key of [...frag.keys()]) {
        if (SECRET_PARAM.test(key) || (AMBIGUOUS_PARAM.test(key) && looksSecret(frag.get(key)))) {
          frag.set(key, MASK);
          fragChanged = true;
        }
      }
      if (fragChanged) { url.hash = "#" + frag.toString(); changed = true; }
    }
    // The PATH — magic links, password-reset links, signed download URLs.
    const segs = url.pathname.split("/");
    const masked = segs.map((seg) => (isSecretSegment(seg) ? MASK : seg));
    if (masked.some((seg, i) => seg !== segs[i])) { url.pathname = masked.join("/"); changed = true; }
    return changed ? url.toString() : u;
  } catch {
    return u; // relative / non-URL string — leave it
  }
}

function redactText(s) {
  if (typeof s !== "string") return s;
  let out = s;
  for (const re of TEXT_PATTERNS) out = out.replace(re, MASK);
  out = out.replace(URL_IN_TEXT, (m) => redactUrl(m));
  return out;
}

// Return a scrubbed COPY of a signal — never mutate the original.
export function redact(signal) {
  const out = { ...signal };
  if (out.url) out.url = redactUrl(out.url);
  if (out.page) out.page = redactUrl(out.page); // an origin (no secrets), but scrub consistently
  if (out.text) out.text = redactText(out.text);
  return out;
}

// Exported for tests.
export const _internal = { redactUrl, redactText };
