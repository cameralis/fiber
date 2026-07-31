import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { kindValidator, messageStatusValidator } from "./schema";

const DAY_MS = 24 * 60 * 60 * 1000;
const ARCHIVE_AFTER_MS = 30 * DAY_MS;
const SUMMARY_MAX_CHARS = 1500;
const BODY_MAX_CHARS = 4000;
const DIGEST_MAX_ITEMS = 20;
const DIGEST_CHAR_BUDGET = 6000;
const DEFAULT_CLAIM_TTL_MIN = 120;

const updateEntryValidator = v.object({
  id: v.id("updates"),
  author: v.string(),
  topic: v.string(),
  kind: kindValidator,
  summary: v.string(),
  createdAt: v.number(),
});

async function requireUser(ctx: QueryCtx | MutationCtx, apiKey: string): Promise<Doc<"users">> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_apiKey", (q) => q.eq("apiKey", apiKey))
    .unique();
  if (!user) throw new Error("Invalid fiber API key");
  return user;
}

async function audit(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  actor: string,
  action: string,
  details: string,
) {
  await ctx.db.insert("audit_log", {
    projectId,
    actor,
    action,
    details: details.slice(0, 2000),
    createdAt: Date.now(),
  });
}

function newKey(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
}

// ---------- provisioning ----------

export const createProject = mutation({
  args: {
    projectName: v.string(),
    userName: v.string(),
    pinHash: v.string(),
    pinSalt: v.string(),
  },
  returns: v.object({
    apiKey: v.string(),
    inviteCode: v.string(),
    projectId: v.id("projects"),
    connectorSecret: v.string(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", { name: args.projectName, createdAt: now });
    const apiKey = newKey("fbr");
    const connectorSecret = newKey("cnx");
    await ctx.db.insert("users", {
      projectId,
      name: args.userName,
      apiKey,
      createdAt: now,
      pinHash: args.pinHash,
      pinSalt: args.pinSalt,
      connectorSecret,
    });
    const code = newKey("inv");
    await ctx.db.insert("invites", { projectId, code, createdAt: now });
    await audit(ctx, projectId, args.userName, "create_project", `project=${args.projectName}`);
    return { apiKey, inviteCode: code, projectId, connectorSecret };
  },
});

export const joinProject = mutation({
  args: {
    inviteCode: v.string(),
    userName: v.string(),
    pinHash: v.string(),
    pinSalt: v.string(),
  },
  returns: v.object({
    apiKey: v.string(),
    projectId: v.id("projects"),
    connectorSecret: v.string(),
  }),
  handler: async (ctx, args) => {
    const invite = await ctx.db
      .query("invites")
      .withIndex("by_code", (q) => q.eq("code", args.inviteCode))
      .unique();
    if (!invite) throw new Error("Invalid invite code");
    if (invite.usedBy) throw new Error(`Invite already used by ${invite.usedBy}`);
    const existing = await ctx.db
      .query("users")
      .withIndex("by_project", (q) => q.eq("projectId", invite.projectId))
      .collect();
    if (existing.some((u) => u.name === args.userName)) {
      throw new Error(`User name "${args.userName}" is already taken in this project`);
    }
    const apiKey = newKey("fbr");
    const connectorSecret = newKey("cnx");
    await ctx.db.insert("users", {
      projectId: invite.projectId,
      name: args.userName,
      apiKey,
      createdAt: Date.now(),
      pinHash: args.pinHash,
      pinSalt: args.pinSalt,
      connectorSecret,
    });
    await ctx.db.patch(invite._id, { usedBy: args.userName });
    await audit(ctx, invite.projectId, args.userName, "join_project", "via invite");
    return { apiKey, projectId: invite.projectId, connectorSecret };
  },
});

export const createInvite = mutation({
  args: { apiKey: v.string() },
  returns: v.object({ inviteCode: v.string() }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.apiKey);
    const code = newKey("inv");
    await ctx.db.insert("invites", { projectId: user.projectId, code, createdAt: Date.now() });
    await audit(ctx, user.projectId, user.name, "create_invite", "");
    return { inviteCode: code };
  },
});

// ---------- blackboard: updates ----------

export const postUpdate = mutation({
  args: { apiKey: v.string(), topic: v.string(), kind: kindValidator, summary: v.string() },
  returns: v.object({ id: v.id("updates"), truncated: v.boolean() }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.apiKey);
    const summary = args.summary.slice(0, SUMMARY_MAX_CHARS);
    const topic = args.topic.slice(0, 120);
    const id = await ctx.db.insert("updates", {
      projectId: user.projectId,
      author: user.name,
      topic,
      kind: args.kind,
      summary,
      searchText: `${topic} ${summary}`,
      createdAt: Date.now(),
    });
    await audit(ctx, user.projectId, user.name, "post_update", `[${args.kind}] ${topic}`);
    return { id, truncated: args.summary.length > SUMMARY_MAX_CHARS };
  },
});

