export type { CapabilityPack, EnabledCapability } from './types.js';
export { CAPABILITY_PACKS } from './packs.js';
export { getAvailablePacks, getEnabledCapabilities, isEnabled, enablePack, disablePack, updateMcpConfig } from './manager.js';
