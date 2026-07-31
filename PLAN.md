# fiber — Plan

Shared context + agent-to-agent coordination for multiple Claude Code instances working on one project. Built as one complete system in a single push; validated end-to-end afterward.

## Vision

Two (later N) Claude Code users on a shared project stop copy-pasting outputs to each other. Each user's Claude automatically knows what the other's Claude did, and can send bounded requests to the other agent — without creating a remote-code-execution hole.

## Scope — one simple system, built at once

Everything ships together:

1. **Shared blackboard** — updates, search, claims.
2. **Agent-to-agent messaging** — inbox; every incoming message is executed only after the receiving user approves it.
3. **Full automation** — hooks so both Claudes read/write without being asked.

No interim git-journal step. No staged rollout. Build complete → test with both users → fix what testing surfaces.

## Architecture

**Form factor: one small npm package (`fiber`), nothing else to install or run.** It contains the MCP server and a tiny CLI, and is invoked via `pnpm dlx fiber` — no daemon, no listener process, no self-hosted server, no UI.

**Maximal reuse of existing components — fiber only writes the glue:**
- **MCP protocol / `@modelcontextprotocol/sdk`** — the agent interface; Claude Code already speaks it.
- **Convex hosted backend (free tier)** — storage, real-time sync, auth; the Convex functions ship inside the package and deploy with one command. Nobody runs a server.
- **Claude Code native hooks + settings** — automation and deny rules; no custom runtime.
- **Claude Code's normal in-session flow** — inbox approval is just Claude showing you the message and asking; no separate app.

**CLI (three commands):**
- `fiber setup` — run once by one user: provisions the shared Convex backend, prints an invite key for the friend.
- `fiber init` — run in a project repo: drops the config bundle (`.mcp.json`, `.claude/settings.json`, CLAUDE.md snippet) to enable fiber there.
- `fiber mcp` — the MCP server itself; `.mcp.json` points Claude Code at it.

Friend's onboarding: `fiber setup --join <invite-key>`, then pull the repo. Done.

### Data model (Convex)

- `projects` — scoping container; per-user API keys scoped to project.
- `updates` — author, timestamp, topic, summary, kind tag (decision | interface-change | gotcha | question).
- `claims` — task/area claims with TTL, to avoid stepping on each other.
- `messages` — sender, recipient, body, status (unread / approved / running / done / declined), signed per-sender.
- `audit_log` — append-only: every message, every action taken in response.

### MCP tools

- `post_update(topic, kind, summary)`
- `get_updates(since?, topic?)` — compact digest, newest first, size-capped.
- `search_context(query)`
- `claim(area)` / `release(area)` / `list_claims()`
- `send_message(to, body)` / `read_inbox()` / `resolve_message(id, status)`

### Execution security (out-of-band human approval)

