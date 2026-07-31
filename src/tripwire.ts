// Outbound secret tripwire: cheap regex screen applied to everything fiber
// sends to the shared backend (updates, messages). Blocks, never rewrites.

const PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key block"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key id"],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/, "GitHub token"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/, "GitHub fine-grained token"],
  [/\bsk-ant-[A-Za-z0-9_-]{10,}\b/, "Anthropic API key"],
  [/\bsk-[A-Za-z0-9_-]{24,}\b/, "secret key (sk-...)"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, "Slack token"],
  [/\beyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}/, "JWT"],
  [/\bfbr_[a-f0-9]{30,}\b/, "fiber API key"],
  [/(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["']?[A-Za-z0-9_/+-]{12,}/i, "credential assignment"],
];

export function findSecret(text: string): string | null {
  for (const [pattern, label] of PATTERNS) {
    if (pattern.test(text)) return label;
  }
  return null;
}