export const getUpdates = query({
  args: { apiKey: v.string(), since: v.optional(v.number()), topic: v.optional(v.string()) },
  returns: v.array(updateEntryValidator),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.apiKey);
    const cutoff = Math.max(args.since ?? 0, Date.now() - ARCHIVE_AFTER_MS);
    let items = await ctx.db
      .query("updates")
      .withIndex("by_project", (q) => q.eq("projectId", user.projectId).gt("createdAt", cutoff))
      .order("desc")
      .take(100);
    if (args.topic) {
      const t = args.topic.toLowerCase();
      items = items.filter((u) => u.topic.toLowerCase().includes(t));
    }
    items = items.slice(0, DIGEST_MAX_ITEMS);
    const out = [];
    let budget = DIGEST_CHAR_BUDGET;
    for (const u of items) {
      budget -= u.summary.length + u.topic.length + 40;
      if (budget < 0) break;
      out.push({
        id: u._id,
        author: u.author,
        topic: u.topic,
        kind: u.kind,
        summary: u.summary,
        createdAt: u.createdAt,
      });
    }
    return out;
  },
});

export const searchContext = query({
  args: { apiKey: v.string(), query: v.string() },
  returns: v.array(updateEntryValidator),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.apiKey);
    const results = await ctx.db
      .query("updates")
      .withSearchIndex("search_text", (q) =>
        q.search("searchText", args.query).eq("projectId", user.projectId),
      )
      .take(15);
    return results.map((u) => ({
      id: u._id,
      author: u.author,
      topic: u.topic,
      kind: u.kind,
      summary: u.summary,
      createdAt: u.createdAt,
    }));
  },
});

// ---------- claims ----------

export const claimArea = mutation({
  args: { apiKey: v.string(), area: v.string(), ttlMinutes: v.optional(v.number()) },
  returns: v.union(
    v.object({ ok: v.literal(true), area: v.string(), expiresAt: v.number() }),
    v.object({ ok: v.literal(false), reason: v.string() }),
  ),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.apiKey);
    const area = args.area.trim().toLowerCase().slice(0, 120);
    const now = Date.now();
    const existing = await ctx.db
      .query("claims")
      .withIndex("by_project_area", (q) => q.eq("projectId", user.projectId).eq("area", area))
      .collect();
    for (const c of existing) {
      if (c.expiresAt <= now || c.owner === user.name) {
        await ctx.db.delete(c._id);
      } else {
        return {
          ok: false as const,
          reason: `"${area}" is claimed by ${c.owner} until ${new Date(c.expiresAt).toISOString()}`,
        };
      }
    }
    const ttl = Math.min(Math.max(args.ttlMinutes ?? DEFAULT_CLAIM_TTL_MIN, 1), 24 * 60);
    const expiresAt = now + ttl * 60 * 1000;
    await ctx.db.insert("claims", {
      projectId: user.projectId,
      area,
      owner: user.name,
      expiresAt,
      createdAt: now,
    });
    await audit(ctx, user.projectId, user.name, "claim", `${area} (ttl ${ttl}m)`);
    return { ok: true as const, area, expiresAt };
  },
});

export const releaseArea = mutation({
  args: { apiKey: v.string(), area: v.string() },
  returns: v.object({ ok: v.boolean(), area: v.string() }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.apiKey);
    const area = args.area.trim().toLowerCase().slice(0, 120);
    const existing = await ctx.db
      .query("claims")
      .withIndex("by_project_area", (q) => q.eq("projectId", user.projectId).eq("area", area))
      .collect();
    let released = false;
    for (const c of existing) {
      if (c.owner === user.name) {
        await ctx.db.delete(c._id);
        released = true;
      }
    }
    if (released) await audit(ctx, user.projectId, user.name, "release", area);
    return { ok: released, area };
  },
});

export const listClaims = query({
  args: { apiKey: v.string() },
  returns: v.array(v.object({ area: v.string(), owner: v.string(), expiresAt: v.number() })),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.apiKey);
    const now = Date.now();
    const claims = await ctx.db
      .query("claims")
      .withIndex("by_project", (q) => q.eq("projectId", user.projectId))
      .collect();
    return claims
      .filter((c) => c.expiresAt > now)
      .map((c) => ({ area: c.area, owner: c.owner, expiresAt: c.expiresAt }));
  },
});

// ---------- messaging ----------

