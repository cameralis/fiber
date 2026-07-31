# fiber

Shared context + agent-to-agent coordination for two (or more) Claude Code instances working on one project. Each user's Claude automatically knows what the other's Claude did, and can send bounded requests to the other agent — nothing ever executes without the receiving human's approval.

One small npm package: MCP server + 3-command CLI, backed by a hosted Convex deployment (free tier). No daemon, no self-hosted server, no UI.

## Install

Get the `fiber` binary on PATH — from source: `pnpm install && pnpm build && pnpm link --global` in this repo (or `pnpm add -g fiber-mcp` once published; the npm name `fiber` belongs to an unrelated package).

**First user:**

```sh
fiber setup --pin <4-8 digits>  # provisions the shared backend, prints an invite key + your connector URL
cd your-shared-repo
fiber init                      # drops .mcp.json, .claude/settings.json, CLAUDE.md guidance
git add .mcp.json .claude/settings.json CLAUDE.md && git commit
```

**Second user:**

```sh
fiber setup --join <invite-key> --pin <own-pin>
git pull                        # the committed bundle enables fiber automatically
```

Each user then adds their printed connector URL on claude.ai (Settings → Connectors, name it exactly `fiber`) and publishes their approvals page (`fiber approvals-page`) as a private artifact — that page, opened in the Claude app, is where incoming messages are approved with the PIN.

Per-user credentials live in `~/.fiber/credentials.json` — never in the repo.

## What you get

- **Shared blackboard** — `post_update`, `get_updates`, `search_context`. Kind-tagged (decision / interface-change / gotcha / question), size-capped digests, 30-day auto-archive (search still reaches archives).
- **Claims** — `claim` / `release` / `list_claims` with TTL, so you don't step on each other.
- **Agent-to-agent messaging** — `send_message`, `read_inbox`, `resolve_message`. Every incoming message lands in the inbox and is executed **only after the receiving user reads it and approves**.
- **Automation** — a `SessionStart` hook injects unread inbox + updates since your last session; a `Stop` hook prompts a one-time session digest. All config is project-scoped (committed to the repo) — fiber is invisible in every other project.

## Security model

- Nothing executes automatically; the human reading the actual message text is the security check. There is deliberately no automated message-scanning step (a checker model is itself injectable).
- Sender identity is authenticated per-user via bearer keys; an append-only audit log records every action, reviewable by both users.
- Config-only hardening: deny rules for `~/.ssh`, keychain, and `.env` files ship in the bundle, and an outbound regex tripwire blocks updates/messages containing secret-shaped content.
- Summaries only, never transcripts.

## Commands

| Command | Purpose |
|---|---|
| `fiber setup [--join <key>]` | Provision the shared backend / join a friend's project |
| `fiber init` | Drop the project config bundle into the current repo |
| `fiber mcp` | Run the MCP server (referenced by `.mcp.json`) |
| `fiber invite` | Print a fresh one-time invite key |
