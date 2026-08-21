/**
 * wait-queued.test.ts — a QUEUED background agent, once the concurrency queue
 * drains and it runs, delivers its full result via the completion notification
 * (get_subagent_result no longer exists; the notification is the delivery
 * channel and must not report a still-running/empty result).
 *
 * Wiring test through the REAL extension: spawn background agents until one
 * queues, drain the queue, and assert the queued agent's notification carries
 * the final result.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/agent-runner.js", async () => {
  const actual = await vi.importActual<typeof import("../src/agent-runner.js")>("../src/agent-runner.js");
  return { ...actual, runAgent: vi.fn() };
});

import { runAgent } from "../src/agent-runner.js";
import subagentsExtension from "../src/index.js";

function makePi() {
  const tools = new Map<string, any>();
  const lifecycle = new Map<string, any>();
  const notifications: any[] = [];
  const pi = {
    registerMessageRenderer: vi.fn(),
    registerTool: vi.fn((t: any) => tools.set(t.name, t)),
    registerCommand: vi.fn(),
    on: vi.fn((event: string, handler: any) => lifecycle.set(event, handler)),
    events: {
      emit: vi.fn(),
      on: vi.fn(() => vi.fn()),
    },
    appendEntry: vi.fn(),
    sendMessage: vi.fn((m: any) => notifications.push(m)),
  } as any;
  return { pi, tools, lifecycle, notifications };
}

function ctx() {
  return {
    hasUI: false,
    ui: { setStatus: vi.fn(), setWidget: vi.fn(), notify: vi.fn() },
    cwd: process.cwd(),
    model: undefined,
    modelRegistry: { find: vi.fn(), getAvailable: vi.fn(() => []) },
    sessionManager: { getSessionId: vi.fn(() => "s1"), getBranch: vi.fn(() => []) },
    getSystemPrompt: vi.fn(() => "parent"),
  } as any;
}

const textOf = (r: any): string => r.content[0].text;
const flush = async () => {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
};

/** runAgent mock where each call blocks until we resolve it manually. */
function deferredRuns() {
  const resolvers: Array<(v: any) => void> = [];
  vi.mocked(runAgent).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvers.push(() =>
          resolve({
            responseText: "THE-RESULT-PAYLOAD",
            session: { dispose: vi.fn() } as any,
            aborted: false,
            steered: false,
          }),
        );
      }) as any,
  );
  return resolvers;
}

async function spawnBackground(tools: Map<string, any>): Promise<{ id: string; queued: boolean }> {
  const r = await tools.get("Agent").execute(
    "tc-spawn",
    { prompt: "go", description: "queued-wait test agent", subagent_type: "general-purpose", run_in_background: true },
    undefined,
    undefined,
    ctx(),
  );
  const id = /Agent ID: (\S+)/.exec(textOf(r))![1];
  return { id, queued: textOf(r).includes("queued in background") };
}

describe("a queued background agent delivers its full result when the queue drains", () => {
  it("completes and notifies with the final result (no 'still running')", async () => {
    const { pi, tools, lifecycle, notifications } = makePi();
    subagentsExtension(pi);

    const resolvers = deferredRuns();

    // Spawn until one lands in the queue (concurrency limit is config-dependent).
    let queuedId: string | undefined;
    for (let i = 0; i < 10 && !queuedId; i++) {
      const { id, queued } = await spawnBackground(tools);
      if (queued) queuedId = id;
    }
    expect(queuedId, "expected to hit the concurrency limit within 10 spawns").toBeDefined();

    // Drain: resolve running agents until the queued one starts and finishes.
    let settled = false;
    const drain = () => {
      while (resolvers.length > 0) resolvers.shift()!();
    };
    for (let i = 0; i < 40 && !settled; i++) {
      drain();
      await flush();
      await new Promise((r) => setTimeout(r, 100)); // outlive one 250ms poll tick
      const note = notifications.map((m) => m.content).join("\n");
      if (note.includes(queuedId!) && note.includes("THE-RESULT-PAYLOAD")) settled = true;
    }

    const note = notifications.map((m) => m.content).join("\n");
    expect(note).toContain("THE-RESULT-PAYLOAD");
    expect(note).not.toContain("still running");

    await lifecycle.get("session_shutdown")?.();
  }, 20_000);
});
