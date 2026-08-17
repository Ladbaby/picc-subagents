/**
 * subagent-env.ts — Environment-driven subagent defaults.
 *
 * Mirrors claude-code's `CLAUDE_CODE_SUBAGENT_MODEL` hook for picking the
 * default subagent model. When set, the env var overrides:
 *   - frontmatter `model:` pins on the agent config
 *   - `model:` parameters supplied to the `Agent` tool by the orchestrator
 *   - the parent thread's model (i.e. "inherit")
 *
 * Precedence: PI_SUBAGENT_MODEL (fork-specific) > CLAUDE_CODE_SUBAGENT_MODEL
 * (claude-code-compatible) > undefined (caller falls through to existing
 * resolution in `agent-runner.ts` / `index.ts`).
 */

export const PI_SUBAGENT_MODEL_ENV = "PI_SUBAGENT_MODEL";
export const CLAUDE_CODE_SUBAGENT_MODEL_ENV = "CLAUDE_CODE_SUBAGENT_MODEL";

/**
 * Pick the env-driven default subagent model.
 *
 * Returns the raw env-var string — the caller is responsible for resolving it
 * against the model registry. Resolution errors are surfaced by the caller;
 * we intentionally do NOT silently fall back to the parent model, because
 * setting this env var is treated as an explicit user choice (matching
 * claude-code's behavior).
 *
 * @returns The env-var value, or `undefined` when neither is set.
 */
export function pickSubagentEnvModel(): string | undefined {
  const pi = process.env[PI_SUBAGENT_MODEL_ENV];
  if (pi && pi.trim().length > 0) return pi.trim();

  const claude = process.env[CLAUDE_CODE_SUBAGENT_MODEL_ENV];
  if (claude && claude.trim().length > 0) return claude.trim();

  return undefined;
}

/**
 * Whether the resolved model came from an env var (PI_SUBAGENT_MODEL or
 * CLAUDE_CODE_SUBAGENT_MODEL). Useful for display-labeling and for skipping
 * scope-validation against the user's `enabledModels` allowlist, since the
 * user explicitly asked for this model via environment.
 *
 * The check is by value-equality with what `pickSubagentEnvModel()` returned,
 * so callers can compare strings without leaking env names into log output.
 */
export function isEnvSourcedModel(rawInput: string | undefined): boolean {
  if (!rawInput) return false;
  return rawInput === process.env[PI_SUBAGENT_MODEL_ENV]?.trim()
    || rawInput === process.env[CLAUDE_CODE_SUBAGENT_MODEL_ENV]?.trim();
}
