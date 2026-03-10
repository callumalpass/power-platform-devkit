---
name: pp-development
description: Portable agent guidance for real Power Platform development with `pp`, designed to work for both Codex and Claude Code and to keep MCP optional.
---

# pp-development

Use this skill when the task is actual Power Platform development work in a
repo that uses `pp`: understanding the local project, inspecting or mutating
Dataverse and solutions, moving across stages, running deploy flows, or
deciding whether a fallback to `pac` or browser automation is justified.

Do not use this skill for maintaining this repo's harness or `.ops` registry
unless the task explicitly asks for that.

## Outcome

Operate with one consistent model:

- `project` is the local source-of-truth for intent, layout, stage topology,
  and parameter mapping
- `environment` is the remote Dataverse target
- `solution` is the remote application boundary inside that environment
- `pp` should be the first tool for supported workflows
- MCP can help, but the skill must still work from the CLI alone

## First moves

When dropped into an unfamiliar repo:

1. Confirm how to invoke `pp` in this workspace. Prefer `pp ...` if installed,
   otherwise use `pnpm pp -- ...` from the repo root or
   `node packages/cli/dist/index.js ...`.
2. Inspect the local project before doing repo archaeology:
   - `pp project doctor`
   - `pp project inspect --format json`
   - `pp analysis context --format json`
3. Resolve the target scope deliberately:
   - local-only work: stay anchored on `project`
   - remote Dataverse/solution work: resolve `--env <alias>`
   - release/deploy work: resolve `--stage <stage>` first, then let `pp`
     derive environment and solution targets from topology

## When `pp` should be first

Reach for `pp` first when the workflow fits one of these surfaces:

- auth profiles, browser profiles, and environment aliases
- project init, doctor, inspect, feedback, and analysis context/report
- Dataverse read operations and supported metadata authoring
- solution lifecycle and inspection
- deploy plan/apply/release orchestration
- local canvas, flow, and model-driven inspection workflows

Prefer one `pp` command that exposes the contract directly over combining raw
Dataverse requests and repo archaeology.

## Local project model

Treat the nearest `pp.config.json|yaml|yml` as the project anchor.

Expect these concepts:

- `defaults`: the common environment, stage, or solution defaults
- `assets`: local folders such as `apps/`, `flows/`, `solutions/`, `docs/`
- `providerBindings`: project-local names for remote systems or targets
- `parameters`: values that may resolve from literals, env vars, or secrets
- `topology`: stage-aware overrides for environment alias, solution alias, and
  parameter values

Read [`references/project-shape-and-alm.md`](references/project-shape-and-alm.md)
before inventing a parallel folder model.

## Stage-aware work

Prefer stage selection over hard-coding environment-specific source forks.

- Use `pp project inspect --stage <stage>` or
  `pp analysis context --stage <stage>` to understand the effective target.
- Use `pp deploy plan --stage <stage>` before live apply.
- Treat stage overrides as configuration, not as a reason to duplicate
  `solutions/`, `flows/`, or `apps/` trees per environment.

If a command accepts both `--stage` and direct environment or solution flags,
prefer the stage-aware path when the repo has topology configured.

## Fallback rules

Stay inside `pp` unless one of these is true:

1. the repo docs mark the workflow as preview, bounded, or intentionally
   incomplete
2. `pp` returns an explicit not-yet-implemented or blocked diagnostic
3. the missing capability is specifically a browser-only Maker workflow
4. the task is asking for something outside the current `pp` support tier

Fallback order:

1. another supported `pp` path
2. `pac` for product gaps on Power Platform admin or solution flows
3. browser automation or manual Maker handoff when the platform is inherently
   UI-mediated

Whenever you leave `pp`, record why:

- product gap in `pp`
- platform limitation or opaque Microsoft surface
- auth/session/runtime/setup problem
- user repo/config issue

Use
[`references/fallbacks-and-diagnostics.md`](references/fallbacks-and-diagnostics.md)
to classify that boundary cleanly.

## MCP

MCP is optional enhancement, not the conceptual source of truth.

- If MCP is available, use it as interface glue over the same project,
  analysis, and deploy concepts.
- Do not assume MCP exists before the skill is usable.
- Do not explain `pp` workflows in MCP-only terms.

## Packaging guidance

Keep the canonical content in this folder and adapt the wrapper per agent host.

- Codex: vendor this folder into the repo or install it under the Codex skills
  home so the `SKILL.md` body stays intact.
- Claude Code: package the same canonical text and references in Claude's
  skill/prompt format without changing the core workflow model.

The portable distribution notes live in [`/home/calluma/projects/pp/docs/skills.md`](/home/calluma/projects/pp/docs/skills.md).

## References

- [`references/project-shape-and-alm.md`](references/project-shape-and-alm.md)
- [`references/fallbacks-and-diagnostics.md`](references/fallbacks-and-diagnostics.md)
