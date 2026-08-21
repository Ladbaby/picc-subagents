import type { AgentConfig, IsolationMode, JoinMode, ThinkingLevel } from "./types.js";

interface AgentInvocationParams {
  model?: string;
  run_in_background?: boolean;
  isolation?: IsolationMode;
}

export function resolveAgentInvocationConfig(
  agentConfig: AgentConfig | undefined,
  params: AgentInvocationParams,
): {
  modelInput?: string;
  modelFromParams: boolean;
  thinking?: ThinkingLevel;
  maxTurns?: number;
  inheritContext: boolean;
  runInBackground: boolean;
  isolated: boolean;
  isolation?: IsolationMode;
} {
  return {
    modelInput: agentConfig?.model ?? params.model,
    modelFromParams: agentConfig?.model == null && params.model != null,
    // thinking / max_turns / inherit_context / isolated are no longer per-call
    // Agent params — they resolve from the agent's frontmatter (or defaults).
    thinking: agentConfig?.thinking as ThinkingLevel | undefined,
    maxTurns: agentConfig?.maxTurns,
    inheritContext: agentConfig?.inheritContext ?? false,
    runInBackground: agentConfig?.runInBackground ?? params.run_in_background ?? false,
    isolated: agentConfig?.isolated ?? false,
    isolation: agentConfig?.isolation ?? params.isolation,
  };
}

export function resolveJoinMode(defaultJoinMode: JoinMode, runInBackground: boolean): JoinMode | undefined {
  return runInBackground ? defaultJoinMode : undefined;
}
