import { describe, expect, it } from "vitest";
import { resolveAgentInvocationConfig, resolveJoinMode } from "../src/invocation-config.js";
import type { AgentConfig } from "../src/types.js";

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: "Explore",
    description: "Explore",
    builtinToolNames: ["read"],
    extensions: false,
    skills: false,
    systemPrompt: "Test agent",
    promptMode: "replace",
    inheritContext: false,
    runInBackground: false,
    isolated: false,
    ...overrides,
  };
}

describe("resolveAgentInvocationConfig", () => {
  it("prefers agent config for model; removed params no longer affect thinking/turns/isolated", () => {
    const resolved = resolveAgentInvocationConfig(
      makeConfig({
        model: "provider/config-model",
        thinking: "high",
        maxTurns: 42,
        inheritContext: false,
        runInBackground: false,
        isolated: false,
        isolation: "worktree",
      }),
      {
        model: "provider/param-model",
        run_in_background: true,
        isolation: "worktree",
      },
    );

    expect(resolved.modelInput).toBe("provider/config-model");
    expect(resolved.modelFromParams).toBe(false);
    // Frontmatter-driven knobs (not per-call params anymore).
    expect(resolved.thinking).toBe("high");
    expect(resolved.maxTurns).toBe(42);
    expect(resolved.inheritContext).toBe(false);
    // runInBackground: config wins over the (still-allowed) param.
    expect(resolved.runInBackground).toBe(false);
    expect(resolved.isolated).toBe(false);
    expect(resolved.isolation).toBe("worktree");
  });

  it("uses tool-call model param when no agent config is available", () => {
    const resolved = resolveAgentInvocationConfig(undefined, {
      model: "provider/param-model",
      run_in_background: true,
      isolation: "worktree",
    });

    expect(resolved.modelInput).toBe("provider/param-model");
    expect(resolved.modelFromParams).toBe(true);
    // No frontmatter → frontmatter-driven knobs fall back to defaults.
    expect(resolved.thinking).toBeUndefined();
    expect(resolved.maxTurns).toBeUndefined();
    expect(resolved.inheritContext).toBe(false);
    expect(resolved.runInBackground).toBe(true);
    expect(resolved.isolated).toBe(false);
    expect(resolved.isolation).toBe("worktree");
  });

  it("lets the param fill runInBackground when config leaves it undefined", () => {
    const resolved = resolveAgentInvocationConfig(
      makeConfig({
        runInBackground: undefined,
      }),
      {
        run_in_background: true,
      },
    );

    expect(resolved.runInBackground).toBe(true);
  });

  it("defaults booleans to false when neither config nor params set them", () => {
    const resolved = resolveAgentInvocationConfig(
      makeConfig({
        runInBackground: undefined,
        isolated: undefined,
      }),
      {},
    );

    expect(resolved.inheritContext).toBe(false);
    expect(resolved.runInBackground).toBe(false);
    expect(resolved.isolated).toBe(false);
  });
});

describe("resolveJoinMode", () => {
  it("returns the global default for background agents", () => {
    expect(resolveJoinMode("smart", true)).toBe("smart");
    expect(resolveJoinMode("async", true)).toBe("async");
  });

  it("ignores join mode for foreground agents", () => {
    expect(resolveJoinMode("smart", false)).toBeUndefined();
    expect(resolveJoinMode("group", false)).toBeUndefined();
  });
});
