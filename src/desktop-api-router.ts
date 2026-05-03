import type { URL } from 'node:url';

export type DesktopRoutePath = string | RegExp;

export interface DesktopRoute<TContext, TResponse> {
  method: string;
  path: DesktopRoutePath;
  handler: (url: URL, body: unknown, context: TContext) => TResponse | Promise<TResponse>;
}

export function findDesktopRoute<TContext, TResponse>(routes: Array<DesktopRoute<TContext, TResponse>>, method: string, pathname: string): DesktopRoute<TContext, TResponse> | undefined {
  return routes.find((route) => route.method === method && routeMatches(route.path, pathname));
}

export function routeMatches(path: DesktopRoutePath, pathname: string): boolean {
  return typeof path === 'string' ? path === pathname : path.test(pathname);
}
