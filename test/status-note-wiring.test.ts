/**
 * status-note-wiring.test.ts — proves the status note actually reaches the
 * PARENT through the real handlers, not just that getStatusNote() returns a
 * string. For a foreground turn-limit abort the note is in the inline tool
 * result; for a background user-stop the note is in the completion notification
 * (get_subagent_result no longer exists — the notification is the delivery
 * channel).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/agent-runner.js", async () => {
  const actual = await vi.importActual<typeof import("../src/agent-runner.js")>("../src/agent-runner.js");
  return { ...actual, runAgent: vi.fn() };
});

import { runAgent } from "../src/agent-runner.js";
import subagentsExtension from "../src/index.js";

function makePi() {
  const tools = new Map<string, any>();
  const eventHandlers = new Map<string, any>();
  const lifecycle = new Map<string, any>();
  const notifications: any[] = [];
  const pi = {
    registerMessageRenderer: vi.fn(),
    registerTool: vi.fn((t: any) => tools.set(t.name, t)),
    registerCommand: vi.fn(),
    on: vi.fn((event: string, handler: any) => lifecycle.set(event, handler)),
    events: {
      emit: vi.fn(),
      on: vi.fn((event: string, handler: any) => {
        eventHandlers.set(event, handler);
        return vi.fn();
      }),
    },
    appendEntry: vi.fn(),
    sendMessage: vi.fn((msg: any) => notifications.push(msg)),
  } as any;
  return { pi, tools, eventHandlers, lifecycle, notifications };
}

// The RPC channels are registered on the first bound session_start (#142), so a
// test that drives them must fire it first — as a real session always does. A
// sessionId-less ctx makes startScheduler short-circuit (no filesystem touch).
async function bind(lifecycle: Map<string, any>) {
  const bindCtx = ctx();
  bindCtx.sessionManager.getSessionId = vi.fn(() => undefined);
  await lifecycle.get("session_start")({}, bindCtx);
}

function ctx() {
  return {
    hasUI: false,
    isIdle: vi.fn(() => true),
    ui: { setStatus: vi.fn(), setWidget: vi.fn(), notify: vi.fn() },
    cwd: "/tmp",
    model: undefined,
    modelRegistry: { find: vi.fn(), getAvailable: vi.fn(() => []) },
    sessionManager: { getSessionId: vi.fn(() => "s1"), getBranch: vi.fn(() => []) },
    getSystemPrompt: vi.fn(() => "parent"),
  } as any;
}

const textOf = (r: any): string => r.content[0].text;
// Outlive the 200ms individual-nudge debounce + a couple setImmediate hops.
const flush = async (ms = 400) => {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, ms));
};

describe("status note reaches the parent through the real handlers", () => {
  afterEach(() => vi.restoreAllMocks());

  it("foreground turn-limit abort → the Agent result flags an incomplete outcome", async () => {
    vi.mocked(runAgent).mockResolvedValue({
      responseText: "partial work so far",
      session: { dispose: vi.fn() } as any,
      aborted: true, // hard turn-limit abort
      steered: false,
    });
    const { pi, tools } = makePi();
    subagentsExtension(pi);

    const res = await tools.get("Agent").execute(
      "tc1",
      { prompt: "go", description: "d", subagent_type: "general-purpose" },
      undefined, undefined, ctx(),
    );

    const out = textOf(res);
    expect(out).toContain("hit the turn limit");      // getStatusNote("aborted") is wired in
    expect(out).toContain("partial work so far");     // partial result still delivered
    expect(out).not.toContain("STOPPED BY THE USER"); // not mislabelled as a user stop
  });

  it("background user-stop → completion notification flags STOPPED BY THE USER (not completed)", async () => {
    // A background agent that only a stop ends: hold runAgent's promise, stop it
    // (status → 'stopped'), then let runAgent settle so the completion fires.
    let resolveRun: (v: any) => void;
    vi.mocked(runAgent).mockReturnValue(new Promise((r) => { resolveRun = r; }) as any);
    const { pi, tools, eventHandlers, lifecycle, notifications } = makePi();
    subagentsExtension(pi);
    await bind(lifecycle); // register RPC channels via session_start (#142)

    const spawn = await tools.get("Agent").execute(
      "tc2",
      { prompt: "go", description: "d", subagent_type: "general-purpose", run_in_background: true },
      undefined, undefined, ctx(),
    );
    const id = textOf(spawn).match(/Agent ID: (\S+)/)?.[1];
    expect(id, "background spawn should surface an agent id").toBeTruthy();

    // The user stops it — same path the viewer's stop key uses (manager.abort).
    eventHandlers.get("subagents:rpc:stop")?.({ requestId: "r1", agentId: id });
    resolveRun!({
      responseText: "partial",
      session: { dispose: vi.fn() } as any,
      aborted: false,
      steered: false,
    });
    await flush();

    const notes = notifications.map((m) => m.content).join("\n");
    expect(notes).toContain("STOPPED BY THE USER");
    expect(notes).toContain("the task was NOT finished");
    expect(notes).not.toContain("Done"); // not surfaced as a normal completion
  });
});
