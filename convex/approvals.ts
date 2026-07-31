import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { sha256Hex } from "./sha256";

const MAX_PIN_FAILURES = 5;
const LOCKOUT_MS = 5 * 60 * 1000;

// The human-facing view: full bodies, because the human reading the actual
// message text on their phone IS the security check.
export const listPending = internalQuery({
  args: { connectorSecret: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      user: v.string(),
      pending: v.array(
        v.object({
          id: v.id("messages"),
          from: v.string(),
          body: v.string(),
          createdAt: v.number(),
        }),
      ),
      recent: v.array(
        v.object({
          id: v.id("messages"),
          from: v.string(),
          status: v.string(),
          createdAt: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_connectorSecret", (q) => q.eq("connectorSecret", args.connectorSecret))
      .unique();
    if (!user) return null;
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_project_to", (q) => q.eq("projectId", user.projectId).eq("to", user.name))
      .order("desc")
      .take(50);
    return {
      user: user.name,
      pending: messages
        .filter((m) => m.status === "unread")
        .map((m) => ({ id: m._id, from: m.from, body: m.body, createdAt: m.createdAt })),
      recent: messages
        .filter((m) => m.status !== "unread")
        .slice(0, 10)
        .map((m) => ({ id: m._id, from: m.from, status: m.status, createdAt: m.createdAt })),
    };
  },
});

export const decide = internalMutation({
  args: {
    connectorSecret: v.string(),
    messageId: v.string(),
    pin: v.string(),
    decision: v.union(v.literal("approved"), v.literal("declined")),
  },
  returns: v.object({ ok: v.boolean(), message: v.string() }),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_connectorSecret", (q) => q.eq("connectorSecret", args.connectorSecret))
      .unique();
    if (!user) return { ok: false, message: "Invalid connector URL" };
    const now = Date.now();
    if (user.pinLockedUntil && user.pinLockedUntil > now) {
      const mins = Math.ceil((user.pinLockedUntil - now) / 60000);
      return { ok: false, message: `Too many wrong PINs — locked for ${mins} more minute(s)` };
    }
    if (!user.pinHash || !user.pinSalt) {
      return { ok: false, message: "No PIN configured for this user — re-run fiber setup" };
    }
    if (sha256Hex(`${user.pinSalt}:${args.pin}`) !== user.pinHash) {
      const failures = (user.pinFailures ?? 0) + 1;
      const locked = failures >= MAX_PIN_FAILURES;
      await ctx.db.patch(user._id, {
        pinFailures: locked ? 0 : failures,
        pinLockedUntil: locked ? now + LOCKOUT_MS : undefined,
      });
      await ctx.db.insert("audit_log", {
        projectId: user.projectId,
        actor: user.name,
        action: "pin_failure",
        details: locked ? "locked out 5 minutes" : `attempt ${failures}/${MAX_PIN_FAILURES}`,
        createdAt: now,
      });
      return { ok: false, message: locked ? "Wrong PIN — locked for 5 minutes" : "Wrong PIN" };
    }
    const msgId = ctx.db.normalizeId("messages", args.messageId);
    const msg = msgId ? await ctx.db.get(msgId) : null;
    if (!msg || msg.projectId !== user.projectId || msg.to !== user.name) {
      return { ok: false, message: "Message not found" };
    }
    if (msg.status !== "unread") {
      return { ok: false, message: `Message is already "${msg.status}"` };
    }
    await ctx.db.patch(msg._id, { status: args.decision, resolvedAt: now });
    await ctx.db.patch(user._id, { pinFailures: 0 });
    await ctx.db.insert("audit_log", {
      projectId: user.projectId,
      actor: user.name,
      action: `${args.decision}_via_phone`,
      details: `id=${msg._id} from=${msg.from}`,
      createdAt: now,
    });
    return { ok: true, message: `Message from ${msg.from} ${args.decision}` };
  },
});
