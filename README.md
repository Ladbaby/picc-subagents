# picc-subagents

[![npm downloads](https://img.shields.io/npm/dt/@ladbabynpm/picc-subagents.svg)](https://www.npmjs.com/package/@ladbabynpm/picc-subagents)

Fork of [`@tintinweb/pi-subagents`](https://github.com/tintinweb/pi-subagents), adding
`PICC_SUBAGENTS_MODEL` / `CLAUDE_CODE_SUBAGENT_MODEL` env-var model selection, removing `get_subagent_result` and `steer_subagent` tools.
To switch back to upstream, run `pi install npm:@tintinweb/pi-subagents`.

Part of [picc](https://github.com/Ladbaby/picc), a pi agent setup mirroring Claude Code's harness.

> pi has no built-in sub-agent concept. This extension adds one faithful to Claude Code: the
> `Agent` tool, foreground + background runs, a
> live widget and FleetView, custom agent types, mid-run steering, session resume, and a graceful
> turn limit — all with Claude Code's names, calling conventions, and UI patterns.

## Usage

Install via `pi install npm:@ladbabynpm/picc-subagents`.

## Tools

### `Agent`

Launch a sub-agent.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | yes | The task for the agent |
| `description` | string | yes | Short 3-5 word summary (shown in UI) |
| `subagent_type` | string | yes | Agent type (built-in or custom) |
| `model` | string | no | `provider/modelId` or fuzzy name (`"haiku"`, `"sonnet"`); resolved tolerantly with provider fallback |
| `thinking` | string | no | off, minimal, low, medium, high, xhigh, max |
| `max_turns` | number | no | Max agentic turns; omit for unlimited |
| `run_in_background` | boolean | no | Run without blocking |
| `resume` | string | no | Agent ID to resume a previous session |
| `isolated` | boolean | no | No extension/MCP tools |
| `isolation` | `"worktree"` | no | Run in an isolated git worktree |
| `inherit_context` | boolean | no | Fork parent conversation into agent |
| `schedule` | string | no | Fire later instead of now (cron / interval / one-shot) |

## Scheduling

Pass `schedule` to the `Agent` tool to fire the agent later instead of running now:

```
Agent({
  subagent_type: "Explore",
  prompt: "Look at recent commits and summarize what changed since last week",
  description: "Weekly commit review",
  schedule: "0 0 9 * * 1",   // 9am every Monday (6-field cron)
})
```

Formats:

- **Cron** — 6-field (`second minute hour day-of-month month day-of-week`), e.g. `"0 */15 * * * *"` every 15 minutes.
- **Interval** — `"5m"`, `"1h"`, `"30s"`, `"2d"`. Fires repeatedly.
- **One-shot relative** — `"+10m"`, `"+2h"`, `"1d"`.
- **One-shot absolute** — full ISO timestamp, e.g. `"2026-12-25T09:00:00.000Z"`.

When a schedule fires, the spawn runs in the background and its completion arrives through the same
`subagent-notification` path as a manually-spawned background agent.

- Schedules are **session-scoped** — reset on `/new`, restore on `/resume`. Stored at `<cwd>/.pi/subagent-schedules/<sessionId>.json` with PID-based locking. Manage via `/agents → Scheduled jobs`.
- `schedule` cannot combine with `inherit_context` or `resume`; `run_in_background` is forced `true`; scheduled fires bypass the `maxConcurrent` queue.
- **Headless `pi -p` does not wait for scheduled subagents.**
- Disable entirely via `/agents → Settings → Scheduling → disabled` (removes `schema`, hides the menu entry, stops active schedulers).

## Custom Agents

Define agent types by creating `.md` files; the filename becomes the type name, and any name
overrides a same-named default. Discovered from three locations (higher wins):

| Priority | Location | Scope |
|----------|----------|-------|
| 1 (highest) | `.pi/agents/<name>.md` | Project — pi's config dir; authoritative |
| 2 | `.agents/agents/<name>.md` | Project — shared cross-tool `.agents` workspace |
| 3 | `$PI_CODING_AGENT_DIR/agents/<name>.md` (default `~/.pi/agent/agents/<name>.md`) | Global — available everywhere |

### Example: `.pi/agents/auditor.md`

```markdown
---
description: Security Code Reviewer
tools: read, grep, find, bash
model: anthropic/claude-opus-4-6
thinking: high
max_turns: 30
---

You are a security auditor. Review code for vulnerabilities including:
- Injection flaws (SQL, command, XSS)
- Authentication and authorization issues
- Sensitive data exposure
- Insecure configurations
```

Then spawn it like any built-in: `Agent({ subagent_type: "auditor", ... })`.

### Frontmatter fields

All optional — sensible defaults throughout.

| Field | Default | Description |
|-------|---------|-------------|
| `description` | filename | Shown in tool listings |
| `display_name` | — | UI display name |
| `tools` | all 7 | Built-in names, `*`/`all`, `none`, and `ext:<ext>` / `ext:<ext>/<tool>` selectors |
| `extensions` | `true` | `true` (all), `false` (none), or a list: `[mcp, "/abs/path.ts", "*"]` |
| `exclude_extensions` | — | Extension denylist applied after `extensions:`; plain names only |
| `skills` | `true` | Inherit skills, or a comma list to preload |
| `memory` | — | Persistent memory scope: `project`, `local`, or `user` |
| `disallowed_tools` | — | Tools to deny even if extensions provide them |
| `isolation` | — | `worktree` to run in an isolated git worktree |
| `model` | inherit | `provider/modelId` or fuzzy name; resolved tolerantly with provider fallback |
| `thinking` | inherit | off, minimal, low, medium, high, xhigh, max |
| `max_turns` | unlimited | Max agentic turns before graceful shutdown |
| `persist_session` | `false` | Persist as a normal pi session (transcript written either way) |
| `session_dir` | pi default | Session dir when `persist_session: true` |
| `prompt_mode` | `replace` | `replace` (full prompt) or `append` (parent twin — inherits AGENTS.md/CLAUDE.md) |
| `inherit_context` | `false` | Fork parent conversation into agent |
| `run_in_background` | `false` | Run in background by default |
| `isolated` | `false` | Hermetic: `extensions: false` + `skills: false`, built-ins only |
| `enabled` | `true` | `false` to disable (hide a default per-project) |

Frontmatter is authoritative: if it sets `model`, `thinking`, `max_turns`, `inherit_context`,
`run_in_background`, `isolated`, or `isolation`, those are locked; `Agent` parameters only fill
unspecified fields. `model:` resolution is forgiving (`.`/`-` and a trailing date stamp are
interchangeable; a `provider/modelId` whose provider lacks the model retries the bare id), with
precedence **exact → fuzzy under named provider → same model under any provider → unavailable**
(inherits the parent model, flagged in `/agents`).

### Tool & extension scoping

`extensions:` decides **which extensions load**; `tools:` decides **which tools surface** to the
LLM. They compose:

```yaml
tools: read, grep, find           # narrow built-ins; extensions still load
tools: "*"                        # all 7 built-ins (alias: `all`)
tools: none                       # zero built-ins
tools: "*, ext:mcp/search"        # built-ins plus one extension tool

extensions: false                 # no extensions load
extensions: [mcp]                 # only mcp loads
exclude_extensions: pi-notify     # everything except pi-notify

isolated: true                    # hermetic: built-ins only, no extensions/skills/context
```

- `extensions:` is the sole loading authority — `ext:foo` in `tools:` narrows what surfaces but can't load `foo` alone.
- Any `ext:` entry flips extension tools to an explicit allowlist: `tools: "*, ext:mcp/search"` exposes only `search` from `mcp`, nothing from other extensions.
- Extension names match case-insensitively; `ext:foo/bar` tool names stay case-sensitive. A **package** extension matches by short name (`@scope/pi-subagents` → `[pi-subagents]`).
- Plain `tools:` typos fail loudly (`tools-error:…`), and `exclude_extensions:` wins over everything but is **not a sandbox** (excluded factories still run once).

## Commands

| Command | Description |
|---------|-------------|
| `/agents` | Interactive agent management menu |

`/agents` opens a menu of **Running agents** (open a live conversation viewer; `Enter` to steer,
`x`/`x` to stop — including background agents), **Agent types** (unified defaults + custom with
`•`/`◦`/`✕` source indicators; Eject / Edit / Disable / Delete per state), **Create new agent**
(manual wizard or AI-generated), and **Settings** (concurrency, max turns, grace turns, join mode,
scheduling, scope models, disable defaults, tool description mode, widget mode).

## Default Agent Types

| Type | Tools | Model | Prompt Mode | Description |
|------|-------|-------|-------------|-------------|
| `general-purpose` | all 7 | inherit | `append` (parent twin) | Inherits the parent's full system prompt — same rules, CLAUDE.md, conventions |
| `Explore` | read, bash, grep, find, ls | haiku (falls back to inherit) | `replace` | Fast codebase exploration (read-only) |
| `Plan` | read, bash, grep, find, ls | inherit | `replace` | Software architect for implementation planning (read-only) |

Default agents can be **ejected** (export as `.md`), **overridden** (create a `.md` with the same
name), or **disabled** per-project (`enabled: false`).

## UI

A persistent widget above the editor shows active agents (animated spinners, live tool activity,
token counts, status icons). Default `widgetMode: background` (foreground runs already render
inline as the `Agent` result); switch via `/agents → Settings → Widget` to `all` or `off`. The
token field is annotated with context-window utilization (`NN%`, color-coded) and compaction count
(`⇊N`).

**FleetView** renders a Claude Code-style navigable list of `main` + every running subagent below
the editor (earliest-launched first). At an empty prompt press `↓`/`←` to enter, `↑`/`↓` to move,
`Enter` to open the live conversation, `Esc` to return. Inside the overlay `Enter` opens a steering
composer, and `x` stops a running agent. Toggle via `/agents → Settings → Fleet view`.

Individual results render Claude Code-style (`⠹` running, `✓` completed/wrapped, `■` stopped, `✗`
error/aborted); completed results expand (ctrl+o) to full output. Both foreground and background
agents stream to `.pi/output/agent-<id>.jsonl`; background completions render as themed notification
boxes while the LLM receives structured `<task-notification>` XML.

## Graceful Max Turns

Instead of hard-aborting at `max_turns`, agents get a wrap-up warning, up to 5 grace turns to finish
cleanly, and a hard abort only after the grace period.

| Status | Meaning | Icon |
|--------|---------|------|
| `completed` | Finished naturally | `✓` green |
| `steered` | Hit limit, wrapped up in time | `✓` yellow |
| `aborted` | Grace period exceeded | `✗` red |
| `stopped` | User-initiated abort | `■` dim |

## Concurrency & Join Strategies

Background agents are subject to a configurable concurrency limit (default 4); excess agents queue
and start as slots free up. Foreground agents bypass the queue.

The **join mode** controls how background completion notifications are delivered:

| Mode | Behavior |
|------|----------|
| `smart` (default) | 2+ background agents from the same turn are consolidated into one notification; solo agents notify individually |
| `async` | Each agent notifies on completion (original behavior) |
| `group` | Force grouping even for a single agent |

Grouped agents start a 30-second window after the first completes; partial results notify on
timeout, stragglers re-batch over a 15-second window. Configure via `/agents → Settings → Join mode`.

## Model Scope

**Opt-in:** off by default; enable via `/agents → Settings → Scope models`. When on, each spawn's
effective model is validated against pi's `enabledModels` list (from `/scoped-models`). Both global
`~/.pi/agent/settings.json` and project `<cwd>/.pi/settings.json` are honored — **project overrides
global**.

| Model source | Out-of-scope behavior |
|---|---|
| Caller-supplied `Agent({ model })` | Hard error to the orchestrator, listing allowed models |
| Pinned in frontmatter | Warning; the pin runs (frontmatter authoritative) |
| Parent-inherited | Warning; the parent model runs |

Only exact `provider/modelId` entries are honored; globs, bare ids, and `:thinking` suffixes are
dropped. An empty/missing `enabledModels` makes the check a no-op.

## Persistent Settings

Runtime values set via `/agents → Settings` persist across restarts. Two files, merged on load:

- **Global:** `~/.pi/agent/subagents.json` — machine-wide defaults (hand-edited; the menu never writes here).
- **Project:** `<cwd>/.pi/subagents.json` — per-project overrides (written by the menu).

Project overrides global; missing fields fall back to hardcoded defaults (concurrency `4`, max
turns unlimited, grace `5`, join `smart`, defaults enabled). `disableDefaultAgents` (default
`false`) stops the three built-ins from registering. `toolDescriptionMode` (`"full"` / `"compact"` /
`"custom"`) controls which `Agent` tool description the LLM sees; `"custom"` reads a markdown file
with `{{typeList}}`, `{{compactTypeList}}`, `{{agentDir}}`, `{{scheduleGuideline}}` placeholders
(see [`examples/agent-tool-description.md`](examples/agent-tool-description.md) as a starting point).

## Events

Lifecycle events are emitted via `pi.events` so other extensions can react:

| Event | When |
|-------|------|
| `subagents:created` | Background agent registered |
| `subagents:started` | Agent transitions to running (incl. queued→running) |
| `subagents:completed` | Agent finished successfully |
| `subagents:failed` | Agent errored, stopped, or aborted |
| `subagents:steered` | Steering message sent |
| `subagents:compacted` | Agent's session compacted (`reason`: manual/threshold/overflow) |
| `subagents:scheduled` | Schedule lifecycle change (added/removed/updated/fired/error) |
| `subagents:scheduler_ready` | Scheduler bound, enabled jobs armed |
| `subagents:ready` | RPC handlers registered and armed (session start) |
| `subagents:settings_loaded` / `settings_changed` | Persisted settings applied / mutated |

`tokens.total` = `input + output + cacheWrite` (`cacheRead` excluded to avoid over-counting). Use
`contextUsage.percent` for current context size.

## Cross-Extension RPC

Other pi extensions can spawn and stop subagents via `pi.events` without importing this package.
Replies use a standardized envelope: `{ success: true, data? }` or `{ success: false, error }`.

- **Discovery** — listen for `subagents:ready` before calling; treat its absence as "not available here" (give discovery a timeout).
- **Ping** — `subagents:rpc:ping` returns the protocol version.
- **Spawn** — `subagents:rpc:spawn` with `type`, `prompt`, and `options` (e.g. `{ description, run_in_background, model, cwd }`). `options.model` accepts a `Model` object or `"provider/modelId"` string (resolved against `ctx.modelRegistry`). `options.cwd` runs the agent in another directory (`.pi` still loads from the parent project).
- **Stop** — `subagents:rpc:stop` with `agentId`.

Reply channels are scoped per `requestId`, so concurrent requests don't interfere.

## Persistent Agent Memory

Set `memory` in frontmatter to enable memory across sessions:

| Scope | Location | Use case |
|-------|----------|----------|
| `project` | `.pi/agent-memory/<name>/` | Shared across the team (committed) |
| `local` | `.pi/agent-memory-local/<name>/` | Machine-specific (gitignored) |
| `user` | `~/.pi/agent-memory/<name>/` | Global personal memory |

Memory uses a `MEMORY.md` index plus individual files. Agents with write tools get full read-write;
**read-only agents** (no `write`/`edit`) automatically get read-only memory to prevent unintended
tool escalation. `disallowed_tools` is respected when detecting write capability.

## Worktree Isolation

Set `isolation: worktree` to run an agent in a temporary git worktree. On completion: no changes →
cleaned up; changes made → committed to a `pi-agent-<id>` branch and returned; agent committed its
own work → branch created at its HEAD. The preservation commit uses `--no-verify` (local-only,
never pushed). If the worktree can't be created, the tool returns a clear error — `worktree` is a
strict guarantee, not a hint.

## Skill Preloading

Preload named skills into the agent's system prompt (`skills: api-conventions, error-handling`).
Discovery roots, checked in order (first match wins): `<cwd>/.pi/skills/`, `<cwd>/.agents/skills/`,
`$PI_CODING_AGENT_DIR/skills/` (default `~/.pi/agent/skills/`), `~/.agents/skills/`, `~/.pi/skills/`.
Within a root a skill `foo` resolves to `<root>/foo.md`, `<root>/foo/SKILL.md`, or a directory skill
found by recursive descent (skipping dotdirs and `node_modules`). Symlinks are rejected at every
layer; path-traversal skill names are rejected.

## Requirements

No external binaries. Runs entirely on the pi runtime.

## Development

```bash
npm install
npm run lint        # biome check
npm run typecheck   # tsc --noEmit
npm run test        # vitest run
```

## Architecture

```
src/
  index.ts            # Extension entry: tool/command registration, rendering
  types.ts            # Type definitions (AgentConfig, AgentRecord, etc.)
  default-agents.ts   # Embedded default agent configs (general-purpose, Explore, Plan)
  agent-types.ts      # Unified agent registry (defaults + user), tool name resolution
  agent-runner.ts     # Session creation, execution, graceful max_turns, steer/resume
  agent-manager.ts    # Agent lifecycle, concurrency queue, completion notifications
  cross-extension-rpc.ts # RPC handlers for cross-extension spawn/ping via pi.events
  group-join.ts       # Batched completion notifications with timeout
  custom-agents.ts    # Load user-defined agents from .pi/agents/, .agents/agents/, global
  memory.ts           # Persistent agent memory (resolve, read, build prompt blocks)
  skill-loader.ts     # Preload skills (Pi-standard + Agent Skills spec layouts)
  output-file.ts      # Streaming output transcripts
  worktree.ts         # Git worktree isolation (create, cleanup, prune)
  prompts.ts          # Config-driven system prompt builder
  context.ts          # Parent conversation context for inherit_context
  env.ts              # Environment detection (git, platform)
  subagent-env.ts     # PICC_SUBAGENTS_MODEL / CLAUDE_CODE_SUBAGENT_MODEL overrides (fork)
  ui/
    agent-widget.ts       # Persistent widget: spinners, activity, status icons, theming
    conversation-viewer.ts # Live conversation overlay for viewing agent sessions
```

## Fork notes (PICC_SUBAGENTS_MODEL / CLAUDE_CODE_SUBAGENT_MODEL)

This fork adds support for picking the **default subagent model from an environment
variable**, mirroring claude-code's
[`CLAUDE_CODE_SUBAGENT_MODEL`](https://docs.claude.com/en/docs/claude-code/subagents) hook.

| Variable | Precedence | Notes |
|---|---|---|
| `PICC_SUBAGENTS_MODEL` | 1 (highest) | Fork-specific. |
| `CLAUDE_CODE_SUBAGENT_MODEL` | 2 | claude-code-compatible; ignored when `PICC_SUBAGENTS_MODEL` is set. |
| _unset_ | — | Falls back to existing precedence: caller `Agent({model})` > frontmatter `model:` > inherit parent. |

The chosen model **overrides everything** — frontmatter pins and `Agent` `model:` parameters —
matching claude-code's treatment of the env var as the user's authoritative default. Resolution uses
the same forgiving matcher as the `Agent` `model` parameter (fuzzy aliases, `provider/modelId`,
date stamps, provider fallback). A misconfigured value surfaces a `Model not found: …` tool error
rather than silently falling back; whitespace-only values are treated as unset. Affects in-process
`Agent` calls; cross-extension RPC callers pick up the same vars in their own process.

```bash
export PICC_SUBAGENTS_MODEL=haiku                                  # always run subagents on haiku
export CLAUDE_CODE_SUBAGENT_MODEL=anthropic/claude-haiku-4-5    # claude-code-compatible
```
