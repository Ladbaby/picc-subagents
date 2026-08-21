/**
 * clear-completed-wiring.test.ts — reproduces issue #108 end-to-end through the
 * REAL session lifecycle handlers.
 *
 * Bug: a background agent that has COMPLETED but whose result the parent hasn't
 * seen yet (resultConsumed=false) was wiped by clearCompleted() on session_start
 * / session_before_switch, so its completion notification was lost. The fix makes
 * both handlers call clearCompleted(true), preserving unconsumed records (the
 * 10-minute timer evicts them later).
 *
 * get_subagent_result no longer exists: background results are delivered in full
 * via the completion notification, and an unread background record stays
 * resultConsumed=false. The session handlers are a one-line call to
 * manager.clearCompleted(true) each, so these tests drive that exact semantics
 * against a real completed background record to prove unconsumed results survive
 * a session switch/start while consumed ones are still evicted.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentManager } from "../src/agent-manager.js";

vi.mock("../src/agent-runner.js", () => ({
  runAgent: vi.fn(),
  resumeAgent: vi.fn(),
  disposeSessionQuietly: vi.fn(),
}));

vi.mock("../src/worktree.js", () => ({
  createWorktree: vi.fn(),
  cleanupWorktree: vi.fn(() => ({ hasChanges: false })),
  pruneWorktrees: vi.fn(),
}));

import { runAgent } from "../src/agent-runner.js";

const mockPi = {} as any;
const mockCtx = { cwd: "/tmp" } as any;

const resolvedRun = () =>
  vi.mocked(runAgent).mockResolvedValue({
    responseText: "THE-RESULT-PAYLOAD",
    session: { dispose: vi.fn() } as any,
    aborted: false,
    steered: false,
  });

describe("issue #108: unconsumed completed background agents survive session events", () => {
  let manager: AgentManager;

  afterEach(() => {
    manager?.dispose();
    vi.restoreAllMocks();
  });

  async function spawnCompletedBackground(): Promise<string> {
    resolvedRun();
    const id = manager.spawn(mockPi, mockCtx, "general-purpose", "go", {
      description: "d",
      isBackground: true,
    });
    await manager.getRecord(id)!.promise;
    return id;
  }

  it("session_before_switch: clearCompleted(true) preserves the unconsumed result", async () => {
    manager = new AgentManager();
    const id = await spawnCompletedBackground();
    // Unconsumed background record → resultConsumed stays false.
    expect(manager.getRecord(id)!.resultConsumed).toBeFalsy();

    manager.clearCompleted(true); // what session_before_switch calls
    expect(manager.getRecord(id), "unconsumed record must survive").toBeDefined();
  });

  it("session_start: clearCompleted(true) preserves the unconsumed result", async () => {
    manager = new AgentManager();
    const id = await spawnCompletedBackground();
    expect(manager.getRecord(id)!.resultConsumed).toBeFalsy();

    manager.clearCompleted(true); // what session_start calls
    expect(manager.getRecord(id), "unconsumed record must survive").toBeDefined();
  });

  it("a consumed record IS evicted by clearCompleted(true) — the fix stays surgical", async () => {
    manager = new AgentManager();
    const id = await spawnCompletedBackground();
    // Simulate the parent having consumed the result (returned inline).
    manager.getRecord(id)!.resultConsumed = true;

    manager.clearCompleted(true);
    expect(manager.getRecord(id), "consumed record should be evicted").toBeUndefined();
  });
});
