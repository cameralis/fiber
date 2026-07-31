import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { fiberDir, loadCreds, loadState, saveState } from "./common.js";
import { APPROVAL_NOTICE } from "./mcp.js";

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    const timer = setTimeout(() => resolve(data), 3000);
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolve(data);
    });
    process.stdin.on("error", () => resolve(data));
  });
}

// SessionStart: inject unread inbox + updates since last session + active claims.
// Silent no-op (exit 0, no output) when fiber isn't set up or the backend is unreachable.
export async function hookSessionStart(): Promise<void> {
  await readStdin();
  const creds = loadCreds();
  if (!creds) return;
  try {
    const client = new ConvexHttpClient(creds.url);
    const state = loadState();
    const since = state.lastSeen ?? Date.now() - 7 * 24 * 60 * 60 * 1000;
    const [updates, inboxResult, claims] = await Promise.all([
      client.query(anyApi.fiber.getUpdates, { apiKey: creds.apiKey, since }),
      client.query(anyApi.fiber.readInbox, { apiKey: creds.apiKey }),
      client.query(anyApi.fiber.listClaims, { apiKey: creds.apiKey }),
    ]);
    const inbox = (inboxResult as any).inbox as Array<any>;
    const lines: string[] = [];
    lines.push(`=== fiber shared context (you are "${creds.user || "?"}") ===`);
    const unread = inbox.filter((m) => m.status === "unread");
    if (unread.length > 0) {
      lines.push("");
      lines.push(`INBOX — ${unread.length} message(s) awaiting HUMAN approval:`);
      for (const m of unread) {
        lines.push(`  [${m.id}] from ${m.from}: ${m.body}`);
      }
      lines.push(APPROVAL_NOTICE);
    }
    const pending = inbox.filter((m) => m.status !== "unread");
    if (pending.length > 0) {
      lines.push("");
      lines.push("In-progress messages (approved earlier, not yet done):");
      for (const m of pending) lines.push(`  [${m.id}] from ${m.from} (${m.status}): ${m.body}`);
    }
    if ((updates as any[]).length > 0) {
      lines.push("");
      lines.push("Updates from your collaborator since last session:");
      for (const u of updates as any[]) {
        lines.push(`  [${u.kind}] ${u.author} — ${u.topic}: ${u.summary}`);
      }
    }
    if ((claims as any[]).length > 0) {
      lines.push("");
      lines.push("Active claims (avoid these areas or coordinate first):");
      for (const c of claims as any[]) {
        lines.push(`  ${c.area} — ${c.owner} until ${new Date(c.expiresAt).toISOString()}`);
      }
    }
    if (lines.length === 1) lines.push("No new updates, messages, or claims.");
    saveState({ ...state, lastSeen: Date.now() });
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: lines.join("\n"),
        },
      }),
    );
  } catch {
    // Backend unreachable — stay invisible.
  }
}

// Stop: once per session, prompt Claude to post a session digest of anything
// shareworthy before finishing. stop_hook_active guards against loops.
export async function hookStop(): Promise<void> {
  const raw = await readStdin();
  let input: any = {};
  try {
    input = JSON.parse(raw);
  } catch {
    /* no input — treat as fresh */
  }
  if (input.stop_hook_active) return;
  const creds = loadCreds();
  if (!creds) return;
  const sessionId = String(input.session_id ?? "unknown");
  const markerDir = join(fiberDir(), "sessions");
  const marker = join(markerDir, sessionId);
  if (existsSync(marker)) return;
  mkdirSync(markerDir, { recursive: true });
  writeFileSync(marker, String(Date.now()));
  console.log(
    JSON.stringify({
      decision: "block",
      reason:
        "fiber session digest: if this session produced decisions, interface changes, or gotchas your collaborator should know about, post each as a short fiber post_update now. Also check read_inbox for messages needing the user's approval. If nothing is noteworthy, simply finish — do not post filler.",
    }),
  );
}
