using System.Globalization;
using System.Text.Json;
using Microsoft.PowerFx;
using Microsoft.PowerFx.Syntax;

var serializerOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    PropertyNameCaseInsensitive = true,
};

var request = await ReadRequestAsync(args, serializerOptions);

if (request?.Expression is null)
{
await JsonSerializer.SerializeAsync(
    Console.OpenStandardOutput(),
    new BridgeResponse(false, null, ["Missing expression input."]),
    serializerOptions);
    return;
}

var engine = new Engine();
var parse = engine.Parse(
    request.Expression,
    new ParserOptions(CultureInfo.InvariantCulture, request.AllowsSideEffects)
    {
        NumberIsFloat = true,
    });

var errors = parse.Errors.Select((error) => error.Message).ToArray();
var ast = AstSerializer.Serialize(parse.Root, request.Expression);

await JsonSerializer.SerializeAsync(
    Console.OpenStandardOutput(),
    new BridgeResponse(parse.IsSuccess, ast, errors),
    serializerOptions);

static async Task<ParseRequest?> ReadRequestAsync(string[] args, JsonSerializerOptions serializerOptions)
{
    var base64Index = Array.IndexOf(args, "--request-base64");
    if (base64Index >= 0 && base64Index + 1 < args.Length)
    {
        try
        {
            var json = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(args[base64Index + 1]));
            return JsonSerializer.Deserialize<ParseRequest>(json, serializerOptions);
        }
        catch (Exception)
        {
            return null;
        }
    }

    return await JsonSerializer.DeserializeAsync<ParseRequest>(Console.OpenStandardInput(), serializerOptions);
}

internal sealed record ParseRequest(string Expression, bool AllowsSideEffects);

internal sealed record BridgeResponse(bool Success, object? Ast, IReadOnlyList<string> Errors);

internal static class AstSerializer
{
    public static object Serialize(TexlNode? node, string source)
    {
        if (node is null)
        {
            return Unsupported("Empty Power Fx parse tree.", 0, 0);
        }

        switch (node)
        {
            case FirstNameNode firstName:
                return Identifier(firstName.Ident, source);
            case ParentNode:
                return Identifier("Parent", false, node.GetCompleteSpan());
            case SelfNode:
                return Identifier("Self", false, node.GetCompleteSpan());
            case StrLitNode str:
                return new
                {
                    kind = "StringLiteral",
                    value = str.Value,
                    span = Span(str.GetCompleteSpan()),
                };
            case NumLitNode number:
                return new
                {
                    kind = "NumberLiteral",
                    value = number.ActualNumValue,
                    span = Span(number.GetCompleteSpan()),
                };
            case BoolLitNode boolean:
                return new
                {
                    kind = "BooleanLiteral",
                    value = boolean.Value,
                    span = Span(boolean.GetCompleteSpan()),
                };
            case CallNode call:
                return new
                {
                    kind = "CallExpression",
                    callee = Identifier(call.Head, source),
                    arguments = call.Args.ChildNodes.Select(child => Serialize(child, source)).ToArray(),
                    span = Span(call.GetCompleteSpan()),
                };
            case DottedNameNode dotted:
                return new
                {
                    kind = "MemberExpression",
                    @object = Serialize(dotted.Left, source),
                    property = Identifier(dotted.Right, source),
                    span = Span(dotted.GetCompleteSpan()),
                };
            case RecordNode record:
                return new
                {
                    kind = "RecordExpression",
                    fields = record.ChildNodes.Select((child, index) => new
                    {
                        name = Identifier(record.Ids[index], source),
                        value = Serialize(child, source),
                    }).ToArray(),
                    span = Span(record.GetCompleteSpan()),
                };
            case BinaryOpNode binary:
                return new
                {
                    kind = "BinaryExpression",
                    @operator = SerializeBinaryOperator(binary.Op),
                    left = Serialize(binary.Left, source),
                    right = Serialize(binary.Right, source),
                    span = Span(binary.GetCompleteSpan()),
                };
            case UnaryOpNode unary:
                return new
                {
                    kind = "UnaryExpression",
                    @operator = SerializeUnaryOperator(unary.Op),
                    argument = Serialize(unary.Child, source),
                    span = Span(unary.GetCompleteSpan()),
                };
            case VariadicOpNode variadic when variadic.Op == VariadicOp.Chain:
                return new
                {
                    kind = "ChainExpression",
                    expressions = variadic.ChildNodes.Select(child => Serialize(child, source)).ToArray(),
                    span = Span(variadic.GetCompleteSpan()),
                };
            case BlankNode blank:
                return Unsupported("Blank node mapping is not implemented.", blank.GetCompleteSpan().Min, blank.GetCompleteSpan().Lim);
            case StrInterpNode interpolation:
                return Unsupported("String interpolation mapping is not implemented.", interpolation.GetCompleteSpan().Min, interpolation.GetCompleteSpan().Lim);
            case TableNode table:
                return Unsupported("Table expression mapping is not implemented.", table.GetCompleteSpan().Min, table.GetCompleteSpan().Lim);
            case AsNode asNode:
                return Unsupported("As-expression mapping is not implemented.", asNode.GetCompleteSpan().Min, asNode.GetCompleteSpan().Lim);
            case ErrorNode error:
                return Unsupported("Power Fx parse tree contains an error node.", error.GetCompleteSpan().Min, error.GetCompleteSpan().Lim);
            default:
                return Unsupported($"Unsupported Power Fx syntax node {node.Kind}.", node.GetCompleteSpan().Min, node.GetCompleteSpan().Lim);
        }
    }

    private static object Identifier(Identifier identifier, string source)
    {
        var quoted = IsQuoted(source, identifier.Span.Min, identifier.Span.Lim);
        return Identifier(identifier.Name.Value, quoted, identifier.Span);
    }

    private static object Identifier(string name, bool quoted, Span span) => new
    {
        kind = "Identifier",
        name,
        quoted,
        span = Span(span),
    };

    private static object Unsupported(string reason, int start, int end) => new
    {
        kind = "UnsupportedExpression",
        reason,
        span = new
        {
            start,
            end,
        },
    };

    private static bool IsQuoted(string source, int start, int end)
    {
        if (start < 0 || end <= start || end > source.Length)
        {
            return false;
        }

        var raw = source[start..end];
        return raw.StartsWith("'") || raw.StartsWith("[");
    }

    private static string SerializeBinaryOperator(BinaryOp op) => op switch
    {
        BinaryOp.Or => "Or",
        BinaryOp.And => "And",
        BinaryOp.Concat => "&",
        BinaryOp.Add => "+",
        BinaryOp.Mul => "*",
        BinaryOp.Div => "/",
        BinaryOp.Power => "^",
        BinaryOp.Equal => "=",
        BinaryOp.NotEqual => "<>",
        BinaryOp.Less => "<",
        BinaryOp.LessEqual => "<=",
        BinaryOp.Greater => ">",
        BinaryOp.GreaterEqual => ">=",
        BinaryOp.In => "in",
        BinaryOp.Exactin => "exactin",
        _ => "UnsupportedBinaryOp",
    };

    private static string SerializeUnaryOperator(UnaryOp op) => op switch
    {
        UnaryOp.Not => "!",
        UnaryOp.Minus => "-",
        UnaryOp.Percent => "%",
        _ => "UnsupportedUnaryOp",
    };

    private static object Span(Span span) => new
    {
        start = span.Min,
        end = span.Lim,
    };
}
