import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const kindValidator = v.union(
  v.literal("decision"),
  v.literal("interface-change"),
  v.literal("gotcha"),
  v.literal("question"),
);

export const messageStatusValidator = v.union(
  v.literal("unread"),
  v.literal("approved"),
  v.literal("running"),
  v.literal("done"),
  v.literal("declined"),
);

export default defineSchema({
  projects: defineTable({
    name: v.string(),
    createdAt: v.number(),
  }),
  users: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    apiKey: v.string(),
    createdAt: v.number(),
    // Out-of-band approval channel: PIN (salted hash) typed only on the
    // approvals page, and the secret embedded in the claude.ai connector URL.
    // The agent bearer key (apiKey) can NEVER approve — approval requires
    // connectorSecret + PIN, which never enter any agent context.
    pinHash: v.optional(v.string()),
    pinSalt: v.optional(v.string()),
    connectorSecret: v.optional(v.string()),
    pinFailures: v.optional(v.number()),
    pinLockedUntil: v.optional(v.number()),
  })
    .index("by_apiKey", ["apiKey"])
    .index("by_connectorSecret", ["connectorSecret"])
    .index("by_project", ["projectId"]),
  invites: defineTable({
    projectId: v.id("projects"),
    code: v.string(),
    usedBy: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_code", ["code"]),
  updates: defineTable({
    projectId: v.id("projects"),
    author: v.string(),
    topic: v.string(),
    kind: kindValidator,
    summary: v.string(),
    searchText: v.string(),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId", "createdAt"])
    .searchIndex("search_text", {
      searchField: "searchText",
      filterFields: ["projectId"],
    }),
  claims: defineTable({
    projectId: v.id("projects"),
    area: v.string(),
    owner: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_project_area", ["projectId", "area"])
    .index("by_project", ["projectId"]),
  messages: defineTable({
    projectId: v.id("projects"),
    from: v.string(),
    to: v.string(),
    body: v.string(),
    status: messageStatusValidator,
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_project_to", ["projectId", "to", "createdAt"])
    .index("by_project_from", ["projectId", "from", "createdAt"]),
  audit_log: defineTable({
    projectId: v.id("projects"),
    actor: v.string(),
    action: v.string(),
    details: v.string(),
    createdAt: v.number(),
  }).index("by_project", ["projectId", "createdAt"]),
});
