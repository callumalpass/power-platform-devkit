# Documentation

This folder documents the parts of `pp` that are implemented and usable today.

Start here:

- [Quickstart](quickstart.md): build the repo, sign in, register an environment, and run the first Dataverse commands
- [Architecture](architecture.md): package layout, ownership boundaries, and how the repo fits together
- [Supported surfaces](supported-surfaces.md): what is stable, preview, experimental, or intentionally bounded
- [Operability](operability.md): install/package the CLI, enable shell completion, collect diagnostics bundles, and run `pp` safely in larger repos
- [Auth and environments](auth-and-environments.md): auth profile types, browser login, device code, and environment aliases
- [Command contract](command-contract.md): shared output formats, mutation flags, and project-scoped CLI overrides
- [Safety and provenance](safety-and-provenance.md): result metadata expectations, mutation safety rules, and `.ops` task-path conventions
- [Skills](skills.md): portable agent-skill packaging and the canonical `pp-development` skill layout
- [Project config](project-config.md): `pp.config.*` structure, parameter resolution, and local analysis commands
- [Extensions](extensions.md): extension contract, registry policy, compatibility rules, and contribution surfaces
- [Deploy](deploy.md): deploy plan/apply orchestration, supported mappings, and adapter behavior
- [Deploy examples](examples/deploy/github-actions-deploy.yml): concrete GitHub Actions, Azure DevOps, and Power Platform Pipelines wrapper templates under `docs/examples/deploy/`
- [Dataverse and solutions](dataverse-and-solutions.md): `dv` and `solution` commands, query options, and environment setup
- [Canvas registries](canvas.md): template registry schema, provenance rules, support matrix resolution, and project wiring
- [Canvas harvesting](canvas-harvesting.md): manual TEST-environment refresh workflow for pinned canvas registries
- [Flow artifacts](flow.md): remote flow discovery plus unpack/normalize/validate/patch workflows for canonical `flow.json` artifacts
- [Model-driven apps](model.md): model app composition inspection for sitemaps, forms, views, tables, and dependency tracing
- [Testing](testing.md): fixture-backed golden lanes, refresh commands, and the manual live smoke path

Suggested reading order for new contributors:

1. [Quickstart](quickstart.md)
2. [Architecture](architecture.md)
3. [Supported surfaces](supported-surfaces.md)
4. [Project config](project-config.md)
5. The domain doc for the workflow you are changing

The docs intentionally describe the current implemented surface, not the full long-term architecture in the external spec.

Additional planning docs:

- [Engineering toolkit spec copy](specs/power_platform_cli_spec.md): repo-local copy of the long-term architecture and product spec imported from `../pp-demos`
