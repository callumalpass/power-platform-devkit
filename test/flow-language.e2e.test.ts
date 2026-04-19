import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { analyzeFlow } from '../src/flow-language.js';

const execFileAsync = promisify(execFile);

function fixturePath(name: string): string {
  return path.resolve(process.cwd(), 'test/fixtures/flows', name);
}

async function readFixture(name: string): Promise<string> {
  return readFile(fixturePath(name), 'utf8');
}

test('analyzeFlow understands a workflow definition wrapper from a real sample', async () => {
  const source = await readFixture('ratings-workflow.json');
  const result = analyzeFlow(source, source.indexOf("Get_records_that_haven"));
  assert.equal(result.summary.wrapperKind, 'definition-wrapper');
  assert.ok(result.summary.actionCount > 5);
  assert.ok(result.summary.variableCount >= 2);
  assert.ok(result.symbols.some((item) => item.kind === 'action' && item.name === 'For_each_record'));
  assert.equal(result.knowledge.level, 'structural');
  assert.equal(findOutlineItem(result.outline, "Get_records_that_haven't_been_published_to_Blob_storage_yet")?.connector, 'azuretables');
  const blobExists = findOutlineItem(result.outline, 'Checks_if__Blob_for_this_record_productId_exists');
  assert.equal(blobExists?.connector, 'AzureBlob');
  assert.equal(blobExists?.inputs?.operationId, 'blobExists');
  assert.equal(blobExists?.inputs?.serviceProviderId, '/serviceProviders/AzureBlob');
});

test('analyzeFlow extracts definitions from ARM template resources', async () => {
  const source = await readFixture('recurrence-template.json');
  const result = analyzeFlow(source, source.indexOf('ExecuteRecurrenceJob'));
  assert.equal(result.summary.wrapperKind, 'arm-template-resource-definition');
  assert.ok(result.summary.actionCount > 3);
  assert.ok(result.outline.length > 0);
});

test('analyzeFlow extracts definitions from serialized Dataverse clientdata', () => {
  const source = JSON.stringify({
    workflowid: '00000000-0000-0000-0000-000000000001',
    name: 'Dataverse Row Flow',
    clientdata: JSON.stringify({
      properties: {
        definition: {
          actions: {
            ComposeValue: {
              type: 'Compose',
              inputs: '@triggerBody()',
              runAfter: {},
            },
            UseValue: {
              type: 'Compose',
              inputs: "@outputs('ComposeValue')",
              runAfter: {
                ComposeValue: ['Succeeded'],
              },
            },
          },
          triggers: {
            manual: {
              type: 'Request',
              inputs: {},
            },
          },
        },
      },
    }),
  }, null, 2);

  const result = analyzeFlow(source, source.indexOf('UseValue'));
  assert.equal(result.summary.wrapperKind, 'clientdata-resource-properties-definition');
  assert.equal(result.summary.triggerCount, 1);
  assert.equal(result.summary.actionCount, 2);
  const useValue = result.symbols.find((item) => item.kind === 'action' && item.name === 'UseValue');
  assert.ok(useValue && useValue.from <= source.indexOf('UseValue') && useValue.to > source.indexOf('UseValue'));
  assert.ok(result.symbols.some((item) => item.kind === 'action' && item.name === 'ComposeValue'));
});

test('analyzeFlow does not approximate structured expression validation offline', () => {
  const source = JSON.stringify({
    definition: {
      triggers: {
        manual: {
          type: 'Request',
          inputs: {},
        },
      },
      actions: {
        CheckValue: {
          type: 'If',
          expression: {
            and: [
              {
                equals: [
                  "@triggerBody()?['status']",
                ],
              },
              {
                madeUpOperator: [
                  true,
                ],
              },
            ],
          },
          actions: {},
          runAfter: {},
        },
      },
    },
  }, null, 2);

  const result = analyzeFlow(source, source.indexOf('madeUpOperator'));
  const codes = new Set(result.diagnostics.map((item) => item.code));
  assert.equal(codes.has('FLOW_STRUCTURED_EXPR_ARGUMENT_INVALID'), false);
  assert.equal(codes.has('FLOW_STRUCTURED_EXPR_OPERATOR_UNKNOWN'), false);
});

