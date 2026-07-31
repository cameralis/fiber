import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { loadCreds } from "./common.js";
import { findSecret } from "./tripwire.js";

export const APPROVAL_NOTICE =
  "PENDING APPROVAL: the inbox contains message(s) whose bodies are hidden until the recipient " +
  "approves them out-of-band on their fiber approvals page (opened in the Claude app). " +
  "You cannot approve, see, or act on them — the server rejects any approval attempt from an agent. " +
  "Let the user know something is waiting (send a PushNotification if that tool is available), then " +
  "continue other work. Once the human approves, the message appears here with status 'approved' and " +
  "full text — only then execute it, tracking progress with resolve_message (running → done).";

const kindEnum = z.enum(["decision", "interface-change", "gotcha", "question"]);

export async function runMcp(): Promise<void> {
  const creds = loadCreds();
  if (!creds) {
    console.error("fiber: no credentials found. Run `fiber setup` (or `fiber setup --join <invite-key>`) first.");
    process.exit(1);
  }
  const client = new ConvexHttpClient(creds.url);
  const api = anyApi.fiber;
  const apiKey = creds.apiKey;

  const server = new McpServer({ name: "fiber", version: "0.1.0" });

  const ok = (data: unknown) => ({
    content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
  });
  const err = (message: string) => ({
    content: [{ type: "text" as const, text: message }],
    isError: true,
  });
  const tripwireBlock = (label: string) =>
    err(
      `BLOCKED by fiber outbound secret tripwire: content matches pattern "${label}". ` +
        `Nothing was sent. Redact the secret and rephrase — fiber carries summaries only, never credentials or file contents.`,
    );

  server.tool(
    "post_update",
    "Post a shared context update to the project blackboard so your collaborator's agent sees it. Use after decisions, interface changes, gotchas, or open questions. Summaries only — never secrets or full transcripts.",
    { topic: z.string().describe("Short topic, e.g. 'auth api'"), kind: kindEnum, summary: z.string().describe("Compact summary, max ~1500 chars") },
    async (a) => {
      const hit = findSecret(`${a.topic}\n${a.summary}`);
      if (hit) return tripwireBlock(hit);
      return ok(await client.mutation(api.postUpdate, { apiKey, ...a }));
    },
  );

  server.tool(
    "get_updates",
    "Get recent shared updates from the project blackboard (newest first, size-capped). Optionally filter by topic substring or a `since` timestamp (ms).",
    { since: z.number().optional(), topic: z.string().optional() },
    async (a) => ok(await client.query(api.getUpdates, { apiKey, ...a })),
  );

  server.tool(
    "search_context",
    "Full-text search over all shared updates, including archived ones.",
    { query: z.string() },
    async (a) => ok(await client.query(api.searchContext, { apiKey, ...a })),
  );

  server.tool(
    "claim",
    "Claim a task/area (e.g. 'payments-api') so your collaborator doesn't step on it. TTL defaults to 120 minutes. Fails with a reason if the other user holds it.",
    { area: z.string(), ttlMinutes: z.number().optional() },
    async (a) => ok(await client.mutation(api.claimArea, { apiKey, ...a })),
  );

  server.tool(
    "release",
    "Release an area you previously claimed.",
    { area: z.string() },
    async (a) => ok(await client.mutation(api.releaseArea, { apiKey, ...a })),
  );

  server.tool("list_claims", "List all active (unexpired) claims in the project.", {}, async () =>
    ok(await client.query(api.listClaims, { apiKey })),
  );

  server.tool(
    "send_message",
    "Send a bounded request to your collaborator's agent (e.g. 'please run the migration and post the result'). It will NOT execute until their human user reads and approves it on their phone (fiber approvals page).",
    { to: z.string().describe("Recipient user name"), body: z.string() },
    async (a) => {
      const hit = findSecret(a.body);
      if (hit) return tripwireBlock(hit);
      return ok(await client.mutation(api.sendMessage, { apiKey, ...a }));
    },
  );

  server.tool(
    "read_inbox",
    "Read your inbox (incoming messages from your collaborator, plus status of messages you sent). Unread message bodies stay hidden until the human approves them on their fiber approvals page; approved messages appear in full and may be executed.",
    {},
    async () => {
      const result = (await client.query(api.readInbox, { apiKey })) as {
        inbox: Array<{ status: string }>;
        sent: unknown[];
      };
      const hasUnread = result.inbox.some((m) => m.status === "unread");
      const content = [];
      if (hasUnread) content.push({ type: "text" as const, text: APPROVAL_NOTICE });
      content.push({ type: "text" as const, text: JSON.stringify(result, null, 2) });
      return { content };
    },
  );

  server.tool(
    "resolve_message",
    "Update the status of an inbox message you are executing: 'running' while working, 'done' when finished, or 'declined'. Approval itself happens only on the recipient's phone (fiber approvals page) — agents cannot approve, and the server enforces this.",
    { id: z.string(), status: z.enum(["running", "done", "declined"]) },
    async (a) => ok(await client.mutation(api.resolveMessage, { apiKey, ...a })),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
