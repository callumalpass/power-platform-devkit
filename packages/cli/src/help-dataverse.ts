export function printDataverseHelp(): void {
  process.stdout.write(
    [
      'Usage: dv <command> [options]',
      '',
      'Commands:',
      '  whoami                      resolve the current caller and target environment',
      '  request                     issue a raw Dataverse Web API request',
      '  action <name>               invoke a Dataverse action with typed parameters',
      '  function <name>             invoke a Dataverse function with typed parameters',
      '  batch                       execute a Dataverse $batch manifest',
      '  rows ...                    export row sets or apply typed row manifests',
      '  query <table>               query table rows through Dataverse',
      '  get <table> <id>            fetch one Dataverse row by id',
      '  create <table>              create one Dataverse row',
      '  update <table> <id>         update one Dataverse row',
      '  delete <table> <id>         delete one Dataverse row',
      '  metadata ...                inspect or mutate Dataverse metadata',
      '',
      'Examples:',
      '  pp dv whoami --environment dev --format json',
      '  pp dv query solutions --environment dev --select solutionid,uniquename --top 5',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printDataverseWhoAmIHelp(): void {
  process.stdout.write(
    [
      'Usage: dv whoami --environment ALIAS [--no-interactive-auth] [options]',
      '',
      'Behavior:',
      '  - Resolves the target environment alias and auth profile.',
      '  - Returns the current Dataverse caller and business unit ids with environment context.',
      '',
      'Examples:',
      '  pp dv whoami --environment dev',
      '  pp dv whoami --environment dev --format json',
      '  pp dv whoami --environment dev --no-interactive-auth --format json',
      '',
      'Options:',
      '  --no-interactive-auth       Fail fast with structured diagnostics instead of opening browser auth',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printDataverseQueryHelp(): void {
  process.stdout.write(
    [
      'Usage: dv query <table> --environment ALIAS [--solution UNIQUE_NAME] [options]',
      '',
      'Behavior:',
      '  - Queries one Dataverse table and prints the matching rows.',
      '  - Accepts either a logical table name or an entity set name.',
      '  - With `--solution`, validates that the table belongs to that solution before running the read.',
      '',
      'Examples:',
      '  pp dv query solutions --environment dev --select solutionid,uniquename --top 5',
      '  pp dv query pp_project --environment dev --solution HarnessSolution --select pp_projectid,pp_name --top 10',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printDataverseCreateHelp(): void {
  process.stdout.write(
    [
      'Usage: dv create <table> --environment ALIAS (--body JSON | --body-file FILE) [options]',
      '',
      'Behavior:',
      '  - Creates one Dataverse row from a JSON object payload.',
      '  - Accepts either a logical table name or an entity set name; pp resolves logical collection names when Dataverse rejects the raw path.',
      '  - Use `--return-representation` with `--select`, `--expand`, or `--annotations` when you need the created row echoed back.',
      '',
      'Dataverse payload tips:',
      '  - Date-only columns expect `YYYY-MM-DD` strings, for example `"pph34135_duedate": "2026-03-12"`.',
      '  - Lookup binds use the navigation-property schema name, for example `"pph34135_ProjectId@odata.bind": "/pph34135_projects(<guid>)"`.',
      '  - If Dataverse rejects a lookup bind, inspect the warning payload for the suggested schema-name replacement or run `pp dv metadata columns <table> --environment <alias>`.',
      '',
      'Examples:',
      '  pp dv create accounts --environment dev --body \'{"name":"Harness Account Seed"}\' --format json',
      '  pp dv create pph34135_project --environment test --body-file ./project.seed.json --return-representation --select pph34135_projectid,pph34135_name',
      '  pp dv create pph34135_tasks --environment test --body \'{"pph34135_name":"Harness Task Seed","pph34135_duedate":"2026-03-12","pph34135_ProjectId@odata.bind":"/pph34135_projects(00000000-0000-0000-0000-000000000001)"}\' --format json',
      '',
      'Options:',
      '  --body JSON                Inline JSON object payload',
      '  --body-file FILE           Read the JSON object payload from a file',
      '  --return-representation    Ask Dataverse to return the created row body',
      '  --select a,b              Requested columns when `--return-representation` is enabled',
      '  --expand nav              Expand navigation properties on the returned row',
      '  --annotations a,b         Include OData annotations on the returned row',
      '  --if-none-match VALUE     Send an `If-None-Match` precondition header',
      '  --if-match VALUE          Send an `If-Match` precondition header',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printDataverseRowsHelp(): void {
  process.stdout.write(
    [
      'Usage: dv rows <command> [options]',
      '',
      'Commands:',
      '  export <table>              export a Dataverse row set with query metadata',
      '  apply                       apply a typed row-mutation manifest through Dataverse batch',
      '',
      'Examples:',
      '  pp dv rows export accounts --environment dev --select accountid,name --all --out ./accounts.json',
      '  pp dv rows apply --environment dev --file ./account-ops.yaml --solution Core',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printDataverseRowsExportHelp(): void {
  process.stdout.write(
    [
      'Usage: dv rows export <table> --environment ALIAS [options]',
      '',
      'Behavior:',
      '  - Queries Dataverse rows and packages them into a stable row-set artifact.',
      '  - Includes query metadata so the exported file records how the slice was collected.',
      '  - Writes JSON or YAML when `--out` is provided; otherwise prints the artifact to stdout.',
      '',
      'Examples:',
      '  pp dv rows export accounts --environment dev --select accountid,name --top 100',
      '  pp dv rows export accounts --environment dev --filter "statecode eq 0" --all --out ./accounts.yaml',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printDataverseRowsApplyHelp(): void {
  process.stdout.write(
    [
      'Usage: dv rows apply --file FILE --environment ALIAS [options]',
      '',
      'Behavior:',
      '  - Reads a typed row-mutation manifest instead of raw HTTP batch parts.',
      '  - Supports `create`, `update`, `upsert`, and `delete` operations.',
      '  - Uses Dataverse batch under the hood while preserving row-level paths and results.',
      '',
      'Examples:',
      '  pp dv rows apply --environment dev --file ./account-ops.yaml',
      '  pp dv rows apply --environment dev --file ./account-ops.yaml --continue-on-error --solution Core',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}

export function printDataverseMetadataHelp(): void {
  process.stdout.write(
    [
      'Usage: dv metadata <command> [options]',
      '',
      'Read commands:',
      '  tables                                  list Dataverse tables',
      '  table <logicalName>                     inspect one table definition',
      '  columns <tableLogicalName>              list columns for a table',
      '  column <tableLogicalName> <column>      inspect one column definition',
      '  option-set <name>                       inspect one global option set',
      '  relationship <schemaName>               inspect one relationship definition',
      '  snapshot <kind> ...                     save stable table, columns, option-set, or relationship snapshots',
      '  diff --left FILE --right FILE           compare two saved metadata snapshots',
      '  schema <create-table|add-column>        emit validator-derived metadata contract schema',
      '  init <create-table|add-column>          print a starter metadata spec scaffold',
      '',
      'Write commands:',
      '  apply --file FILE                       apply a metadata manifest',
      '  create-table --file FILE                create a new Dataverse table',
      '  update-table <table> --file FILE        update a table definition',
      '  add-column <table> --file FILE          create a new column on an existing table',
      '  update-column <table> <column> --file FILE',
      '                                         update an existing column definition',
      '  create-option-set --file FILE           create a global option set',
      '  update-option-set --file FILE           update a global option set',
      '  create-relationship --file FILE         create a one-to-many relationship',
      '  update-relationship <schemaName> --kind one-to-many|many-to-many --file FILE',
      '                                         update an existing relationship',
      '  create-many-to-many --file FILE         create a many-to-many relationship',
      '  create-customer-relationship --file FILE',
      '                                         create a customer lookup and paired relationships',
      '',
      'Notes:',
      '  - Read commands accept `--environment ALIAS` plus `--select`, `--expand`, `--filter`, and view flags where supported.',
      '  - Write commands accept `--environment ALIAS`, `--file FILE`, optional `--solution UNIQUE_NAME`, and publish controls.',
      '  - Write results include `entitySummary`; `dv metadata apply` also includes a grouped `summary` for touched tables, columns, relationships, and option sets.',
      '',
      'Examples:',
      '  pp dv metadata tables --environment dev --top 10 --format json',
      '  pp dv metadata column account name --environment dev --view detailed',
      '  pp dv metadata schema create-table --format json-schema',
      '  pp dv metadata schema add-column --kind string --format json-schema',
      '  pp dv metadata init create-table',
      '  pp dv metadata init add-column --kind choice',
      '  pp dv metadata create-table --environment dev --solution Core --file ./specs/project.table.yaml --format json',
      '  pp dv metadata create-relationship --environment dev --solution Core --file ./specs/project-account.relationship.yaml --format json',
      '',
      'Common output options:',
      '  --format table|json|yaml|ndjson|markdown|raw',
    ].join('\n') + '\n'
  );
}
