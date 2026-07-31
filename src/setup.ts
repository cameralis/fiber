import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { decodeInvite, encodeInvite, fiberDir, loadCreds, saveCreds } from "./common.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      flags[args[i].slice(2)] = args[i + 1] ?? "";
      i++;
    }
  }
  return flags;
}

function convexBin(): { command: string; baseArgs: string[] } {
  const local = join(packageRoot, "node_modules", ".bin", "convex");
  if (existsSync(local)) return { command: local, baseArgs: [] };
  return { command: "npx", baseArgs: ["-y", "convex"] };
}

/**
 * Deploy the bundled Convex functions from a persistent copy of the backend in
 * ~/.fiber/backend, so the deployment config outlives pnpm-dlx's ephemeral store.
 * Returns the deployment URL.
 */
function deployBackend(): string {
  const backendDir = join(fiberDir(), "backend");
  mkdirSync(backendDir, { recursive: true });
  cpSync(join(packageRoot, "convex"), join(backendDir, "convex"), { recursive: true });
  const pkgJson = join(backendDir, "package.json");
  if (!existsSync(pkgJson)) {
    writeFileSync(pkgJson, JSON.stringify({ name: "fiber-backend", version: "0.0.0" }, null, 2));
  }
  const { command, baseArgs } = convexBin();
  console.error("fiber: deploying the shared backend to Convex (one-time)…");
  const result = spawnSync(command, [...baseArgs, "dev", "--once"], {
    cwd: backendDir,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("Convex deployment failed. Run `npx convex login` and retry `fiber setup`.");
  }
  const envLocal = readFileSync(join(backendDir, ".env.local"), "utf8");
  const match = envLocal.match(/^CONVEX_URL=(\S+)/m);
  if (!match) throw new Error("Could not determine CONVEX_URL from .env.local");
  return match[1];
}

function hashPin(pin: string): { pinHash: string; pinSalt: string } {
  const pinSalt = randomBytes(16).toString("hex");
  const pinHash = createHash("sha256").update(`${pinSalt}:${pin}`).digest("hex");
  return { pinHash, pinSalt };
}

function requirePin(flags: Record<string, string>): string {
  const pin = flags.pin;
  if (!pin || !/^\d{4,8}$/.test(pin)) {
    throw new Error(
      "An approval PIN is required: pass --pin <4-8 digits>. You will type it on the fiber approvals page (Claude app) to approve incoming messages — never type it into a Claude conversation.",
    );
  }
  return pin;
}

function connectorUrl(deploymentUrl: string, secret: string): string {
  return `${deploymentUrl.replace(".convex.cloud", ".convex.site")}/mcp/${secret}`;
}

function printApprovalSetup(deploymentUrl: string, secret: string): void {
  console.log("");
  console.log("Approvals (one-time phone setup):");
  console.log("  1. On claude.ai → Settings → Connectors → Add custom connector,");
  console.log('     name it exactly "fiber" and paste this URL (keep it secret, like a password):');
  console.log(`       ${connectorUrl(deploymentUrl, secret)}`);
  console.log("     Do NOT enable this connector in coding sessions — it is only for the approvals page.");
  console.log("  2. Run `fiber approvals-page` and publish the generated page as a Claude artifact");
  console.log("     (ask Claude: \"publish fiber-approvals.html as an artifact with the fiber mcp capability\").");
  console.log("  3. Open that artifact in the Claude app to approve/decline incoming messages with your PIN.");
}

export async function setup(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const userName = flags.name ?? userInfo().username;
  const pin = requirePin(flags);

  if (flags.join) {
    const { url, code } = decodeInvite(flags.join);
    const client = new ConvexHttpClient(url);
    const result = (await client.mutation(anyApi.fiber.joinProject, {
      inviteCode: code,
      userName,
      ...hashPin(pin),
    })) as { apiKey: string; connectorSecret: string };
    const path = saveCreds({ url, apiKey: result.apiKey, user: userName, project: "" });
    console.log(`fiber: joined as "${userName}". Credentials saved to ${path} (never commit them).`);
    console.log("Next: pull the shared repo — it already contains the fiber config bundle.");
    printApprovalSetup(url, result.connectorSecret);
    return;
  }

  const projectName = flags.project ?? "shared";
  const url = flags.url ?? deployBackend();
  const client = new ConvexHttpClient(url);
  const result = (await client.mutation(anyApi.fiber.createProject, {
    projectName,
    userName,
    ...hashPin(pin),
  })) as { apiKey: string; inviteCode: string; connectorSecret: string };
  const path = saveCreds({ url, apiKey: result.apiKey, user: userName, project: projectName });
  const invite = encodeInvite(url, result.inviteCode);
  console.log(`fiber: project "${projectName}" provisioned at ${url}`);
  console.log(`fiber: you are "${userName}". Credentials saved to ${path} (never commit them).`);
  console.log("");
  console.log("Send this one-time invite key to your collaborator:");
  console.log(`  ${invite}`);
  console.log("They run:  fiber setup --join <invite-key> --pin <their-own-pin>");
  console.log("Then run `fiber init` in the shared project repo and commit the generated files.");
  printApprovalSetup(url, result.connectorSecret);
}

export async function invite(): Promise<void> {
  const creds = loadCreds();
  if (!creds) throw new Error("No fiber credentials. Run `fiber setup` first.");
  const client = new ConvexHttpClient(creds.url);
  const result = (await client.mutation(anyApi.fiber.createInvite, { apiKey: creds.apiKey })) as {
    inviteCode: string;
  };
  console.log(encodeInvite(creds.url, result.inviteCode));
}
