export type FlowExpressionNode =
  | FlowExpressionIdentifierNode
  | FlowExpressionStringNode
  | FlowExpressionNumberNode
  | FlowExpressionLiteralNode
  | FlowExpressionCallNode
  | FlowExpressionAccessNode
  | FlowExpressionArrayNode
  | FlowExpressionUnknownNode;

export type FlowExpressionAccessProperty = { kind: 'string'; value: string } | { kind: 'identifier'; value: string } | { kind: 'number'; value: number } | { kind: 'unknown' };

type FlowExpressionBaseNode = {
  start: number;
  end: number;
};

export type FlowExpressionIdentifierNode = FlowExpressionBaseNode & {
  kind: 'identifier';
  name: string;
};

export type FlowExpressionStringNode = FlowExpressionBaseNode & {
  kind: 'string';
  value: string;
  closed: boolean;
};

export type FlowExpressionNumberNode = FlowExpressionBaseNode & {
  kind: 'number';
  value: number;
};

export type FlowExpressionLiteralNode = FlowExpressionBaseNode & {
  kind: 'literal';
  value: boolean | null;
};

export type FlowExpressionCallNode = FlowExpressionBaseNode & {
  kind: 'call';
  name: string;
  args: FlowExpressionNode[];
  openParen: number;
  closeParen?: number;
};

export type FlowExpressionAccessNode = FlowExpressionBaseNode & {
  kind: 'access';
  target: FlowExpressionNode;
  optional: boolean;
  accessor: 'bracket' | 'dot';
  property: FlowExpressionAccessProperty;
};

export type FlowExpressionArrayNode = FlowExpressionBaseNode & {
  kind: 'array';
  elements: FlowExpressionNode[];
  closed: boolean;
};

export type FlowExpressionUnknownNode = FlowExpressionBaseNode & {
  kind: 'unknown';
};

export function parseFlowExpression(text: string): FlowExpressionNode | null {
  const parser = new FlowExpressionParser(text);
  return parser.parse();
}

export function findDeepestFlowExpressionNodeEndingAt(node: FlowExpressionNode | null, end: number): FlowExpressionNode | null {
  if (!node) return null;
  let best: FlowExpressionNode | null = node.end === end ? node : null;
  for (const child of flowExpressionChildren(node)) {
    const candidate = findDeepestFlowExpressionNodeEndingAt(child, end);
    if (!candidate) continue;
    if (!best || candidate.start >= best.start) best = candidate;
  }
  return best;
}

export function flowExpressionAccessSegments(node: FlowExpressionNode): string[] {
  if (node.kind !== 'access') return [];
  const parent = flowExpressionAccessSegments(node.target);
  if (node.property.kind !== 'string' && node.property.kind !== 'identifier') return parent;
  return [...parent, node.property.value];
}

export function flowExpressionNodeText(source: string, node: FlowExpressionNode): string {
  return source.slice(node.start, node.end);
}

function flowExpressionChildren(node: FlowExpressionNode): FlowExpressionNode[] {
  if (node.kind === 'call') return node.args;
  if (node.kind === 'access') return [node.target];
  if (node.kind === 'array') return node.elements;
  return [];
}

class FlowExpressionParser {
  private position = 0;

  constructor(private readonly text: string) {}

  parse(): FlowExpressionNode | null {
    this.skipWhitespace();
    const node = this.parseExpression(new Set());
    return node;
  }

  private parseExpression(stops: Set<string>): FlowExpressionNode | null {
    this.skipWhitespace();
    if (this.isAtStop(stops) || this.atEnd()) return null;
    let node = this.parsePrimary(stops);
    if (!node) node = this.parseUnknown(stops);
    if (!node) return null;
    node = this.parsePostfix(node, stops);

    while (!this.atEnd()) {
      this.skipWhitespace();
      if (this.isAtStop(stops)) break;
      if (!this.isOperatorStart(this.peek())) break;
      const start: number = node.start;
      this.readOperator();
      const right = this.parseExpression(stops);
      node = {
        kind: 'unknown',
        start,
        end: right?.end ?? this.position
      };
    }
    return node;
  }

