// Browser polyfills for Solana / MagicBlock libraries that expect Node globals.
// The MagicBlock ephemeral-rollups-sdk references `Buffer` at module-eval time,
// so this MUST be imported before any of those modules load (first import in
// main.tsx). Without it the app white-screens with "Buffer is not defined".
import { Buffer } from "buffer";

const g = globalThis as unknown as { Buffer?: typeof Buffer; global?: unknown };
if (!g.Buffer) g.Buffer = Buffer;
if (!g.global) g.global = globalThis;
