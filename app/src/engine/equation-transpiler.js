/**
 * Transpile mathjs expressions into raw JS function body strings
 * that can run inside an AudioWorklet without the mathjs library.
 *
 * The generated function expects a scope object with:
 *   { x, t, freq, note, velocity, a, b, c, d, pi, e }
 *
 * Strategy: parse the mathjs expression string and convert known
 * functions/operators to plain JavaScript. If transpilation fails
 * (unsupported syntax), returns null so the caller can fall back.
 */

import { parse } from "mathjs";

/**
 * Transpile a mathjs expression string into a JS function body string.
 *
 * @param {string} expr - The mathjs expression (e.g. "sin(x) + a * cos(b * x)")
 * @returns {{ ok: true, body: string } | { ok: false, error: string }}
 */
export function transpileEquation(expr) {
  try {
    const tree = parse(expr);
    const jsBody = nodeToJS(tree);
    // Wrap in a function that takes the scope and returns the value
    // We also guard against non-finite results
    const body = `
      const {x, t, freq, note, velocity, a, b, c, d} = scope;
      const pi = Math.PI, e = Math.E;
      const raw = ${jsBody};
      return Number.isFinite(raw) ? raw : 0;
    `;
    // Validate the generated code compiles (quick syntax check)
    new Function("scope", body);
    return { ok: true, body };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

/* ── AST node → JS conversion ──────────────────────────────────── */

const KNOWN_FUNCTIONS = new Set([
  "sin", "cos", "tan", "asin", "acos", "atan", "atan2",
  "sinh", "cosh", "tanh",
  "sqrt", "cbrt", "abs", "sign", "floor", "ceil", "round",
  "log", "log2", "log10", "exp",
  "min", "max", "pow",
  "random",
]);

// mathjs function name → JS equivalent
const FN_MAP = {
  sin: "Math.sin",
  cos: "Math.cos",
  tan: "Math.tan",
  asin: "Math.asin",
  acos: "Math.acos",
  atan: "Math.atan",
  atan2: "Math.atan2",
  sinh: "Math.sinh",
  cosh: "Math.cosh",
  tanh: "Math.tanh",
  sqrt: "Math.sqrt",
  cbrt: "Math.cbrt",
  abs: "Math.abs",
  sign: "Math.sign",
  floor: "Math.floor",
  ceil: "Math.ceil",
  round: "Math.round",
  log: "Math.log",
  log2: "Math.log2",
  log10: "Math.log10",
  exp: "Math.exp",
  min: "Math.min",
  max: "Math.max",
  pow: "Math.pow",
  random: "Math.random",
};

const KNOWN_SYMBOLS = new Set([
  "x", "t", "freq", "note", "velocity", "a", "b", "c", "d", "pi", "e",
]);

function nodeToJS(node) {
  switch (node.type) {
    case "ConstantNode":
      return String(node.value);

    case "SymbolNode": {
      const name = node.name;
      if (name === "pi") return "pi";
      if (name === "e") return "e";
      if (KNOWN_SYMBOLS.has(name)) return name;
      throw new Error(`Unknown symbol: ${name}`);
    }

    case "OperatorNode": {
      const op = node.op;
      const args = node.args;
      if (args.length === 1) {
        // Unary
        if (op === "-" || op === "+") return `(${op}${nodeToJS(args[0])})`;
        if (op === "!") return `(${nodeToJS(args[0])} === 0 ? 1 : 0)`; // mathjs factorial not supported; treat as logical not
        throw new Error(`Unsupported unary operator: ${op}`);
      }
      if (args.length === 2) {
        const left = nodeToJS(args[0]);
        const right = nodeToJS(args[1]);
        if (op === "^") return `Math.pow(${left}, ${right})`;
        if (["+", "-", "*", "/", "%"].includes(op)) return `(${left} ${op} ${right})`;
        throw new Error(`Unsupported binary operator: ${op}`);
      }
      throw new Error(`Unsupported operator arity: ${args.length}`);
    }

    case "FunctionNode": {
      const fnName = node.fn.name || node.fn;
      if (typeof fnName === "string" && KNOWN_FUNCTIONS.has(fnName)) {
        const jsArgs = node.args.map(nodeToJS).join(", ");
        return `${FN_MAP[fnName]}(${jsArgs})`;
      }
      // mod() → %
      if (fnName === "mod" && node.args.length === 2) {
        return `(${nodeToJS(node.args[0])} % ${nodeToJS(node.args[1])})`;
      }
      throw new Error(`Unsupported function: ${fnName}`);
    }

    case "ParenthesisNode":
      return `(${nodeToJS(node.content)})`;

    case "ConditionalNode":
      return `(${nodeToJS(node.condition)} ? ${nodeToJS(node.trueExpr)} : ${nodeToJS(node.falseExpr)})`;

    case "AccessorNode":
      throw new Error("Property access not supported in synth equations");

    case "ArrayNode":
      throw new Error("Arrays not supported in synth equations");

    default:
      throw new Error(`Unsupported node type: ${node.type}`);
  }
}