  private parsePrimary(stops: Set<string>): FlowExpressionNode | null {
    const char = this.peek();
    if (!char || stops.has(char)) return null;
    if (char === "'") return this.parseString();
    if (char === '[') return this.parseArray();
    if (isIdentifierStart(char)) return this.parseIdentifierOrCall();
    if (char === '-' || isDigit(char)) return this.parseNumber();
    return null;
  }

  private parseIdentifierOrCall(): FlowExpressionNode {
    const start = this.position;
    const name = this.readIdentifier();
    const lowerName = name.toLowerCase();
    if (lowerName === 'true' || lowerName === 'false' || lowerName === 'null') {
      return {
        kind: 'literal',
        value: lowerName === 'null' ? null : lowerName === 'true',
        start,
        end: this.position
      };
    }

    this.skipWhitespace();
    if (this.peek() !== '(') {
      return {
        kind: 'identifier',
        name,
        start,
        end: this.position
      };
    }

    const openParen = this.position;
    this.position += 1;
    const args: FlowExpressionNode[] = [];
    let closeParen: number | undefined;

    while (!this.atEnd()) {
      this.skipWhitespace();
      if (this.peek() === ')') {
        closeParen = this.position;
        this.position += 1;
        break;
      }
      if (this.peek() === ',') {
        this.position += 1;
        continue;
      }

      const arg = this.parseExpression(new Set([',', ')']));
      if (arg) args.push(arg);
      this.skipWhitespace();
      if (this.peek() === ',') {
        this.position += 1;
        continue;
      }
      if (this.peek() === ')') {
        closeParen = this.position;
        this.position += 1;
        break;
      }
      if (!arg && !this.atEnd()) this.position += 1;
      if (this.isAtStop(new Set([',', ')']))) continue;
      if (this.atEnd()) break;
    }

    return {
      kind: 'call',
      name,
      args,
      openParen,
      closeParen,
      start,
      end: this.position
    };
  }

  private parseString(): FlowExpressionStringNode {
    const start = this.position;
    this.position += 1;
    let value = '';
    let closed = false;
    while (!this.atEnd()) {
      const char = this.text[this.position]!;
      if (char === "'") {
        if (this.text[this.position + 1] === "'") {
          value += "'";
          this.position += 2;
          continue;
        }
        this.position += 1;
        closed = true;
        break;
      }
      value += char;
      this.position += 1;
    }
    return {
      kind: 'string',
      value,
      closed,
      start,
      end: this.position
    };
  }

  private parseNumber(): FlowExpressionNumberNode | null {
    const start = this.position;
    if (this.peek() === '-') this.position += 1;
    let hasDigit = false;
    while (isDigit(this.peek())) {
      hasDigit = true;
      this.position += 1;
    }
    if (this.peek() === '.') {
      this.position += 1;
      while (isDigit(this.peek())) {
        hasDigit = true;
        this.position += 1;
      }
    }
    if (!hasDigit) {
      this.position = start;
      return null;
    }
    const raw = this.text.slice(start, this.position);
    return {
      kind: 'number',
      value: Number(raw),
      start,
      end: this.position
    };
  }

  private parseArray(): FlowExpressionArrayNode {
    const start = this.position;
    this.position += 1;
    const elements: FlowExpressionNode[] = [];
    let closed = false;
    while (!this.atEnd()) {
      this.skipWhitespace();
      if (this.peek() === ']') {
        closed = true;
        this.position += 1;
        break;
      }
      if (this.peek() === ',') {
        this.position += 1;
        continue;
      }
      const element = this.parseExpression(new Set([',', ']']));
      if (element) elements.push(element);
      this.skipWhitespace();
      if (this.peek() === ',') this.position += 1;
      else if (this.peek() === ']') {
        closed = true;
        this.position += 1;
        break;
      } else if (!element && !this.atEnd()) {
        this.position += 1;
      }
    }
    return {
      kind: 'array',
      elements,
      closed,
      start,
      end: this.position
    };
  }

