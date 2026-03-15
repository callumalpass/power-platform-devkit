import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';

const execFileAsync = promisify(execFile);

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

async function findBinary(name: string): Promise<string> {
  const root = workspaceRoot();
  if (root) {
    const local = join(root, 'node_modules', '.bin', name);
    try {
      await access(local);
      return local;
    } catch {}
  }
  return name; // fall back to PATH
}

export async function findLspBinary(name: string): Promise<string> {
  return findBinary(name);
}

export async function runPp(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const bin = await findBinary('pp');
  return execFileAsync(bin, args, { cwd: workspaceRoot() });
}

export async function runPpJson<T>(args: string[]): Promise<T> {
  const { stdout } = await runPp([...args, '--format', 'json']);
  return JSON.parse(stdout) as T;
}
