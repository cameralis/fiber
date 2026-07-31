#!/usr/bin/env node
// Test harness: drives the real `fiber mcp` stdio server exactly like Claude
// Code would. Credentials come from FIBER_URL / FIBER_API_KEY / FIBER_USER env.
//
//   node test/mcp-client.mjs list
//   node test/mcp-client.mjs call <tool> '<json-args>'
//   node test/mcp-client.mjs wait-message --from <name> [--contains <str>] [--timeout <sec>]
//   node test/mcp-client.mjs wait-sent --to <name> --status <status> [--timeout <sec>]

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");
const [cmd, ...rest] = process.argv.slice(2);

function flags(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      out[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return out;
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [cliPath, "mcp"],
  env: { ...process.env },
});
const client = new Client({ name: "fiber-test-harness", version: "0.1.0" });
await client.connect(transport);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callTool(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const texts = (res.content ?? []).filter((c) => c.type === "text").map((c) => c.text);
  return { isError: !!res.isError, texts, last: texts[texts.length - 1] ?? "" };
}

async function readInbox() {
  const { last } = await callTool("read_inbox");
  return JSON.parse(last);
}

try {
  if (cmd === "list") {
    const tools = (await client.listTools()).tools.map((t) => t.name);
    console.log(JSON.stringify(tools, null, 2));
  } else if (cmd === "call") {
    const [tool, json] = rest;
    const res = await callTool(tool, json ? JSON.parse(json) : {});
    console.log(res.texts.join("\n"));
    if (res.isError) process.exitCode = 2;
  } else if (cmd === "wait-message") {
    const f = flags(rest);
    const timeout = Number(f.timeout ?? 180) * 1000;
    const start = Date.now();
    for (;;) {
      const { inbox } = await readInbox();
      const hit = inbox.find(
        (m) =>
          (!f.from || m.from === f.from) &&
          (!f.contains || m.body.includes(f.contains)) &&
          (!f.status || m.status === f.status),
      );
      if (hit) {
        console.log(JSON.stringify(hit, null, 2));
        break;
      }
      if (Date.now() - start > timeout) {
        console.error("wait-message: timed out");
        process.exitCode = 3;
        break;
      }
      await sleep(3000);
    }
  } else if (cmd === "wait-sent") {
    const f = flags(rest);
    const timeout = Number(f.timeout ?? 180) * 1000;
    const start = Date.now();
    for (;;) {
      const { sent } = await readInbox();
      const hit = sent.find((m) => (!f.to || m.to === f.to) && m.status === f.status);
      if (hit) {
        console.log(JSON.stringify(hit, null, 2));
        break;
      }
      if (Date.now() - start > timeout) {
        console.error("wait-sent: timed out");
        process.exitCode = 3;
        break;
      }
      await sleep(3000);
    }
  } else {
    console.error("Unknown command. See header comment for usage.");
    process.exitCode = 1;
  }
} finally {
  await client.close();
}
