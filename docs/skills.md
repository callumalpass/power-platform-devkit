# Skills

This repo now carries a canonical repo-local development skill at
`skills/pp-development/`.

The goal is portability: one conceptual model for Power Platform development
with `pp`, reused across coding agents instead of restated in tool-specific
prompts.

## Canonical shape

The canonical distribution target is the checked-in folder:

```text
skills/
  pp-development/
    SKILL.md
    references/
      project-shape-and-alm.md
      fallbacks-and-diagnostics.md
```

Rules:

- `SKILL.md` holds the core operating model and first-step workflow
- `references/` holds detail that should not bloat the primary skill entrypoint
- the skill must make sense without MCP
- repo-specific harness or `.ops` mechanics do not belong in the core skill

## Codex and Claude Code packaging

Use the checked-in `skills/pp-development/` folder as the single source of
truth.

For Codex:

- vendor or copy the folder into the active Codex skills directory
- keep `SKILL.md` as the entrypoint
- preserve the relative `references/` layout

For Claude Code:

- package the same canonical content into Claude's local skill/prompt format
- keep the same skill name, scope, and reference split
- adapt only the host wrapper, not the actual Power Platform workflow model

The portability requirement is deliberate: if Codex and Claude need different
substantive guidance, the skill boundary is wrong.

## Evaluation plan

The current harness does not yet inject repo-local skills automatically, so the
first evaluation pass should use the existing scenarios with a skill preload
step rather than inventing a separate harness stack.

Evaluate the skill in two passes:

1. `local-project-management`
   - preload `skills/pp-development/SKILL.md`
   - check whether the agent correctly anchors on `pp project doctor`,
     `pp project inspect`, and `pp analysis context` before repo archaeology
   - record whether the project/stage/environment/solution hierarchy feels
     intuitive
2. `power-platform-lifecycle`
   - preload the same skill
   - check whether the agent stays inside `pp` first, uses stage-aware
     targeting coherently, and records fallbacks with the right classification

Good signals:

- the agent reaches for `pp` before `pac` or browser automation
- the agent uses `project` as the local anchor and `stage` as the deploy anchor
- fallbacks are justified as `pp` gaps, platform limitations, or setup issues
  instead of being mixed together

Bad signals:

- the agent still needs repo archaeology to understand the project model
- the agent hard-codes environments instead of using topology or stage context
- the agent treats MCP as required for understanding the workflow
- Codex and Claude wrappers need materially different behavioral guidance

## What is still out of scope

This skill is about doing Power Platform development with `pp`.

It is not:

- a `pp-harness` skill
- a repo-maintainer guide for `.ops`
- a replacement for domain docs such as deploy, canvas, or Dataverse docs
