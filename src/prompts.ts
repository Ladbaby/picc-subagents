/**
 * prompts.ts — System prompt builder for agents.
 */

import type { AgentConfig, EnvInfo } from "./types.js";

/** Extra sections to inject into the system prompt (memory, skills, etc.). */
export interface PromptExtras {
  /** Persistent memory content to inject (first 200 lines of MEMORY.md + instructions). */
  memoryBlock?: string;
  /** Preloaded skill contents to inject. */
  skillBlocks?: { name: string; content: string }[];
}

/**
 * Build the system prompt for an agent from its config.
 *
 * - "replace" mode: sub-agent identity + config.systemPrompt, with the env
 *   block appended at the very end.
 * - "append" mode: parent system prompt + sub-agent bridge + active agent tag
 *   + (optional) config.systemPrompt, with the env block appended at the end.
 * - "append" with empty systemPrompt: pure parent clone.
 *
 * Both modes place the env block (cwd, branch, platform) at the END of the
 * system prompt so that the cache key's byte-stable prefix is maximised.
 * Within a session the env block content is stable (cwd and branch don't
 * change), so the cache key matches across calls and Anthropic's prompt
 * cache hits for the bulk of the prompt. This matches Claude Code's
 * `buildSystemPromptBlocks` pattern of putting envInfo as the final
 * cacheable block.
 *
 * Both modes also include an `<active_agent name="${config.name}"/>` tag so
 * downstream extensions (e.g. permission/policy systems) can resolve per-
 * agent policy inside the child session by parsing the system prompt.
 *
 * @param parentSystemPrompt  The parent agent's effective system prompt (for append mode).
 * @param extras  Optional extra sections to inject (memory, preloaded skills).
 */
export function buildAgentPrompt(
  config: AgentConfig,
  cwd: string,
  env: EnvInfo,
  parentSystemPrompt?: string,
  extras?: PromptExtras,
): string {
  const activeAgentTag = `<active_agent name="${config.name}"/>\n\n`;

  const envBlock = `# Environment
Working directory: ${cwd}
${env.isGitRepo ? `Git repository: yes\nBranch: ${env.branch}` : "Not a git repository"}
Platform: ${env.platform}`;

  // Build optional extras suffix (placed after env block)
  const extraSections: string[] = [];
  if (extras?.memoryBlock) {
    extraSections.push(extras.memoryBlock);
  }
  if (extras?.skillBlocks?.length) {
    for (const skill of extras.skillBlocks) {
      extraSections.push(`\n# Preloaded Skill: ${skill.name}\n${skill.content}`);
    }
  }
  const extrasSuffix = extraSections.length > 0 ? "\n\n" + extraSections.join("\n") : "";

  if (config.promptMode === "append") {
    const identity = parentSystemPrompt || genericBase;

    const bridge = `<sub_agent_context>
You are operating as a sub-agent invoked to handle a specific task.
- Use the read tool instead of cat/head/tail
- Use the edit tool instead of sed/awk
- Use the write tool instead of echo/heredoc
- Use the find tool instead of bash find/ls for file search
- Use the grep tool instead of bash grep/rg for content search
- Make independent tool calls in parallel
- Use absolute file paths
- Do not use emojis
- Be concise but complete
</sub_agent_context>`;

    const customSection = config.systemPrompt?.trim()
      ? `\n\n<agent_instructions>\n${config.systemPrompt}\n</agent_instructions>`
      : "";

    // Place shared/stable content first so the LLM's KV cache can reuse the
    // inherited prefix across all subagent invocations. The parent prompt is
    // placed verbatim (no wrapper tag) so it forms an identical byte prefix
    // with the parent session. The active agent tag and the sub-agent's own
    // instructions are also stable per agent registration. The env block
    // (cwd/branch/platform) is the only per-call variable content and is
    // placed at the very end so the cache key's byte-stable prefix is
    // maximised — matching Claude Code's pattern of putting envInfo as the
    // final cacheable block.
    return identity + "\n\n" + bridge + "\n\n" + activeAgentTag + customSection + envBlock + extrasSuffix;
  }

  // "replace" mode — sub-agent identity + the config's full system prompt,
  // with the env block placed at the very end so the cache key's byte-stable
  // prefix (agent identity + instructions) is maximised. The env block is
  // the only per-call variable; once cwd/branch/platform are stable within
  // a session the cache key matches across calls.
  const replacePrefix = `You are a pi coding agent sub-agent.
You have been invoked to handle a specific task autonomously.

`;

  return activeAgentTag + replacePrefix + config.systemPrompt + "\n\n" + envBlock + extrasSuffix;
}

/** Fallback base prompt when parent system prompt is unavailable in append mode. */
const genericBase = `# Role
You are a general-purpose coding agent for complex, multi-step tasks.
You have full access to read, write, edit files, and execute commands.
Do what has been asked; nothing more, nothing less.`;
