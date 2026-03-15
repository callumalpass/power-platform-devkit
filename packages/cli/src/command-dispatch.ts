export interface CommandRoute {
  name?: string;
  aliases?: readonly string[];
  help?: () => void;
  run?: (args: string[]) => Promise<number>;
  delegate?: boolean;
  children?: readonly CommandRoute[];
  defaultCommand?: {
    run(args: string[]): Promise<number>;
    help?: () => void;
  };
  unknownExitCode?: number;
}

export async function dispatchCommandRoute(route: CommandRoute, args: string[]): Promise<number> {
  const [command, ...rest] = args;

  if (!command || isHelpToken(command)) {
    route.help?.();
    return 0;
  }

  const child = findChild(route, command);

  if (!child) {
    if (route.defaultCommand) {
      if (args.includes('--help') || args.includes('help')) {
        route.defaultCommand.help?.();
        return 0;
      }

      return route.defaultCommand.run(args);
    }

    route.help?.();
    return route.unknownExitCode ?? 1;
  }

  if (child.children?.length) {
    return dispatchCommandRoute(child, rest);
  }

  if (!child.delegate && (rest.includes('--help') || rest.includes('help'))) {
    child.help?.();
    return 0;
  }

  return child.run ? child.run(rest) : 1;
}

function findChild(route: CommandRoute, command: string): CommandRoute | undefined {
  return route.children?.find((child) => child.name === command || child.aliases?.includes(command));
}

function isHelpToken(value: string): boolean {
  return value === 'help' || value === '--help';
}