test('analyzeFlow keeps structured condition expressions out of offline reference analysis', () => {
  const source = JSON.stringify({
    definition: {
      parameters: {
        targetValue: {
          type: 'String',
        },
      },
      triggers: {
        manual: {
          type: 'Request',
          inputs: {},
        },
      },
      actions: {
        InitCounter: {
          type: 'InitializeVariable',
          inputs: {
            variables: [
              {
                name: 'counter',
                type: 'integer',
                value: 0,
              },
            ],
          },
          runAfter: {},
        },
        PrepareValue: {
          type: 'Compose',
          inputs: 12,
          runAfter: {
            InitCounter: ['Succeeded'],
          },
        },
        CheckValue: {
          type: 'If',
          expression: {
            and: [
              {
                equals: [
                  "@outputs('PrepareValue')",
                  "@parameters('targetValue')",
                ],
              },
              {
                greaterOrEquals: [
                  "@variables('counter')",
                  0,
                ],
              },
            ],
          },
          actions: {},
          runAfter: {
            PrepareValue: ['Succeeded'],
          },
        },
      },
    },
  }, null, 2);

  const result = analyzeFlow(source, source.indexOf('greaterOrEquals'));
  assert.equal(result.references.length, 0);
  assert.ok(result.symbols.some((item) => item.kind === 'parameter' && item.name === 'targetValue'));
  assert.ok(result.symbols.some((item) => item.kind === 'variable' && item.name === 'counter'));
});

test('analyzeFlow does not approximate expression syntax offline', () => {
  const source = JSON.stringify({
    definition: {
      triggers: {
        manual: {
          type: 'Request',
          inputs: {},
        },
      },
      actions: {
        InitText: {
          type: 'InitializeVariable',
          inputs: {
            variables: [
              {
                name: 'text',
                type: 'string',
                value: '',
              },
            ],
          },
          runAfter: {},
        },
        GoodExpression: {
          type: 'Compose',
          inputs: "@concat('literal } brace', split(replace(toLower(variables('text')), 'a', 'b'), ','), 1.2e3)",
          runAfter: {
            InitText: ['Succeeded'],
          },
        },
        BadExpression: {
          type: 'Compose',
          inputs: "@variables('text') trailing",
          runAfter: {
            GoodExpression: ['Succeeded'],
          },
        },
      },
    },
  }, null, 2);

  const result = analyzeFlow(source, source.indexOf('trailing'));
  assert.equal(result.references.length, 0);
  assert.equal(result.diagnostics.some((item) => item.code === 'FLOW_EXPR_TRAILING_TOKEN'), false);
});

test('analyzeFlow does not approximate variable mutation target resolution offline', () => {
  const source = JSON.stringify({
    definition: {
      triggers: {
        manual: {
          type: 'Request',
          inputs: {},
        },
      },
      actions: {
        SetMissingVariable: {
          type: 'SetVariable',
          inputs: {
            name: 'missingVariable',
            value: 1,
          },
          runAfter: {},
        },
      },
    },
  }, null, 2);

  const result = analyzeFlow(source, source.indexOf('missingVariable'));
  assert.equal(result.references.length, 0);
  assert.equal(result.diagnostics.some((item) => item.code === 'FLOW_VARIABLE_UNRESOLVED'), false);
});

test('analyzeFlow suggests workflow expression function snippets', () => {
  const source = JSON.stringify({
    definition: {
      parameters: {
        targetValue: {
          type: 'String',
        },
      },
      triggers: {
        manual: {
          type: 'Request',
          inputs: {},
        },
      },
      actions: {
        InitCounter: {
          type: 'InitializeVariable',
          inputs: {
            variables: [
              {
                name: 'counter',
                type: 'integer',
                value: 0,
              },
            ],
          },
          runAfter: {},
        },
        PrepareValue: {
          type: 'Compose',
          inputs: 12,
          runAfter: {
            InitCounter: ['Succeeded'],
          },
        },
        For_each_record: {
          type: 'Foreach',
          foreach: "@triggerBody()?['value']",
          actions: {},
          runAfter: {
            PrepareValue: ['Succeeded'],
          },
        },
        UseExpression: {
          type: 'Compose',
          inputs: '@trig',
          runAfter: {
            For_each_record: ['Succeeded'],
          },
        },
      },
    },
  }, null, 2);

  const cursor = source.indexOf('@trig') + '@trig'.length;
  const result = analyzeFlow(source, cursor);
  const triggerBody = result.completions.find((item) => item.label === 'triggerBody()');
  const triggerOutputs = result.completions.find((item) => item.label === 'triggerOutputs()');
  assert.equal(triggerBody?.apply, 'triggerBody()');
  assert.equal(triggerBody?.snippet, true);
  assert.equal(triggerOutputs?.snippet, true);
});

