import { SharePointService } from '@pp/sharepoint';
import {
  argumentFailure,
  outputFormat,
  positionalArgs,
  printByFormat,
  printFailure,
  printResultDiagnostics,
  readConfigOptions,
  readFlag,
  readNumberFlag,
  readPublicClientLoginOptions,
} from './cli-support';

export async function runSharePointSiteList(args: string[]): Promise<number> {
  const environment = readFlag(args, '--environment');

  if (!environment) {
    return printFailure(argumentFailure('SHAREPOINT_ENVIRONMENT_REQUIRED', 'Usage: sharepoint site list --environment ALIAS [--search TEXT] [--top N] [--resource URL]'));
  }

  const result = await createService(args).listSites(environment, {
    search: readFlag(args, '--search'),
    top: readNumberFlag(args, '--top'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  const format = outputFormat(args, 'json');
  printByFormat(result.data ?? [], format);
  printResultDiagnostics(result, format);
  return 0;
}

export async function runSharePointSiteInspect(args: string[]): Promise<number> {
  const environment = readFlag(args, '--environment');
  const identifier = positionalArgs(args)[0];

  if (!environment || !identifier) {
    return printFailure(argumentFailure('SHAREPOINT_SITE_INSPECT_ARGS_REQUIRED', 'Usage: sharepoint site inspect <site-id|hostname:/path|url> --environment ALIAS [--resource URL]'));
  }

  const result = await createService(args).inspectSite(environment, identifier);

  if (!result.success) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

export async function runSharePointListList(args: string[]): Promise<number> {
  const environment = readFlag(args, '--environment');
  const site = readFlag(args, '--site');

  if (!environment || !site) {
    return printFailure(argumentFailure('SHAREPOINT_LIST_LIST_ARGS_REQUIRED', 'Usage: sharepoint list list --environment ALIAS --site SITE [--top N] [--resource URL]'));
  }

  const result = await createService(args).listLists(environment, site, {
    top: readNumberFlag(args, '--top'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  const format = outputFormat(args, 'json');
  printByFormat(result.data ?? [], format);
  printResultDiagnostics(result, format);
  return 0;
}

export async function runSharePointListItems(args: string[]): Promise<number> {
  const environment = readFlag(args, '--environment');
  const site = readFlag(args, '--site');
  const identifier = positionalArgs(args)[0] ?? readFlag(args, '--list');

  if (!environment || !site || !identifier) {
    return printFailure(argumentFailure('SHAREPOINT_LIST_ITEMS_ARGS_REQUIRED', 'Usage: sharepoint list items <list-id|name> --environment ALIAS --site SITE [--top N] [--resource URL]'));
  }

  const result = await createService(args).listItems(environment, site, identifier, {
    top: readNumberFlag(args, '--top'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  const format = outputFormat(args, 'json');
  printByFormat(result.data ?? [], format);
  printResultDiagnostics(result, format);
  return 0;
}

export async function runSharePointFileList(args: string[]): Promise<number> {
  const environment = readFlag(args, '--environment');
  const site = readFlag(args, '--site');

  if (!environment || !site) {
    return printFailure(argumentFailure('SHAREPOINT_FILE_LIST_ARGS_REQUIRED', 'Usage: sharepoint file list --environment ALIAS --site SITE [--drive NAME_OR_ID] [--path /folder] [--top N] [--resource URL]'));
  }

  const result = await createService(args).listFiles(environment, site, {
    drive: readFlag(args, '--drive'),
    path: readFlag(args, '--path'),
    top: readNumberFlag(args, '--top'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  const format = outputFormat(args, 'json');
  printByFormat(result.data ?? [], format);
  printResultDiagnostics(result, format);
  return 0;
}

export async function runSharePointFileInspect(args: string[]): Promise<number> {
  const environment = readFlag(args, '--environment');
  const site = readFlag(args, '--site');
  const identifier = positionalArgs(args)[0];

  if (!environment || !site || !identifier) {
    return printFailure(argumentFailure('SHAREPOINT_FILE_INSPECT_ARGS_REQUIRED', 'Usage: sharepoint file inspect <item-id|/path|url> --environment ALIAS --site SITE [--drive NAME_OR_ID] [--resource URL]'));
  }

  const result = await createService(args).inspectFile(environment, site, identifier, {
    drive: readFlag(args, '--drive'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  printByFormat(result.data, outputFormat(args, 'json'));
  return 0;
}

export async function runSharePointPermissionList(args: string[]): Promise<number> {
  const environment = readFlag(args, '--environment');
  const site = readFlag(args, '--site');

  if (!environment || !site) {
    return printFailure(
      argumentFailure(
        'SHAREPOINT_PERMISSION_LIST_ARGS_REQUIRED',
        'Usage: sharepoint permission list --environment ALIAS --site SITE [--list LIST] [--file ITEM] [--drive NAME_OR_ID] [--resource URL]'
      )
    );
  }

  const result = await createService(args).listPermissions(environment, site, {
    list: readFlag(args, '--list'),
    file: readFlag(args, '--file'),
    drive: readFlag(args, '--drive'),
  });

  if (!result.success) {
    return printFailure(result);
  }

  const format = outputFormat(args, 'json');
  printByFormat(result.data ?? [], format);
  printResultDiagnostics(result, format);
  return 0;
}

function createService(args: string[]): SharePointService {
  return new SharePointService({
    ...readConfigOptions(args),
    publicClientLoginOptions: readPublicClientLoginOptions(args),
    resource: readFlag(args, '--resource'),
  });
}
