import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Creds {
  url: string;
  apiKey: string;
  user: string;
  project: string;
}

export function fiberDir(): string {
  return process.env.FIBER_DIR ?? join(homedir(), ".fiber");
}

export function credsPath(): string {
  return process.env.FIBER_CREDENTIALS ?? join(fiberDir(), "credentials.json");
}

export function loadCreds(): Creds | null {
  if (process.env.FIBER_URL && process.env.FIBER_API_KEY) {
    return {
      url: process.env.FIBER_URL,
      apiKey: process.env.FIBER_API_KEY,
      user: process.env.FIBER_USER ?? "",
      project: process.env.FIBER_PROJECT ?? "",
    };
  }
  try {
    return JSON.parse(readFileSync(credsPath(), "utf8")) as Creds;
  } catch {
    return null;
  }
}

export function saveCreds(creds: Creds): string {
  mkdirSync(fiberDir(), { recursive: true });
  const path = credsPath();
  writeFileSync(path, JSON.stringify(creds, null, 2) + "\n", { mode: 0o600 });
  return path;
}

interface State {
  lastSeen?: number;
}

function statePath(): string {
  return join(fiberDir(), "state.json");
}

export function loadState(): State {
  try {
    return JSON.parse(readFileSync(statePath(), "utf8")) as State;
  } catch {
    return {};
  }
}

export function saveState(state: State): void {
  mkdirSync(fiberDir(), { recursive: true });
  writeFileSync(statePath(), JSON.stringify(state, null, 2) + "\n");
}

export function encodeInvite(url: string, code: string): string {
  return Buffer.from(JSON.stringify({ url, code }), "utf8").toString("base64url");
}

export function decodeInvite(key: string): { url: string; code: string } {
  const parsed = JSON.parse(Buffer.from(key.trim(), "base64url").toString("utf8"));
  if (typeof parsed.url !== "string" || typeof parsed.code !== "string") {
    throw new Error("Malformed invite key");
  }
  return parsed;
}
