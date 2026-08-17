/**
 * agent-index-env-model.test.ts
 *
 * Verifies the env-var hook in the `Agent`-tool handler:
 *   - PI_SUBAGENT_MODEL / CLAUDE_CODE_SUBAGENT_MODEL override frontmatter `model:`
 *     and `Agent({model: ...})` params.
 *   - Unresolvable env var surfaces a tool error (no silent fallback to parent).
 *   - When neither is set, the existing precedence (caller > config > parent)
 *     still applies.
 *
 * Drives a fake ExtensionAPI → real `defaultExtension` → real `Agent` tool, with
 * `runAgent` mocked so we only exercise the resolution/spawn path.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/agent-runner.js", async () => {
  const actual = await vi.importActual<typeof import("../src/agent-runner.js")>("../src/agent-runner.js");
  return { ...actual, runAgent: vi.fn() };
});

import { runAgent } from "../src/agent-runner.js";
import subagentsExtension from "../src/index.js";
import { CLAUDE_CODE_SUBAGENT_MODEL_ENV, PI_SUBAGENT_MODEL_ENV } from "../src/subagent-env.js";

function makePi() {
  const tools = new Map<string, any>();
  const lifecycle = new Map<string, any>();
  return {
    pi: {
      registerMessageRenderer: vi.fn(),
      registerTool: vi.fn((t: any) => tools.set(t.name, t)),
      registerCommand: vi.fn(),
      on: vi.fn((event: string, handler: any) => lifecycle.set(event, handler)),
      events: { emit: vi.fn(), on: vi.fn(() => vi.fn()) },
      appendEntry: vi.fn(),
      sendMessage: vi.fn(),
    } as any,
    tools,
    lifecycle,
  };
}

const HAIKU = { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "anthropic" };
const SONNET = { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic" };
const OPUS = { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "anthropic" };
const PARENT_OPUS = OPUS;

function makeRegistry(available: any[]) {
  return {
    find: (provider: string, modelId: string) => available.find(m => m.provider === provider && m.id === modelId),
    getAvailable: () => available,
    getAll: () => available,
  };
}

function ctxWith(parentModel: any, registry: any) {
  return {
    hasUI: false,
    ui: { setStatus: vi.fn(), setWidget: vi.fn(), notify: vi.fn() },
    cwd: process.cwd(),
    model: parentModel,
    modelRegistry: registry,
    sessionManager: { getSessionId: vi.fn(() => "s-env"), getBranch: vi.fn(() => []) },
    getSystemPrompt: vi.fn(() => "parent system prompt"),
  } as any;
}

const textOf = (r: any): string => r.content[0].text;
const flush = async () => {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
};

interface Harness {
  tmpDir: string;
  agentDir: string;
  tools: Map<string, any>;
  prevCwd: string;
  prevAgentDir: string | undefined;
}

async function setupHarness(): Promise<Harness> {
  const tmpDir = mkdtempSync(join(tmpdir(), "pi-envmodel-"));
  const agentDir = mkdtempSync(join(tmpdir(), "pi-envmodel-agentdir-"));
  const prevCwd = process.cwd();
  const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.HOME = agentDir;
  mkdirSync(join(tmpDir, ".pi"), { recursive: true });
  // Disable scheduling so we don't spin a scheduler in tests.
  writeFileSync(join(tmpDir, ".pi", "subagents.json"), JSON.stringify({ schedulingEnabled: false }));
  process.chdir(tmpDir);

  const { tools, lifecycle, pi } = makePi();
  // Load the real extension against the hermetic cwd.
  await subagentsExtension(pi as any);
  // Fire session_start so the extension is fully initialized.
  const sessionStart = lifecycle.get("session_start");
  expect(sessionStart, "extension must register session_start").toBeTruthy();
  await sessionStart({} as any, {} as any);

  return { tmpDir, agentDir, tools, prevCwd, prevAgentDir };
}

function teardownHarness(h: Harness) {
  process.chdir(h.prevCwd);
  if (h.prevAgentDir == null) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = h.prevAgentDir;
  rmSync(h.tmpDir, { recursive: true, force: true });
  rmSync(h.agentDir, { recursive: true, force: true });
}

describe("Agent-tool: PI_SUBAGENT_MODEL / CLAUDE_CODE_SUBAGENT_MODEL override", () => {
  let harness: Harness;
  let prevAgent: string | undefined;
  let prevClaude: string | undefined;

  beforeEach(async () => {
    harness = await setupHarness();
    prevAgent = process.env[PI_SUBAGENT_MODEL_ENV];
    prevClaude = process.env[CLAUDE_CODE_SUBAGENT_MODEL_ENV];
    delete process.env[PI_SUBAGENT_MODEL_ENV];
    delete process.env[CLAUDE_CODE_SUBAGENT_MODEL_ENV];
  });

  afterEach(() => {
    if (prevAgent === undefined) delete process.env[PI_SUBAGENT_MODEL_ENV];
    else process.env[PI_SUBAGENT_MODEL_ENV] = prevAgent;
    if (prevClaude === undefined) delete process.env[CLAUDE_CODE_SUBAGENT_MODEL_ENV];
    else process.env[CLAUDE_CODE_SUBAGENT_MODEL_ENV] = prevClaude;
    teardownHarness(harness);
  });

  it("PI_SUBAGENT_MODEL overrides parent and frontmatter (haiku chosen)", async () => {
    process.env[PI_SUBAGENT_MODEL_ENV] = "haiku";
    vi.mocked(runAgent).mockReset();
    vi.mocked(runAgent).mockResolvedValue({
      responseText: "ok",
      session: { dispose: vi.fn() } as any,
      aborted: false,
      steered: false,
    });

    const registry = makeRegistry([HAIKU, SONNET, PARENT_OPUS]);
    // General-purpose frontmatter pins nothing → without env would inherit OPUS.
    const result = await harness.tools.get("Agent").execute(
      "tc-1",
      { prompt: "go", description: "Do a thing", subagent_type: "general-purpose", run_in_background: true },
      undefined,
      undefined,
      ctxWith(PARENT_OPUS, registry),
    );
    const id = textOf(result).match(/Agent ID: (\S+)/)?.[1];
    expect(id).toBeTruthy();
    await flush();

    const call = vi.mocked(runAgent).mock.calls[0];
    const passedModel = call[3]?.model; // RunOptions.model is the 4th positional arg
    expect(passedModel?.id).toBe(HAIKU.id);
    expect(passedModel?.provider).toBe(HAIKU.provider);
  });

  it("CLAUDE_CODE_SUBAGENT_MODEL applies when PI_SUBAGENT_MODEL is unset", async () => {
    process.env[CLAUDE_CODE_SUBAGENT_MODEL_ENV] = "sonnet";
    vi.mocked(runAgent).mockReset();
    vi.mocked(runAgent).mockResolvedValue({
      responseText: "ok",
      session: { dispose: vi.fn() } as any,
      aborted: false,
      steered: false,
    });

    const registry = makeRegistry([HAIKU, SONNET, PARENT_OPUS]);
    await harness.tools.get("Agent").execute(
      "tc-2",
      { prompt: "go", description: "Sonnet test", subagent_type: "general-purpose", run_in_background: true },
      undefined,
      undefined,
      ctxWith(PARENT_OPUS, registry),
    );
    await flush();
    const call = vi.mocked(runAgent).mock.calls[0];
    expect(call[3]?.model?.id).toBe(SONNET.id);
  });

  it("PI_SUBAGENT_MODEL takes precedence over CLAUDE_CODE_SUBAGENT_MODEL", async () => {
    process.env[PI_SUBAGENT_MODEL_ENV] = "haiku";
    process.env[CLAUDE_CODE_SUBAGENT_MODEL_ENV] = "sonnet";
    vi.mocked(runAgent).mockReset();
    vi.mocked(runAgent).mockResolvedValue({
      responseText: "ok",
      session: { dispose: vi.fn() } as any,
      aborted: false,
      steered: false,
    });

    const registry = makeRegistry([HAIKU, SONNET, PARENT_OPUS]);
    await harness.tools.get("Agent").execute(
      "tc-3",
      { prompt: "go", description: "Precedence", subagent_type: "general-purpose", run_in_background: true },
      undefined,
      undefined,
      ctxWith(PARENT_OPUS, registry),
    );
    await flush();
    const call = vi.mocked(runAgent).mock.calls[0];
    expect(call[3]?.model?.id).toBe(HAIKU.id);
  });

  it("env var overrides caller-supplied Agent({model: ...}) param", async () => {
    process.env[PI_SUBAGENT_MODEL_ENV] = "haiku";
    vi.mocked(runAgent).mockReset();
    vi.mocked(runAgent).mockResolvedValue({
      responseText: "ok",
      session: { dispose: vi.fn() } as any,
      aborted: false,
      steered: false,
    });

    const registry = makeRegistry([HAIKU, SONNET, PARENT_OPUS]);
    const result = await harness.tools.get("Agent").execute(
      "tc-4",
      { prompt: "go", description: "Caller override test", subagent_type: "general-purpose", run_in_background: true, model: "sonnet" },
      undefined,
      undefined,
      ctxWith(PARENT_OPUS, registry),
    );
    await flush();
    expect(textOf(result)).not.toMatch(/Model not found/);
    const call = vi.mocked(runAgent).mock.calls[0];
    expect(call[3]?.model?.id).toBe(HAIKU.id);
  });

  it("unresolvable env var surfaces a tool error (no silent fallback)", async () => {
    process.env[PI_SUBAGENT_MODEL_ENV] = "no-such-model-xyz";
    vi.mocked(runAgent).mockReset();
    const registry = makeRegistry([HAIKU, SONNET, PARENT_OPUS]);
    const result = await harness.tools.get("Agent").execute(
      "tc-5",
      { prompt: "go", description: "Bad env", subagent_type: "general-purpose", run_in_background: true },
      undefined,
      undefined,
      ctxWith(PARENT_OPUS, registry),
    );
    expect(textOf(result)).toMatch(/Model not found.*no-such-model-xyz/s);
    expect(vi.mocked(runAgent)).not.toHaveBeenCalled();
  });

  it("without env vars, parent model wins (regression)", async () => {
    vi.mocked(runAgent).mockReset();
    vi.mocked(runAgent).mockResolvedValue({
      responseText: "ok",
      session: { dispose: vi.fn() } as any,
      aborted: false,
      steered: false,
    });

    const registry = makeRegistry([HAIKU, SONNET, PARENT_OPUS]);
    await harness.tools.get("Agent").execute(
      "tc-6",
      { prompt: "go", description: "No-env test", subagent_type: "general-purpose", run_in_background: true },
      undefined,
      undefined,
      ctxWith(PARENT_OPUS, registry),
    );
    await flush();
    const call = vi.mocked(runAgent).mock.calls[0];
    expect(call[3]?.model?.id).toBe(PARENT_OPUS.id);
  });
});
