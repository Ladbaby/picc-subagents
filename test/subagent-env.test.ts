/**
 * subagent-env.test.ts
 *
 * Verifies the precedence rules:
 *   1. PI_SUBAGENT_MODEL (fork-specific) wins when set
 *   2. CLAUDE_CODE_SUBAGENT_MODEL (claude-code-compatible) is the fallback
 *   3. undefined when neither is set
 *
 * Also verifies whitespace-only values are treated as "unset" so a typo like
 * `PI_SUBAGENT_MODEL=" "` doesn't pin the agent to an unresolvable model.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  CLAUDE_CODE_SUBAGENT_MODEL_ENV,
  isEnvSourcedModel,
  PI_SUBAGENT_MODEL_ENV,
  pickSubagentEnvModel,
} from "../src/subagent-env.js";

describe("pickSubagentEnvModel", () => {
  afterEach(() => {
    delete process.env[PI_SUBAGENT_MODEL_ENV];
    delete process.env[CLAUDE_CODE_SUBAGENT_MODEL_ENV];
  });

  it("returns undefined when neither env var is set", () => {
    expect(pickSubagentEnvModel()).toBeUndefined();
  });

  it("returns PI_SUBAGENT_MODEL when set, ignoring CLAUDE_CODE_SUBAGENT_MODEL", () => {
    process.env[PI_SUBAGENT_MODEL_ENV] = "haiku";
    process.env[CLAUDE_CODE_SUBAGENT_MODEL_ENV] = "sonnet";
    expect(pickSubagentEnvModel()).toBe("haiku");
  });

  it("falls back to CLAUDE_CODE_SUBAGENT_MODEL when PI_SUBAGENT_MODEL is unset", () => {
    process.env[CLAUDE_CODE_SUBAGENT_MODEL_ENV] = "anthropic/claude-haiku-4-5";
    expect(pickSubagentEnvModel()).toBe("anthropic/claude-haiku-4-5");
  });

  it("trims surrounding whitespace from the chosen value", () => {
    process.env[PI_SUBAGENT_MODEL_ENV] = "  haiku  ";
    expect(pickSubagentEnvModel()).toBe("haiku");
  });

  it("treats whitespace-only PI_SUBAGENT_MODEL as unset", () => {
    process.env[PI_SUBAGENT_MODEL_ENV] = "   ";
    process.env[CLAUDE_CODE_SUBAGENT_MODEL_ENV] = "sonnet";
    expect(pickSubagentEnvModel()).toBe("sonnet");
  });

  it("treats whitespace-only CLAUDE_CODE_SUBAGENT_MODEL as unset", () => {
    process.env[CLAUDE_CODE_SUBAGENT_MODEL_ENV] = "\t\n";
    expect(pickSubagentEnvModel()).toBeUndefined();
  });
});

describe("isEnvSourcedModel", () => {
  afterEach(() => {
    delete process.env[PI_SUBAGENT_MODEL_ENV];
    delete process.env[CLAUDE_CODE_SUBAGENT_MODEL_ENV];
  });

  it("returns true for PI_SUBAGENT_MODEL value (trimmed)", () => {
    process.env[PI_SUBAGENT_MODEL_ENV] = "haiku";
    expect(isEnvSourcedModel("haiku")).toBe(true);
  });

  it("returns true for CLAUDE_CODE_SUBAGENT_MODEL value (trimmed)", () => {
    process.env[CLAUDE_CODE_SUBAGENT_MODEL_ENV] = "  sonnet  ";
    expect(isEnvSourcedModel("sonnet")).toBe(true);
  });

  it("returns false for an unrelated string even with env vars set", () => {
    process.env[PI_SUBAGENT_MODEL_ENV] = "haiku";
    expect(isEnvSourcedModel("opus")).toBe(false);
  });

  it("returns false for undefined / empty input", () => {
    expect(isEnvSourcedModel(undefined)).toBe(false);
    expect(isEnvSourcedModel("")).toBe(false);
  });
});
