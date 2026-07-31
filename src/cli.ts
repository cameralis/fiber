#!/usr/bin/env node
import { runMcp } from "./mcp.js";
import { setup, invite } from "./setup.js";
import { init } from "./init.js";
import { hookSessionStart, hookStop } from "./hooks.js";
import { approvalsPage } from "./approvalsPage.js";

const HELP = `fiber — shared context + agent-to-agent coordination for Claude Code

Usage:
  fiber setup --pin <4-8 digits> [--name <you>] [--project <name>]
                                                  provision the shared backend, print an invite key
  fiber setup --join <invite-key> --pin <digits>  join a friend's fiber project
  fiber init                                      drop the project config bundle (.mcp.json, hooks, CLAUDE.md) into the current repo
  fiber mcp                                       run the MCP server (used by .mcp.json)
  fiber invite                                    print a fresh one-time invite key
  fiber approvals-page                            write the approvals page (publish as a claude.ai artifact)
  fiber hook session-start|stop                   internal: Claude Code hook entry points
`;

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "mcp":
      await runMcp();
      break;
    case "setup":
      await setup(rest);
      break;
    case "init":
      await init(rest);
      break;
    case "invite":
      await invite();
      break;
    case "approvals-page":
      await approvalsPage();
      break;
    case "hook":
      if (rest[0] === "session-start") await hookSessionStart();
      else if (rest[0] === "stop") await hookStop();
      else {
        console.error(`Unknown hook: ${rest[0]}`);
        process.exit(1);
      }
      break;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      break;
    default:
      console.error(`Unknown command: ${cmd}\n\n${HELP}`);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(`fiber: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
