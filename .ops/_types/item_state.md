---
name: item_state
strict: true
fields:
  id:
    type: string
    required: true
    unique: true
  provider:
    type: enum
    required: true
    values: [github, gitlab, jira, azure, local]
  kind:
    type: enum
    required: true
    values: [issue, pr, task]
  key:
    type: string
    required: true
  repo:
    type: string
  number:
    type: integer
  external_ref:
    type: string
    required: true
  target_path:
    type: string
  remote_title:
    type: string
  remote_state:
    type: string
  remote_author:
    type: string
  remote_url:
    type: string
  remote_updated_at:
    type: datetime
  last_seen_remote_updated_at:
    type: datetime
  local_status:
    type: enum
    values: [new, triaged, in_progress, blocked, done, wontfix]
    default: new
  priority:
    type: enum
    values: [low, medium, high, critical]
  difficulty:
    type: enum
    values: [trivial, easy, medium, hard, complex]
  risk:
    type: enum
    values: [low, medium, high]
  owner:
    type: string
  tags:
    type: list
    items:
      type: string
  sync_state:
    type: enum
    values: [clean, dirty, conflict]
    default: clean
  last_analyzed_at:
    type: datetime
---

# Item State

Sidecar state for a tracked issue, pull request, or local task.

Keep all narrative content in the markdown body. The frontmatter is only for
small, queryable state.

Recommended body headings:

- `## Summary`
- `## Analysis`
- `## Plan`
- `## Notes`
- `## Handoff`
