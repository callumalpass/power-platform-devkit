# Skills

This repo carries a canonical repo-local development skill at
`skills/pp-development/`. The goal is portability: one conceptual model for
Power Platform development with `pp`, reused across coding agents instead of
restated in tool-specific prompts.

## Canonical shape

The skill lives in the checked-in `skills/pp-development/` folder. `SKILL.md`
holds the core operating model and first-step workflow, and the `references/`
directory holds supporting detail that should not bloat the primary entrypoint.
The skill must make sense without MCP. Repo-specific harness or `.ops` mechanics
do not belong in the core skill.

```text
skills/
  pp-development/
    SKILL.md
    references/
      project-shape-and-alm.md
      fallbacks-and-diagnostics.md
```

## Codex and Claude Code packaging

Use the checked-in `skills/pp-development/` folder as the single source of
truth. For Codex, vendor or copy the folder into the active Codex skills
directory, keeping `SKILL.md` as the entrypoint and preserving the relative
`references/` layout. For Claude Code, package the same canonical content into
Claude's local skill or prompt format, adapting only the host wrapper rather
than the actual Power Platform workflow model.

The portability requirement is deliberate: if Codex and Claude need different
substantive guidance, the skill boundary is wrong.

## Evaluation plan

The current harness does not yet inject repo-local skills automatically, so the
first evaluation pass should use existing scenarios with a skill preload step
rather than a separate harness stack.

The first pass (`local-project-management`) should preload
`skills/pp-development/SKILL.md` and check whether the agent correctly anchors
on `pp diagnostics doctor`, `pp env inspect`, and `pp dv whoami` before repo
archaeology, and whether the environment and solution hierarchy feels intuitive.
The second pass (`power-platform-lifecycle`) should preload the same skill and
check whether the agent stays inside `pp` first, uses environment-alias
targeting coherently, and records fallbacks with the right classification.

Good signals include the agent reaching for `pp` before `pac` or browser
automation, using environment aliases and solution names as primary anchors, and
justifying fallbacks as `pp` gaps, platform limitations, or setup issues rather
than mixing those categories together. Bad signals include the agent needing
repo archaeology to understand the workflow model, hard-coding environment URLs
instead of using aliases, treating MCP as required for understanding the
workflow, or Codex and Claude wrappers needing materially different behavioral
guidance.

## Scope

This skill is about doing Power Platform development with `pp`. It is not a
harness skill, a repo-maintainer guide for `.ops`, or a replacement for domain
docs such as canvas, flow, or Dataverse documentation.
