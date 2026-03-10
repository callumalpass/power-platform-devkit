# Fallbacks and diagnostics

This reference explains when leaving `pp` is justified and how to describe the
reason precisely.

## Preferred tool order

1. supported `pp` command
2. another documented `pp` command or bounded preview path
3. `pac`
4. browser automation or manual Maker handoff

Do not jump to `pac` or Playwright just because they are familiar.

## Acceptable `pac` fallbacks

`pac` is acceptable when:

- `pp` has not yet implemented the required admin or solution action
- the repo docs describe the current `pp` slice as intentionally bounded
- the task needs an established Power Platform CLI behavior that `pp` cannot
  yet expose first-class

When using `pac`, keep the reasoning explicit: this is a `pp` product-gap
fallback, not the default operating model.

## Acceptable browser or Maker fallbacks

Browser automation or manual Maker handoff is acceptable when:

- the workflow is inherently portal-mediated today
- the current `pp` command returns delegated guidance or preview placeholder
  output
- auth requires one-time browser bootstrap for a reusable maker session

Prefer a `pp` command that opens or documents the handoff boundary over ad hoc
portal navigation.

## Distinguish the failure source

Classify friction into one of these buckets:

- `pp product gap`: the intended workflow is missing or too bounded in `pp`
- `platform limitation`: Microsoft APIs or Maker behavior are the real blocker
- `runtime/setup issue`: auth, token cache, sandbox, packaging, or machine
  state prevented normal execution
- `repo/config issue`: the local project, stage mapping, parameters, or env
  aliases are incomplete or wrong

That distinction matters because the fix paths differ.

## Diagnostic habits

When `pp` fails or blocks:

- prefer structured output with `--format json` where supported
- inspect the environment alias and auth profile explicitly
- run `pp project doctor` if the command depends on project discovery
- note whether the problem reproduces from both repo-root and project-root
- record the exact command and whether the issue came from local config,
  remote platform state, or missing `pp` capability

## Support-tier interpretation

Treat these repo doc signals as authoritative:

- stable: `pp` should usually be the default path
- preview but usable: prefer `pp`, but expect bounded mutation or rough edges
- experimental or intentionally incomplete: a fallback may be normal

If the workflow falls into an intentionally incomplete area, document the
boundary and move on instead of pretending the agent should brute-force around
it.
