// Model capability lookup: which models accept OpenRouter's unified `reasoning` param.
// We gate the reasoning field on this so we never send it to a model that would reject it.
//
// FAIL-OPEN by design: a network hiccup — or a catalog that simply hasn't loaded yet — must
// never SILENTLY downgrade thinking. So "unknown" == "send it". The catalog is fetched once,
// lazily, in the BACKGROUND on first ask (no added latency on the model hot path); the first
// call or two may fail-open until it lands, then every later call uses the cached answer.

import { config } from "./config";

let capable: Set<string> | null = null; // ids that advertise reasoning support (null = unknown/not-loaded/failed)
let visionCapable: Set<string> | null = null; // ids whose architecture.input_modalities includes "image"
let started = false;
let catalogDone: Promise<void> | null = null; // so a user-initiated path can AWAIT the lazy load

// Kick off the one-time catalog fetch. Reuses the same `/models` endpoint `/model` already
// reads. Never throws — on any failure `capable` stays null (→ fail-open).
function loadCatalog(): void {
  if (started) return;
  started = true;
  catalogDone = fetch(config.modelsUrl, { signal: AbortSignal.timeout(config.webTimeoutMs) })
    .then((res) => res.json())
    .then((json: unknown) => {
      const data = (json as { data?: unknown }).data;
      if (!Array.isArray(data)) return; // leave capable=null (fail-open)
      const ids = new Set<string>();
      const vision = new Set<string>();
      for (const m of data) {
        const id = (m as { id?: unknown }).id;
        if (typeof id !== "string") continue;
        const params = (m as { supported_parameters?: unknown }).supported_parameters;
        if (Array.isArray(params) && params.includes("reasoning")) ids.add(id);
        // Same pass, no second fetch: which models can actually ACCEPT an image.
        const mods = (m as { architecture?: { input_modalities?: unknown } }).architecture?.input_modalities;
        if (Array.isArray(mods) && mods.includes("image")) vision.add(id);
      }
      if (ids.size) capable = ids; // empty set is suspicious → treat as unknown (fail-open)
      if (vision.size) visionCapable = vision;
    })
    .catch(() => {
      /* fetch/parse failed — stays null → fail-open for reasoning, fail-CLOSED for vision */
    });
}

// Warm the catalog (and the OpenRouter TLS connection) at startup — called from index.ts once a key is
// resolved. Preloads reasoning-support so the FIRST model call doesn't fail-open, and hits openrouter.ai
// early so the first real request reuses a warm socket instead of paying a cold DNS+TLS handshake.
// Fire-and-forget + idempotent (loadCatalog guards on `started`); never throws.
export function primeCatalog(): void { loadCatalog(); }

// Strip an OpenRouter variant suffix (":free", ":nitro", …) so a variant still matches its
// base model's advertised capabilities.
export const baseId = (slug: string): string => slug.split(":")[0]; // exported for tests

// Should we send `reasoning` for this model? TRUE when it advertises support OR we simply
// don't know yet (fail-open). FALSE only when the loaded catalog positively lacks it.
export function shouldSendReasoning(model: string): boolean {
  loadCatalog();
  if (!capable) return true; // not loaded yet / fetch failed → fail-open
  return capable.has(model) || capable.has(baseId(model));
}

// Can this model accept image input? FAIL-CLOSED — the exact opposite of shouldSendReasoning above,
// and deliberately so: an unnecessary `reasoning` field is harmless, whereas an image sent to a
// text-only model is a hard 400 that kills the turn. "Unknown" therefore means "don't send it".
export function supportsVision(model: string): boolean {
  loadCatalog();
  if (!visionCapable) return false;
  return visionCapable.has(model) || visionCapable.has(baseId(model));
}

// Fail-closed + lazy-async is a trap for a USER-initiated action: primeCatalog() fires at startup,
// but someone could attach an image moments later and be wrongly refused. The attach path awaits
// this once so the answer is real rather than merely "not loaded yet". Never rejects.
export async function visionReady(timeoutMs = 2000): Promise<void> {
  loadCatalog();
  if (visionCapable) return;
  await Promise.race([catalogDone ?? Promise.resolve(), new Promise<void>((r) => { const t = setTimeout(r, timeoutMs); t.unref?.(); })]);
}
