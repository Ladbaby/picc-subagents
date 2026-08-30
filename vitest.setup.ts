/**
 * vitest.setup.ts — global test hygiene.
 *
 * Clears the env-driven subagent-model overrides before each test file so the
 * suite is hermetic regardless of the developer's shell. Some dev environments
 * export `CLAUDE_CODE_SUBAGENT_MODEL` (or `PI_SUBAGENT_MODEL`), which forces a
 * model override the spawn/wiring tests don't opt into (their mock registries
 * return `[]`), producing spurious "Model not found" failures. The tests that DO
 * exercise these overrides set and restore the vars explicitly, so clearing them
 * here has no effect on those.
 */
import { beforeEach } from "vitest";

const MODEL_OVERRIDES = ["PI_SUBAGENT_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL"];

beforeEach(() => {
  for (const key of MODEL_OVERRIDES) {
    delete process.env[key];
  }
});