test('analyzeFlow completes expression target names by function context', () => {
  const source = JSON.stringify({
    definition: {
      parameters: {
        targetValue: {
          type: 'String',
        },
      },
      triggers: {
        manual: {
          type: 'Request',
          inputs: {},
        },
      },
      actions: {
        InitCounter: {
          type: 'InitializeVariable',
          inputs: {
            variables: [
              {
                name: 'counter',
                type: 'integer',
                value: 0,
              },
            ],
          },
          runAfter: {},
        },
        PrepareValue: {
          type: 'Compose',
          inputs: 12,
          runAfter: {
            InitCounter: ['Succeeded'],
          },
        },
        For_each_record: {
          type: 'Foreach',
          foreach: "@triggerBody()?['value']",
          actions: {},
          runAfter: {
            PrepareValue: ['Succeeded'],
          },
        },
        UseAction: {
          type: 'Compose',
          inputs: "@outputs('Prep",
          runAfter: {
            For_each_record: ['Succeeded'],
          },
        },
        UseLoop: {
          type: 'Compose',
          inputs: "@items('For",
          runAfter: {
            UseAction: ['Succeeded'],
          },
        },
        UseVariable: {
          type: 'Compose',
          inputs: "@variables('cou",
          runAfter: {
            UseLoop: ['Succeeded'],
          },
        },
        UseParameter: {
          type: 'Compose',
          inputs: "@parameters('tar",
          runAfter: {
            UseVariable: ['Succeeded'],
          },
        },
      },
    },
  }, null, 2);

  const actionResult = analyzeFlow(source, source.indexOf("@outputs('Prep") + "@outputs('Prep".length);
  assert.ok(actionResult.completions.some((item) => item.label === 'PrepareValue' && item.type === 'action'));

  const loopResult = analyzeFlow(source, source.indexOf("@items('For") + "@items('For".length);
  assert.ok(loopResult.completions.some((item) => item.label === 'For_each_record'));
  assert.equal(loopResult.completions.some((item) => item.label === 'PrepareValue'), false);

  const variableResult = analyzeFlow(source, source.indexOf("@variables('cou") + "@variables('cou".length);
  assert.ok(variableResult.completions.some((item) => item.label === 'counter' && item.type === 'variable'));

  const parameterResult = analyzeFlow(source, source.indexOf("@parameters('tar") + "@parameters('tar".length);
  assert.ok(parameterResult.completions.some((item) => item.label === 'targetValue' && item.type === 'parameter'));
});

test('analyzeFlow leaves reference validation to canonical Power Automate checks', async () => {
  const source = await readFixture('broken-power-automate-wrapper.json');
  const result = analyzeFlow(source, source.indexOf("DoesNotExist"));
  const codes = new Set(result.diagnostics.map((item) => item.code));
  assert.equal(codes.has('FLOW_REFERENCE_UNRESOLVED'), false);
  assert.equal(codes.has('FLOW_RUN_AFTER_TARGET_MISSING'), false);
});

test('pp flow help only documents the Flow API request shortcut', async () => {
  const cliEntry = path.resolve(process.cwd(), '.tmp-test/src/index.js');
  const { stdout } = await execFileAsync('node', [cliEntry, 'flow', '--help'], { cwd: process.cwd() });
  assert.match(stdout, /Power Automate request shortcut/);
  assert.match(stdout, /pp flow <path> --env ALIAS/);
  assert.doesNotMatch(stdout, /pp flow validate/);
  assert.doesNotMatch(stdout, /pp flow inspect/);
  assert.doesNotMatch(stdout, /pp flow symbols/);
  assert.doesNotMatch(stdout, /pp flow explain/);
});

function findOutlineItem(items: ReturnType<typeof analyzeFlow>['outline'], name: string): ReturnType<typeof analyzeFlow>['outline'][number] | undefined {
  for (const item of items) {
    if (item.name === name) return item;
    const child = item.children ? findOutlineItem(item.children, name) : undefined;
    if (child) return child;
  }
  return undefined;
}
