import os from "node:os";
import path from "node:path";

export function getSessionsDir() {
  return process.env.CODEX_SESSIONS_DIR ?? path.join(os.homedir(), ".codex", "sessions");
}

export function getCacheDir() {
  return process.env.CODEX_VIZ_CACHE_DIR ?? path.join(os.homedir(), ".codex-viz", "cache");
}

