# Superpowers Reference

Local copy of the [Superpowers](https://github.com/obra/superpowers) plugin skills v5.0.5, for use as reference during platform self-development work.

## Skills

| File | Purpose |
|------|---------|
| [brainstorming.md](skills/brainstorming.md) | Socratic design refinement — ideas into specs |
| [writing-plans.md](skills/writing-plans.md) | Detailed implementation plans with bite-sized tasks |
| [executing-plans.md](skills/executing-plans.md) | Batch execution with checkpoints |
| [subagent-driven-development.md](skills/subagent-driven-development.md) | Fresh subagent per task + two-stage review |
| [test-driven-development.md](skills/test-driven-development.md) | RED-GREEN-REFACTOR cycle |
| [systematic-debugging.md](skills/systematic-debugging.md) | 4-phase root cause process |
| [verification-before-completion.md](skills/verification-before-completion.md) | Evidence before claims, always |
| [dispatching-parallel-agents.md](skills/dispatching-parallel-agents.md) | Concurrent subagent workflows |
| [finishing-a-development-branch.md](skills/finishing-a-development-branch.md) | Merge/PR decision workflow |
| [requesting-code-review.md](skills/requesting-code-review.md) | Pre-review checklist |
| [receiving-code-review.md](skills/receiving-code-review.md) | Responding to feedback with rigor |
| [writing-skills.md](skills/writing-skills.md) | Create new skills following TDD for docs |

## Subagent Prompts

| File | Purpose |
|------|---------|
| [spec-document-reviewer.md](prompts/spec-document-reviewer.md) | Verify spec is complete and ready for planning |
| [plan-document-reviewer.md](prompts/plan-document-reviewer.md) | Verify plan matches spec and has proper task decomposition |
| [implementer.md](prompts/implementer.md) | Dispatch implementer subagent per task |
| [spec-reviewer.md](prompts/spec-reviewer.md) | Verify implementation matches spec |
| [code-quality-reviewer.md](prompts/code-quality-reviewer.md) | Verify implementation is well-built |

## Installed Claude Code Skills

All skills and prompts above are installed as Claude Code custom commands in `.claude/commands/`. Available via `/project:<name>`:

**Skills (12):**
`/project:brainstorming`, `/project:writing-plans`, `/project:executing-plans`, `/project:subagent-driven-development`, `/project:test-driven-development`, `/project:systematic-debugging`, `/project:verification-before-completion`, `/project:dispatching-parallel-agents`, `/project:finishing-a-development-branch`, `/project:requesting-code-review`, `/project:receiving-code-review`, `/project:writing-skills`

**Subagent Prompts (5):**
`/project:spec-document-reviewer`, `/project:plan-document-reviewer`, `/project:implementer`, `/project:spec-reviewer`, `/project:code-quality-reviewer`

**Platform-Specific (1):**
`/project:tool-evaluation` — Initiates the Tool Evaluation Pipeline (EP-GOVERN-002) for vetting external tools, MCP servers, and dependencies

## Philosophy

- **Test-Driven Development** — Write tests first, always
- **Systematic over ad-hoc** — Process over guessing
- **Complexity reduction** — Simplicity as primary goal
- **Evidence over claims** — Verify before declaring success
