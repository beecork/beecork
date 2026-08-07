// Beecork Skeleton — secret redaction.
//
// Runs inside the extension, BEFORE any signal leaves the browser. The whole
// point of the tool is on-demand visibility without shipping your secrets to a
// file — so we scrub the two places a secret can realistically appear in what
// we capture: sensitive query params in URLs, and secret-shaped tokens in free
// text (console/exception/log messages). We never capture request/response
// headers or bodies, so Authorization/Cookie never enter the pipeline at all.
//
// Heuristic, not bulletproof — it favors catching common shapes over cleverness.

// Query-param keys whose *values* are secrets (matched case-insensitively).
const SECRET_PARAM =
  /(?:^|_|-)?(?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|apikey|token|secret|password|passwd|pwd|auth|session[_-]?id|sessionid|sig|signature|credential|client[_-]?secret)$/i;

// Secret-shaped tokens embedded in free text.
const TEXT_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, // Authorization: Bearer ... leaked into a log
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, // JWTs
  /\bsk-[A-Za-z0-9]{16,}/g, // OpenAI-style keys
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
      if (SECRET_PARAM.test(key)) {
        url.searchParams.set(key, MASK);
        changed = true;
      }
    }
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