  private parsePostfix(node: FlowExpressionNode, stops: Set<string>): FlowExpressionNode {
    let current = node;
    while (!this.atEnd()) {
      this.skipWhitespace();
      if (this.isAtStop(stops)) break;
      const start = this.position;
      let optional = false;
      if (this.peek() === '?') {
        const next = this.text[this.position + 1];
        if (next !== '[' && next !== '.') break;
        optional = true;
        this.position += 1;
      }

      if (this.peek() === '[') {
        current = this.parseBracketAccess(current, optional);
        continue;
      }
      if (this.peek() === '.') {
        current = this.parseDotAccess(current, optional);
        continue;
      }
      if (optional) this.position = start;
      break;
    }
    return current;
  }

  private parseBracketAccess(target: FlowExpressionNode, optional: boolean): FlowExpressionAccessNode {
    this.position += 1;
    this.skipWhitespace();
    let property: FlowExpressionAccessProperty = { kind: 'unknown' };
    if (this.peek() === "'") {
      const value = this.parseString();
      property = { kind: 'string', value: value.value };
    } else if (isDigit(this.peek()) || this.peek() === '-') {
      const value = this.parseNumber();
      property = value ? { kind: 'number', value: value.value } : { kind: 'unknown' };
    } else if (isIdentifierStart(this.peek())) {
      const value = this.readIdentifier();
      property = { kind: 'identifier', value };
    } else {
      const expression = this.parseExpression(new Set([']']));
      if (expression?.kind === 'string') property = { kind: 'string', value: expression.value };
      else if (expression?.kind === 'number') property = { kind: 'number', value: expression.value };
    }
    this.skipWhitespace();
    if (this.peek() === ']') this.position += 1;
    return {
      kind: 'access',
      target,
      optional,
      accessor: 'bracket',
      property,
      start: target.start,
      end: this.position
    };
  }

  private parseDotAccess(target: FlowExpressionNode, optional: boolean): FlowExpressionAccessNode {
    this.position += 1;
    this.skipWhitespace();
    const property = isIdentifierStart(this.peek()) ? { kind: 'identifier' as const, value: this.readIdentifier() } : { kind: 'unknown' as const };
    return {
      kind: 'access',
      target,
      optional,
      accessor: 'dot',
      property,
      start: target.start,
      end: this.position
    };
  }

  private parseUnknown(stops: Set<string>): FlowExpressionUnknownNode | null {
    const start = this.position;
    while (!this.atEnd() && !this.isAtStop(stops)) {
      const char = this.peek();
      if (!char || char === "'" || char === '[' || isIdentifierStart(char)) break;
      this.position += 1;
    }
    if (this.position === start) return null;
    return {
      kind: 'unknown',
      start,
      end: this.position
    };
  }

  private readIdentifier(): string {
    const start = this.position;
    if (!isIdentifierStart(this.peek())) return '';
    this.position += 1;
    while (isIdentifierPart(this.peek())) this.position += 1;
    return this.text.slice(start, this.position);
  }

  private readOperator(): string {
    const start = this.position;
    while (this.isOperatorStart(this.peek())) this.position += 1;
    return this.text.slice(start, this.position);
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.peek() || '')) this.position += 1;
  }

  private isAtStop(stops: Set<string>): boolean {
    const char = this.peek();
    return Boolean(char && stops.has(char));
  }

  private isOperatorStart(char: string | undefined): boolean {
    return Boolean(char && /[+\-*/%<>=!&|:]/.test(char));
  }

  private atEnd(): boolean {
    return this.position >= this.text.length;
  }

  private peek(): string | undefined {
    return this.text[this.position];
  }
}

function isIdentifierStart(char: string | undefined): boolean {
  return Boolean(char && /[A-Za-z_@$]/.test(char));
}

function isIdentifierPart(char: string | undefined): boolean {
  return Boolean(char && /[A-Za-z0-9_@$-]/.test(char));
}

function isDigit(char: string | undefined): boolean {
  return Boolean(char && /[0-9]/.test(char));
}