export const sendMessage = mutation({
  args: { apiKey: v.string(), to: v.string(), body: v.string() },
  returns: v.object({ id: v.id("messages"), truncated: v.boolean() }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.apiKey);
    const members = await ctx.db
      .query("users")
      .withIndex("by_project", (q) => q.eq("projectId", user.projectId))
      .collect();
    const recipient = members.find((m) => m.name === args.to);
    if (!recipient) {
      const names = members.map((m) => m.name).join(", ");
      throw new Error(`Unknown recipient "${args.to}". Project members: ${names}`);
    }
    const body = args.body.slice(0, BODY_MAX_CHARS);
    const id = await ctx.db.insert("messages", {
      projectId: user.projectId,
      from: user.name,
      to: recipient.name,
      body,
      status: "unread",
      createdAt: Date.now(),
    });
    await audit(ctx, user.projectId, user.name, "send_message", `to=${recipient.name} len=${body.length}`);
    return { id, truncated: args.body.length > BODY_MAX_CHARS };
  },
});

export const readInbox = query({
  args: { apiKey: v.string() },
  returns: v.object({
    inbox: v.array(
      v.object({
        id: v.id("messages"),
        from: v.string(),
        body: v.string(),
        status: messageStatusValidator,
        createdAt: v.number(),
      }),
    ),
    sent: v.array(
      v.object({
        id: v.id("messages"),
        to: v.string(),
        status: messageStatusValidator,
        createdAt: v.number(),
        resolvedAt: v.optional(v.number()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.apiKey);
    const inbox = await ctx.db
      .query("messages")
      .withIndex("by_project_to", (q) => q.eq("projectId", user.projectId).eq("to", user.name))
      .order("desc")
      .take(50);
    const sent = await ctx.db
      .query("messages")
      .withIndex("by_project_from", (q) => q.eq("projectId", user.projectId).eq("from", user.name))
      .order("desc")
      .take(20);
    // Unread bodies are withheld from agents entirely: the (possibly poisoned)
    // payload enters an agent context only after the human approved it on the
    // approvals page, where they read the real text.
    return {
      inbox: inbox
        .filter((m) => m.status !== "done" && m.status !== "declined")
        .slice(0, 20)
        .map((m) => ({
          id: m._id,
          from: m.from,
          body:
            m.status === "unread"
              ? "[body hidden until the recipient approves this message on their fiber approvals page]"
              : m.body,
          status: m.status,
          createdAt: m.createdAt,
        })),
      sent: sent.map((m) => ({
        id: m._id,
        to: m.to,
        status: m.status,
        createdAt: m.createdAt,
        resolvedAt: m.resolvedAt,
      })),
    };
  },
});

// Agent bearer keys have NO path to "approved" — that transition exists only
// in the PIN-gated approvals endpoint (convex/approvals.ts + http.ts).
const TRANSITIONS: Record<string, string[]> = {
  unread: ["declined"],
  approved: ["running", "done", "declined"],
  running: ["done", "declined"],
  done: [],
  declined: [],
};

export const resolveMessage = mutation({
  args: { apiKey: v.string(), id: v.id("messages"), status: messageStatusValidator },
  returns: v.object({ id: v.id("messages"), status: messageStatusValidator }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.apiKey);
    const msg = await ctx.db.get(args.id);
    if (!msg || msg.projectId !== user.projectId) throw new Error("Message not found");
    if (msg.to !== user.name) throw new Error("Only the recipient can resolve a message");
    if (args.status === "approved") {
      throw new Error(
        "Approval cannot be granted by an agent. The recipient approves on their fiber approvals page (Claude app); the status will change to 'approved' once they do.",
      );
    }
    if (!TRANSITIONS[msg.status].includes(args.status)) {
      throw new Error(`Cannot move message from "${msg.status}" to "${args.status}"`);
    }
    await ctx.db.patch(args.id, { status: args.status, resolvedAt: Date.now() });
    await audit(ctx, user.projectId, user.name, "resolve_message", `id=${args.id} from=${msg.from} -> ${args.status}`);
    return { id: args.id, status: args.status };
  },
});

// ---------- audit ----------

export const getAuditLog = query({
  args: { apiKey: v.string(), limit: v.optional(v.number()) },
  returns: v.array(
    v.object({ actor: v.string(), action: v.string(), details: v.string(), createdAt: v.number() }),
  ),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.apiKey);
    const limit = Math.min(args.limit ?? 50, 200);
    const entries = await ctx.db
      .query("audit_log")
      .withIndex("by_project", (q) => q.eq("projectId", user.projectId))
      .order("desc")
      .take(limit);
    return entries.map((e) => ({ actor: e.actor, action: e.action, details: e.details, createdAt: e.createdAt }));
  },
});