- **Approval is server-enforced and out-of-band — agents cannot approve.** Agent bearer keys have no code path to the `approved` status (the backend rejects it). Approval happens only through a PIN-gated endpoint reached from the fiber approvals page: a private claude.ai artifact opened in the Claude app, whose Approve/Decline buttons call the user's "fiber" claude.ai connector directly — no LLM anywhere in the tap-to-approve path. Rationale: both users run bypass-permissions, and conversational/in-session approval is spoofable by an injected agent.
- **Message bodies are hidden from agents until approved.** The recipient's Claude sees only a "pending approval" stub; the (possibly poisoned) payload enters an agent context only after the human read the real text on their phone and approved. The human reading the actual message text IS the security check.
- **PIN + connector secret.** The approval PIN (chosen at `fiber setup`, salted-hashed server-side, 5-attempt lockout) is typed only on the approvals page, never into any Claude conversation. The connector URL secret lives only in the claude.ai connector config. Neither ever enters an agent context.
- **No automated message scanning / harm-checking step.** A checker model that reads the message is itself prompt-injectable — the checker becomes the executor. Rejected by design.
- Sender identity authenticated per-user (bearer keys); append-only audit log (including PIN failures and phone approvals) reviewable by both users.
- Cheap hardening on the executing side (config only): deny rules for `~/.ssh`, keychain, `.env`, and `~/.fiber` in the committed Claude Code settings, plus a regex secret-pattern tripwire on all outbound updates/messages.
- Threat model: primary risk is transitive prompt injection (friend's agent gets injected by web/dependency content and it propagates). Hidden-until-approved bodies keep payloads out of agent contexts pre-approval; the capability split means even a fully injected agent with bypass permissions cannot self-approve; deny rules bound what an approved-but-poisoned request can reach.

### Automation — strictly project-scoped, nothing global

fiber must be invisible outside fiber-enabled projects. Hard rule: **no fiber config in user-level/global settings** (`~/.claude/`). Everything lives in the shared project repo, so it applies only when working in that project:

- `.mcp.json` in the repo — registers the fiber MCP server for this project only.
- `.claude/settings.json` in the repo — hooks + deny rules, active only inside this project:
  - `SessionStart` hook: inject unread inbox + updates-since-last-session.
  - `Stop` hook: post session digest.
- Project `CLAUDE.md` guidance: post after decisions/interface changes; check board before touching shared surfaces.
- Inbox surfacing: incoming messages shown with approve/decline; optional push notification for new messages.
- Enabling fiber on a project = committing this bundle to its repo (a small `fiber init` script can drop the files in). Projects without the bundle are completely untouched — no hooks, no MCP server, zero overhead.
- Committed bundle doubles as the config-sync mechanism: both machines stay identical automatically.

### Noise control

- Hard size caps on updates; digest returns max N items / M tokens.
- Kind tags for filtering; 30-day auto-archive (search still reaches archives).
- No server-side LLM summarization in v1 — revisit only if caps prove insufficient.

### Standing rules

- Summaries only, never transcripts (secrets risk).
- Per-user bearer keys in local env, never in the repo.

## Build order (single push — order of assembly, not staged releases)

1. Convex schema + functions (updates, claims, messages, audit) — inside the package.
2. MCP server wrapping them (`fiber mcp`).
3. CLI: `fiber setup` (provision + invite) and `fiber init` (drop config bundle: hooks, CLAUDE.md guidance, deny rules).
4. Inbox surfacing + approve/decline flow + outbound secret tripwire.
5. Publish to npm; install path is `pnpm dlx fiber` everywhere.

## Test plan (after the build)

- Both users install; run real work sessions for ~2 weeks.
- Verify: tools used unprompted at the right moments; digests actionable; inbox requests surfaced, approved/declined, and resolved; nothing ever executes without approval.
- Red-team pass: attempt exfiltration via crafted messages (SSH keys, .env) — must be blocked by deny rules even when the message is approved; confirm no path executes a message pre-approval.
- Fix list from testing → iterate.

## Key risks

| Risk | Response |
|---|---|
| Claude won't use tools unprompted | Surfaces in the test period; tune hooks/CLAUDE.md then |
| Context noise makes reading cost > value | Size caps, tags, retention |
| Anthropic ships native team/session sharing | Keep scope personal-tool-sized |
| Secrets leak through shared channel | Summaries-only rule, sandboxed executor, outbound scanning, red-team test |
| Two-person config drift | Config bundle in repo; server warns if one side silent > X days |

## Changelog

- 2026-07-31: **Approval moved out-of-band (user direction: bypass-permissions is always on, conversational approval is spoofable).** Removed the agent-key `approved` transition server-side; added PIN-gated approvals (salted hash, 5-try lockout) via an MCP-over-HTTP Convex endpoint addressed by a per-user connector secret; added the fiber approvals artifact page (claude.ai / Claude app) whose Approve/Decline buttons call the connector with no LLM in the path; message bodies now hidden from agents until approved. Tested end-to-end against the cloud deployment incl. red-team (agent approval attempts rejected at both MCP-schema and backend layers, wrong-PIN lockout, forged connector secret). Claude-app-native approval buttons are not offered by the platform; the artifact-page + connector route is the closest fully-enforced equivalent.
- 2026-07-31: Initial plan (phased: experiment gate → git journal → MCP v1 → messaging v2).
- 2026-07-31: **Rewrite per user direction.** Removed phased approach and Phase-0 gate — everything is built at once and tested afterward. Dropped the git-journal option entirely. Single target: full fiber system (blackboard + messaging + two-tier execution + hooks) in one build, followed by a 2-week validation + red-team pass.
- 2026-07-31: **Simplified execution security per user direction.** Replaced the two-tier model (whitelist auto-execute + sandboxed executor) with a single rule: every incoming message requires explicit user approval before Claude executes it — nothing runs automatically. Removed the planned automated harm-scanning of messages (an LLM checker is itself injectable; the checker would become the executor). Kept as cheap config-only hardening: deny rules for ~/.ssh / keychain / .env and the outbound secret tripwire.
- 2026-07-31: **Made project scoping an explicit hard rule** (user concern: hooks must not leak into non-fiber sessions). All fiber config — hooks, deny rules, MCP registration — lives in the shared project repo (`.mcp.json`, `.claude/settings.json`, `CLAUDE.md`), never in user-level/global settings. fiber is opt-in per project via committing the bundle (`fiber init`); non-fiber projects are completely untouched.
- 2026-07-31: **Built and E2E-tested.** Implemented the full package in one push: Convex schema + functions (updates/claims/messages/audit, per-user bearer keys), MCP server with all 9 tools + outbound secret tripwire, CLI (`setup`/`init`/`mcp`/`invite`/`hook`), project-scoped config bundle (SessionStart + Stop hooks, deny rules, CLAUDE.md snippet). Deployed to Convex cloud (`famous-fly-563.eu-west-1.convex.cloud`, team cameralis). Validated with two concurrent agent instances communicating through the cloud backend: 19/19 scripted steps passed incl. red-team checks (tripwire blocks AWS-key/private-key exfil, invalid state transitions rejected, forged API key rejected, claim conflicts enforced, approval notice always shown). Not yet published to npm (name availability undecided).
- 2026-07-31: **Pinned the form factor: one small npm package** (user direction: small, simple, easily installable, reuse existing components). Single package = MCP server + 3-command CLI (`setup` / `init` / `mcp`), run via `pnpm dlx fiber`. Reuses MCP SDK, hosted Convex (functions ship in the package, one-command deploy), and Claude Code's native hooks/settings/approval flow. No daemon, no self-hosted server, no UI. Friend onboards with `fiber setup --join <invite-key>`.
