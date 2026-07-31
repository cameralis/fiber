import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

// MCP (streamable HTTP, stateless) endpoint for the claude.ai custom
// connector. URL shape: https://<deployment>.convex.site/mcp/<connectorSecret>
// The secret identifies + authenticates the approving human; it lives only in
// the claude.ai connector config, never in any agent context or repo.
//
// Tap-to-approve path: approvals artifact page -> claude.ai connector proxy ->
// this endpoint. No LLM anywhere in between.

const PROTOCOL_VERSION = "2025-03-26";

const TOOLS = [
  {
    name: "list_pending",
    description:
      "List messages awaiting the human's approval (full text) plus recently resolved ones.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "approve",
    description: "Approve a pending message. Requires the approval PIN.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, pin: { type: "string" } },
      required: ["id", "pin"],
      additionalProperties: false,
    },
  },
  {
    name: "decline",
    description: "Decline a pending message. Requires the approval PIN.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, pin: { type: "string" } },
      required: ["id", "pin"],
      additionalProperties: false,
    },
  },
];

function rpcResult(id: unknown, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function rpcError(id: unknown, code: number, message: string): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function toolResult(id: unknown, data: unknown, isError = false): Response {
  return rpcResult(id, {
    content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data) }],
    structuredContent: typeof data === "string" ? undefined : data,
    isError,
  });
}

const mcpHandler = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const secret = url.pathname.replace(/^\/mcp\//, "").replace(/\/$/, "");
  if (request.method === "GET") {
    // No server-initiated stream support (stateless server).
    return new Response(null, { status: 405 });
  }
  if (request.method === "DELETE") {
    return new Response(null, { status: 200 });
  }
  let rpc: any;
  try {
    rpc = await request.json();
  } catch {
    return rpcError(null, -32700, "Parse error");
  }
  const { id, method, params } = rpc;

  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "fiber-approvals", version: "0.1.0" },
    });
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return new Response(null, { status: 202 });
  }
  if (method === "ping") {
    return rpcResult(id, {});
  }
  if (method === "tools/list") {
    return rpcResult(id, { tools: TOOLS });
  }
  if (method === "tools/call") {
    const tool = params?.name;
    const args = params?.arguments ?? {};
    if (tool === "list_pending") {
      const result = await ctx.runQuery(internal.approvals.listPending, {
        connectorSecret: secret,
      });
      if (result === null) return toolResult(id, "Invalid connector URL", true);
      return toolResult(id, result);
    }
    if (tool === "approve" || tool === "decline") {
      if (typeof args.id !== "string" || typeof args.pin !== "string") {
        return toolResult(id, "Missing id or pin", true);
      }
      const result = await ctx.runMutation(internal.approvals.decide, {
        connectorSecret: secret,
        messageId: args.id,
        pin: args.pin,
        decision: tool === "approve" ? "approved" : "declined",
      });
      return toolResult(id, result.message, !result.ok);
    }
    return toolResult(id, `Unknown tool: ${tool}`, true);
  }
  return rpcError(id, -32601, `Method not found: ${method}`);
});

const http = httpRouter();
http.route({ pathPrefix: "/mcp/", method: "POST", handler: mcpHandler });
http.route({ pathPrefix: "/mcp/", method: "GET", handler: mcpHandler });
http.route({ pathPrefix: "/mcp/", method: "DELETE", handler: mcpHandler });
export default http;
