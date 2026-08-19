// Redaction tests for the browser extension's on-device scrubber. This is the product's ONLY privacy
// control on its most sensitive data source — console text and request URLs captured from the user's
// real, logged-in browser tabs on production sites.
//
// It lives in src/ because package.json's test script globs src/*.test.ts; the module under test is
// plain JS in extension/, which typechecks thanks to "allowJs" in tsconfig.json.
//
// The KEEPS table is as important as the LEAKS one: this tool exists to make debugging possible, and
// a redactor that masks every build hash and REST id destroys the output it was meant to protect.
// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore — plain JS module, no types; _internal is exported for exactly this.
import { _internal } from "../extension/redact.js";

const { redactText, redactUrl } = _internal as { redactText: (s: string) => string; redactUrl: (s: string) => string };

// Every fixture below is visibly synthetic — repeated EXAMPLE/NOTREAL text, no entropy. They must
// match the regexes under test WITHOUT looking like real credentials: GitHub push protection blocked
// this file's first version over a Stripe-shaped fixture, and it was right to. A test corpus is not
// a place to carry realistic-looking keys.
const LEAKS_TEXT: [string, string][] = [
  ["Anthropic", "auth failed: sk-ant-api03-EXAMPLE0NOT0A0REAL0KEY0000"],
  ["OpenRouter (the format beecork itself issues)", "using key sk-or-v1-EXAMPLE0NOT0A0REAL0KEY0000"],
  ["Stripe secret", "charge failed with sk_live_EXAMPLE0NOT0A0REAL0KEY"],
  ["GitHub fine-grained PAT", "github_pat_EXAMPLE0NOT0A0REAL0TOKEN00"],
  ["Google API key", "maps error, key AIzaEXAMPLE0NOT0A0REAL0KEY0000000000000"],
  ["Basic auth header", "Authorization: Basic RVhBTVBMRTpOT1RSRUFM"],
  ["Cookie header", "request failed, Cookie: sessionid=8f3c1e9a7b2d4f60; csrftoken=QkLmNoPq"],
  ["AWS secret access key", 'aws_secret_access_key = "EXAMPLE0NOT0A0REAL0SECRET0ACCESS0KEY000"'],
  ["PEM private key", "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----"],
  ["legacy OpenAI (already worked)", "sk-ABCDEFGHIJ1234567890"],
  ["Bearer (already worked)", "Authorization: Bearer abc.def-ghi123"],
];

const LEAKS_URL: [string, string][] = [
  ["OAuth implicit token in the FRAGMENT", "https://app.example.com/callback#access_token=ya29.a0AfB_byC9xKp2QrS&token_type=Bearer"],
  ["OAuth authorization code", "https://app.example.com/cb?code=4%2F0AY0e-g7xQmKpLdNvR8sT&state=abc"],
  ["api key as ?key=", "https://maps.googleapis.com/maps/api/js?key=AIzaEXAMPLE0NOT0A0REAL0KEY0000000000000"],
  ["secret in the PATH (reset link)", "https://app.example.com/reset-password/9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c"],
  ["userinfo credentials", "https://admin:hunter2@internal.example.com/x"],
  ["?token= (already worked)", "https://api.example.com/v1?token=abcdef1234567890"],
];

// Everyday debug data that must survive — the half that keeps the tool useful.
const KEEPS: [string, string][] = [
  ["a country code", "https://api.example.com/geo?code=US"],
  ["an http status", "https://api.example.com/x?code=404"],
  ["a webpack chunk hash", "https://app.example.com/static/js/main.4f2a9c1b8e3d7f6a5c4b.chunk.js"],
  ["a REST uuid path", "https://api.example.com/v1/orders/9f8e7d6c-5b4a-4c3d-8e2f-ba9876543210"],
  ["an ordinary page", "https://app.example.com/dashboard/settings?tab=billing"],
];

test("redactText masks the credential shapes users actually have", () => {
  for (const [name, input] of LEAKS_TEXT) {
    assert.match(redactText(input), /\*\*\*/, `must be redacted: ${name}`);
  }
});

test("redactUrl masks query, FRAGMENT, PATH and userinfo secrets", () => {
  for (const [name, input] of LEAKS_URL) {
    assert.match(redactUrl(input), /\*\*\*/, `must be redacted: ${name}`);
  }
  // redactText also scrubs URLs embedded in free text, via the same function.
  assert.match(redactText("failed: https://app.example.com/callback#access_token=ya29.aVeryLongTokenValue"), /\*\*\*/);
});

test("redaction does NOT destroy ordinary debug output", () => {
  for (const [name, input] of KEEPS) {
    assert.doesNotMatch(redactUrl(input), /\*\*\*/, `must NOT be redacted: ${name}`);
  }
  // A redactor that eats the message is worse than none: the text around a secret must survive.
  const out = redactText("POST /login failed for sk-ant-api03-EXAMPLE0NOT0A0REAL0KEY0000 (401)");
  assert.match(out, /POST \/login failed for/);
  assert.match(out, /\(401\)/);
});
