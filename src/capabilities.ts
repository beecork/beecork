// Model capability lookup: which models accept OpenRouter's unified `reasoning` param.
// We gate the reasoning field on this so we never send it to a model that would reject it.
//
// FAIL-OPEN by design: a network hiccup — or a catalog that simply hasn't loaded yet — must
// never SILENTLY downgrade thinking. So "unknown" == "send it". The catalog is fetched once,
// lazily, in the BACKGROUND on first ask (no added latency on the model hot path); the first
// call or two may fail-open until it lands, then every later call uses the cached answer.

import { config } from "./config";

let capable: Set<string> | null = null; // ids that advertise reasoning support (null = unknown/not-loaded/failed)
let started = false;

// Kick off the one-time catalog fetch. Reuses the same `/models` endpoint `/model` already
// reads. Never throws — on any failure `capable` stays null (→ fail-open).
function loadCatalog(): void {
  if (started) return;
  started = true;
  fetch(config.modelsUrl, { signal: AbortSignal.timeout(config.webTimeoutMs) })
    .then((res) => res.json())
    .then((json: unknown) => {
      const data = (json as { data?: unknown }).data;
      if (!Array.isArray(data)) return; // leave capable=null (fail-open)
      const ids = new Set<string>();
      for (const m of data) {
        const id = (m as { id?: unknown }).id;
        const params = (m as { supported_parameters?: unknown }).supported_parameters;
        if (typeof id === "string" && Array.isArray(params) && params.includes("reasoning")) ids.add(id);
      }
      if (ids.size) capable = ids; // empty set is suspicious → treat as unknown (fail-open)
    })
    .catch(() => {
      /* fetch/parse failed — stays null → fail-open */
    });
}

// Strip an OpenRouter variant suffix (":free", ":nitro", …) so a variant still matches its
// base model's advertised capabilities.
const baseId = (slug: string): string => slug.split(":")[0];

// Should we send `reasoning` for this model? TRUE when it advertises support OR we simply
// don't know yet (fail-open). FALSE only when the loaded catalog positively lacks it.
export function shouldSendReasoning(model: string): boolean {
  loadCatalog();
  if (!capable) return true; // not loaded yet / fetch failed → fail-open
  return capable.has(model) || capable.has(baseId(model));
}
