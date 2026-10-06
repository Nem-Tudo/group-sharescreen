// The room's spreadsheet (see lib/roomTools.ts): its model, the changes made
// to it — the mirror of the API's roomTools.ts, which applies the same ones,
// so this must stay in step with it — and the formulas, which only the
// clients work out (the server keeps what was typed).

export const MAX_SHEET_ROWS = 500;
export const MAX_SHEET_COLS = 52;
export const MAX_SHEET_CELLS = 20_000;
export const MAX_CELL_LENGTH = 2_000;
export const DEFAULT_COL_WIDTH = 96;

export type CellAlign = "left" | "center" | "right";

export type SheetCell = {
  v: string;
  b?: boolean;
  i?: boolean;
  bg?: string;
  color?: string;
  align?: CellAlign;
};

export type SheetData = {
  rows: number;
  cols: number;
  cells: Record<string, SheetCell>;
  colWidths: Record<string, number>;
};

export type CellStyle = {
  b?: boolean | null;
  i?: boolean | null;
  bg?: string | null;
  color?: string | null;
  align?: CellAlign | null;
};

export type SheetChange =
  | { op: "set"; cell: string; v: string }
  | { op: "fill"; cell: string; values: string[][] }
  | { op: "style"; cells: string[]; style: CellStyle }
  | { op: "size"; rows: number; cols: number }
  | { op: "width"; col: number; width: number }
  | { op: "insert" | "delete"; axis: "row" | "col"; at: number };

export function cellKey(row: number, col: number): string {
  return `${row},${col}`;
}

/** "A", "B", … "Z", "AA", … */
export function colName(col: number): string {
  let name = "";
  let n = col + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function colIndex(name: string): number {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** "B3" for row 2, column 1. */
export function cellName(row: number, col: number): string {
  return `${colName(col)}${row + 1}`;
}

function inRange(key: string, rows: number, cols: number): boolean {
  const [r, c] = key.split(",").map(Number);
  return r < rows && c < cols;
}

function isEmpty(cell: SheetCell): boolean {
  return !cell.v && !cell.b && !cell.i && !cell.bg && !cell.color && !cell.align;
}

/**
 * Applies a change, returning the new sheet — or the same one when nothing
 * changed. Immutable, unlike the server's, but the same rules.
 */
export function applySheetChange<T extends SheetData>(sheet: T, change: SheetChange): T {
  switch (change.op) {
    case "set": {
      if (!inRange(change.cell, sheet.rows, sheet.cols)) return sheet;
      const current = sheet.cells[change.cell];
      if ((current?.v ?? "") === change.v) return sheet;
      if (!current && Object.keys(sheet.cells).length >= MAX_SHEET_CELLS) return sheet;
      const cells = { ...sheet.cells };
      const next = { ...current, v: change.v };
      if (isEmpty(next)) delete cells[change.cell];
      else cells[change.cell] = next;
      return { ...sheet, cells };
    }
    case "fill": {
      const [row, col] = change.cell.split(",").map(Number);
      let next = sheet;
      change.values.forEach((line, r) =>
        line.forEach((v, c) => {
          next = applySheetChange(next, { op: "set", cell: cellKey(row + r, col + c), v });
        })
      );
      return next;
    }
    case "style": {
      const cells = { ...sheet.cells };
      let changed = false;
      for (const key of change.cells) {
        if (!inRange(key, sheet.rows, sheet.cols)) continue;
        const current = cells[key];
        if (!current && Object.keys(cells).length >= MAX_SHEET_CELLS) break;
        const next: SheetCell = { ...(current ?? { v: "" }) };
        for (const [field, value] of Object.entries(change.style) as [keyof CellStyle, unknown][]) {
          if (value === null || value === false) delete next[field];
          else (next as unknown as Record<string, unknown>)[field] = value;
        }
        if (isEmpty(next)) delete cells[key];
        else cells[key] = next;
        changed = true;
      }
      return changed ? { ...sheet, cells } : sheet;
    }
    case "size": {
      if (change.rows === sheet.rows && change.cols === sheet.cols) return sheet;
      const cells = Object.fromEntries(Object.entries(sheet.cells).filter(([key]) => inRange(key, change.rows, change.cols)));
      const colWidths = Object.fromEntries(Object.entries(sheet.colWidths).filter(([col]) => Number(col) < change.cols));
      return { ...sheet, rows: change.rows, cols: change.cols, cells, colWidths };
    }
    case "width": {
      if (change.col >= sheet.cols || sheet.colWidths[change.col] === change.width) return sheet;
      return { ...sheet, colWidths: { ...sheet.colWidths, [change.col]: change.width } };
    }
    case "insert":
    case "delete": {
      const row = change.axis === "row";
      const limit = row ? sheet.rows : sheet.cols;
      if (change.at >= limit) return sheet;
      if (change.op === "insert" && limit >= (row ? MAX_SHEET_ROWS : MAX_SHEET_COLS)) return sheet;
      if (change.op === "delete" && limit <= 1) return sheet;
      const shift = change.op === "insert" ? 1 : -1;
      const from = change.op === "delete" ? change.at + 1 : change.at;
      const cells: Record<string, SheetCell> = {};
      for (const [key, cell] of Object.entries(sheet.cells)) {
        const [r, c] = key.split(",").map(Number);
        const index = row ? r : c;
        if (change.op === "delete" && index === change.at) continue;
        const moved = index >= from ? index + shift : index;
        cells[row ? cellKey(moved, c) : cellKey(r, moved)] = cell;
      }
      if (row) return { ...sheet, cells, rows: sheet.rows + shift };
      const colWidths: Record<string, number> = {};
      for (const [col, width] of Object.entries(sheet.colWidths)) {
        const index = Number(col);
        if (change.op === "delete" && index === change.at) continue;
        colWidths[index >= from ? index + shift : index] = width;
      }
      return { ...sheet, cells, colWidths, cols: sheet.cols + shift };
    }
  }
}

/** Whether applying `change` twice is the same as once — what may be shown before the server answers. */
export function changeIsIdempotent(change: SheetChange): boolean {
  return change.op !== "insert" && change.op !== "delete";
}

// --- Formulas ----------------------------------------------------------------
//
// "=" and then an expression: numbers, "texto", cell references (A1, $A$1),
// ranges (A1:B5), + - * / ^ & (joining text), comparisons, and functions —
// with their Portuguese names as Excel uses them in Portuguese, and the
// English ones. Decimal comma or point. What goes wrong is shown as Excel
// shows it: #REF!, #DIV/0!, #NOME?, #VALOR!, #CICLO!.

export type CellValue = number | string | boolean;
type Value = CellValue | CellValue[];

class FormulaError extends Error {}

const ERRORS = {
  ref: "#REF!",
  div0: "#DIV/0!",
  name: "#NOME?",
  value: "#VALOR!",
  cycle: "#CICLO!",
  na: "#N/D",
} as const;

type Token =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "ref"; v: string }
  | { t: "range"; from: string; to: string }
  | { t: "name"; v: string }
  | { t: "op"; v: string }
  | { t: "(" }
  | { t: ")" }
  | { t: "sep" };

const REF = /^\$?([A-Za-z]{1,2})\$?(\d{1,4})/;

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " ") {
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let text = "";
      while (j < src.length) {
        if (src[j] === '"' && src[j + 1] === '"') {
          text += '"';
          j += 2;
        } else if (src[j] === '"') break;
        else text += src[j++];
      }
      tokens.push({ t: "str", v: text });
      i = j + 1;
      continue;
    }
    const rest = src.slice(i);
    const range = /^(\$?[A-Za-z]{1,2}\$?\d{1,4}):(\$?[A-Za-z]{1,2}\$?\d{1,4})/.exec(rest);
    if (range) {
      tokens.push({ t: "range", from: range[1], to: range[2] });
      i += range[0].length;
      continue;
    }
    const num = /^\d+([.,]\d+)?/.exec(rest);
    if (num && !/^[A-Za-z]/.test(rest)) {
      tokens.push({ t: "num", v: Number(num[0].replace(",", ".")) });
      i += num[0].length;
      continue;
    }
    const name = /^[A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_.]*/.exec(rest);
    if (name) {
      const ref = REF.exec(rest);
      if (ref && ref[0].length === name[0].length) tokens.push({ t: "ref", v: ref[0] });
      else tokens.push({ t: "name", v: name[0].toUpperCase() });
      i += name[0].length;
      continue;
    }
    if (ch === "(") tokens.push({ t: "(" });
    else if (ch === ")") tokens.push({ t: ")" });
    else if (ch === ";" || ch === ",") tokens.push({ t: "sep" });
    else if (rest.startsWith("<=") || rest.startsWith(">=") || rest.startsWith("<>")) {
      tokens.push({ t: "op", v: rest.slice(0, 2) });
      i += 2;
      continue;
    } else if ("+-*/^&=<>%".includes(ch)) tokens.push({ t: "op", v: ch });
    else throw new FormulaError(ERRORS.name);
    i++;
  }
  return tokens;
}

function parseRef(ref: string): [number, number] {
  const match = REF.exec(ref);
  if (!match) throw new FormulaError(ERRORS.ref);
  return [Number(match[2]) - 1, colIndex(match[1])];
}

function toNumber(v: CellValue): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === "") return 0;
  const n = Number(v.replace(",", "."));
  if (Number.isNaN(n)) throw new FormulaError(ERRORS.value);
  return n;
}

function toText(v: CellValue): string {
  if (typeof v === "boolean") return v ? "VERDADEIRO" : "FALSO";
  return typeof v === "number" ? formatNumber(v) : v;
}

function toBool(v: CellValue): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const upper = v.toUpperCase();
  if (upper === "VERDADEIRO" || upper === "TRUE") return true;
  if (upper === "FALSO" || upper === "FALSE" || upper === "") return false;
  throw new FormulaError(ERRORS.value);
}

function flat(args: Value[]): CellValue[] {
  return args.flatMap((a) => (Array.isArray(a) ? a : [a]));
}

function numbers(args: Value[]): number[] {
  // Inside a range, text and blanks are skipped (as Excel does); typed in
  // as an argument, they count.
  const out: number[] = [];
  for (const arg of args) {
    if (Array.isArray(arg)) {
      for (const v of arg) if (typeof v === "number") out.push(v);
    } else {
      out.push(toNumber(arg));
    }
  }
  return out;
}

function single(v: Value): CellValue {
  if (!Array.isArray(v)) return v;
  if (v.length === 1) return v[0];
  throw new FormulaError(ERRORS.value);
}

type Fn = (args: Value[]) => Value;

const FUNCTIONS: Record<string, Fn> = {
  SOMA: (a) => numbers(a).reduce((s, n) => s + n, 0),
  MÉDIA: (a) => {
    const n = numbers(a);
    if (n.length === 0) throw new FormulaError(ERRORS.div0);
    return n.reduce((s, x) => s + x, 0) / n.length;
  },
  MÍNIMO: (a) => {
    const n = numbers(a);
    return n.length ? Math.min(...n) : 0;
  },
  MÁXIMO: (a) => {
    const n = numbers(a);
    return n.length ? Math.max(...n) : 0;
  },
  "CONT.NÚM": (a) => flat(a).filter((v) => typeof v === "number").length,
  "CONT.VALORES": (a) => flat(a).filter((v) => v !== "").length,
  "CONTAR.VAZIO": (a) => flat(a).filter((v) => v === "").length,
  ARRED: (a) => {
    const digits = a[1] === undefined ? 0 : toNumber(single(a[1]));
    const factor = 10 ** digits;
    return Math.round(toNumber(single(a[0])) * factor) / factor;
  },
  ABS: (a) => Math.abs(toNumber(single(a[0]))),
  RAIZ: (a) => {
    const n = toNumber(single(a[0]));
    if (n < 0) throw new FormulaError(ERRORS.value);
    return Math.sqrt(n);
  },
  POTÊNCIA: (a) => toNumber(single(a[0])) ** toNumber(single(a[1])),
  INT: (a) => Math.floor(toNumber(single(a[0]))),
  MOD: (a) => {
    const d = toNumber(single(a[1]));
    if (d === 0) throw new FormulaError(ERRORS.div0);
    const n = toNumber(single(a[0]));
    return n - d * Math.floor(n / d);
  },
  SE: (a) => (toBool(single(a[0])) ? (a[1] ?? true) : (a[2] ?? false)),
  E: (a) => flat(a).every(toBool),
  OU: (a) => flat(a).some(toBool),
  NÃO: (a) => !toBool(single(a[0])),
  CONCATENAR: (a) => flat(a).map(toText).join(""),
  MAIÚSCULA: (a) => toText(single(a[0])).toUpperCase(),
  MINÚSCULA: (a) => toText(single(a[0])).toLowerCase(),
  "NÚM.CARACT": (a) => toText(single(a[0])).length,
  ESQUERDA: (a) => toText(single(a[0])).slice(0, a[1] === undefined ? 1 : toNumber(single(a[1]))),
  DIREITA: (a) => {
    const text = toText(single(a[0]));
    const n = a[1] === undefined ? 1 : toNumber(single(a[1]));
    return n <= 0 ? "" : text.slice(-n);
  },
  ARRUMAR: (a) => toText(single(a[0])).trim().replace(/\s+/g, " "),
  HOJE: () => {
    const now = new Date();
    return `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
  },
  PI: () => Math.PI,
  SOMASE: (a) => {
    const range = Array.isArray(a[0]) ? a[0] : [a[0]];
    const sum = a[2] === undefined ? range : Array.isArray(a[2]) ? a[2] : [a[2]];
    const test = criterion(single(a[1]));
    let total = 0;
    range.forEach((v, i) => {
      const value = sum[i];
      if (test(v) && typeof value === "number") total += value;
    });
    return total;
  },
  "CONT.SE": (a) => {
    const range = Array.isArray(a[0]) ? a[0] : [a[0]];
    const test = criterion(single(a[1]));
    return range.filter(test).length;
  },
};

// The English names, as anybody coming from Excel in English types them.
const ALIASES: Record<string, string> = {
  SUM: "SOMA",
  AVERAGE: "MÉDIA",
  MEDIA: "MÉDIA",
  MIN: "MÍNIMO",
  MINIMO: "MÍNIMO",
  MAX: "MÁXIMO",
  MAXIMO: "MÁXIMO",
  COUNT: "CONT.NÚM",
  "CONT.NUM": "CONT.NÚM",
  COUNTA: "CONT.VALORES",
  COUNTBLANK: "CONTAR.VAZIO",
  ROUND: "ARRED",
  SQRT: "RAIZ",
  POWER: "POTÊNCIA",
  POTENCIA: "POTÊNCIA",
  IF: "SE",
  AND: "E",
  OR: "OU",
  NOT: "NÃO",
  NAO: "NÃO",
  CONCAT: "CONCATENAR",
  CONCATENATE: "CONCATENAR",
  UPPER: "MAIÚSCULA",
  MAIUSCULA: "MAIÚSCULA",
  LOWER: "MINÚSCULA",
  MINUSCULA: "MINÚSCULA",
  LEN: "NÚM.CARACT",
  "NUM.CARACT": "NÚM.CARACT",
  LEFT: "ESQUERDA",
  RIGHT: "DIREITA",
  TRIM: "ARRUMAR",
  TODAY: "HOJE",
  SUMIF: "SOMASE",
  COUNTIF: "CONT.SE",
};

/** ">10", "<>0", "=abc", "abc" — a test for SOMASE and CONT.SE. */
function criterion(raw: CellValue): (v: CellValue) => boolean {
  if (typeof raw !== "string") return (v) => v === raw || (typeof v === "string" && v === toText(raw));
  const match = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(raw)!;
  const op = match[1] ?? "=";
  const target = match[2];
  const numeric = target !== "" && !Number.isNaN(Number(target.replace(",", ".")));
  return (v) => {
    if (numeric && typeof v === "number") {
      const n = Number(target.replace(",", "."));
      switch (op) {
        case "<":
          return v < n;
        case ">":
          return v > n;
        case "<=":
          return v <= n;
        case ">=":
          return v >= n;
        case "<>":
          return v !== n;
        default:
          return v === n;
      }
    }
    const text = toText(v).toLowerCase();
    if (op === "<>") return text !== target.toLowerCase();
    if (op === "=") return text === target.toLowerCase();
    return false;
  };
}

class Parser {
  private i = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly cell: (row: number, col: number) => CellValue
  ) {}

  parse(): Value {
    const value = this.comparison();
    if (this.i < this.tokens.length) throw new FormulaError(ERRORS.value);
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.i];
  }

  private isOp(...ops: string[]): string | null {
    const token = this.peek();
    return token?.t === "op" && ops.includes(token.v) ? token.v : null;
  }

  private comparison(): Value {
    let left = this.concat();
    for (let op = this.isOp("=", "<>", "<", ">", "<=", ">="); op; op = this.isOp("=", "<>", "<", ">", "<=", ">=")) {
      this.i++;
      const a = single(left);
      const b = single(this.concat());
      const both = typeof a === "number" && typeof b === "number";
      const x = both ? a : toText(a).toLowerCase();
      const y = both ? b : toText(b).toLowerCase();
      left =
        op === "=" ? x === y : op === "<>" ? x !== y : op === "<" ? x < y : op === ">" ? x > y : op === "<=" ? x <= y : x >= y;
    }
    return left;
  }

  private concat(): Value {
    let left = this.additive();
    while (this.isOp("&")) {
      this.i++;
      left = toText(single(left)) + toText(single(this.additive()));
    }
    return left;
  }

  private additive(): Value {
    let left = this.term();
    for (let op = this.isOp("+", "-"); op; op = this.isOp("+", "-")) {
      this.i++;
      const right = toNumber(single(this.term()));
      left = op === "+" ? toNumber(single(left)) + right : toNumber(single(left)) - right;
    }
    return left;
  }

  private term(): Value {
    let left = this.power();
    for (let op = this.isOp("*", "/"); op; op = this.isOp("*", "/")) {
      this.i++;
      const right = toNumber(single(this.power()));
      if (op === "/" && right === 0) throw new FormulaError(ERRORS.div0);
      left = op === "*" ? toNumber(single(left)) * right : toNumber(single(left)) / right;
    }
    return left;
  }

  private power(): Value {
    let left = this.unary();
    while (this.isOp("^")) {
      this.i++;
      left = toNumber(single(left)) ** toNumber(single(this.unary()));
    }
    return left;
  }

  private unary(): Value {
    if (this.isOp("-")) {
      this.i++;
      return -toNumber(single(this.unary()));
    }
    if (this.isOp("+")) {
      this.i++;
      return this.unary();
    }
    const value = this.primary();
    if (this.isOp("%")) {
      this.i++;
      return toNumber(single(value)) / 100;
    }
    return value;
  }

  private primary(): Value {
    const token = this.tokens[this.i++];
    if (!token) throw new FormulaError(ERRORS.value);
    switch (token.t) {
      case "num":
      case "str":
        return token.v;
      case "ref": {
        const [row, col] = parseRef(token.v);
        return this.cell(row, col);
      }
      case "range": {
        const [r1, c1] = parseRef(token.from);
        const [r2, c2] = parseRef(token.to);
        const out: CellValue[] = [];
        for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
          for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) out.push(this.cell(r, c));
        }
        return out;
      }
      case "name": {
        if (token.v === "VERDADEIRO" || token.v === "TRUE") return true;
        if (token.v === "FALSO" || token.v === "FALSE") return false;
        const fn = FUNCTIONS[ALIASES[token.v] ?? token.v];
        if (!fn || this.peek()?.t !== "(") throw new FormulaError(ERRORS.name);
        this.i++;
        const args: Value[] = [];
        if (this.peek()?.t !== ")") {
          for (;;) {
            args.push(this.comparison());
            if (this.peek()?.t === "sep") {
              this.i++;
              continue;
            }
            break;
          }
        }
        if (this.tokens[this.i++]?.t !== ")") throw new FormulaError(ERRORS.value);
        return fn(args);
      }
      case "(": {
        const value = this.comparison();
        if (this.tokens[this.i++]?.t !== ")") throw new FormulaError(ERRORS.value);
        return value;
      }
      default:
        throw new FormulaError(ERRORS.value);
    }
  }
}

/** A typed value as what it is: a number (decimal comma or point), or text. */
function literal(raw: string): CellValue {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  // "1.234,56" (Portuguese) and "1234.56" both read as numbers.
  const normalized = /^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(trimmed)
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : trimmed.replace(",", ".");
  if (/^-?\d+(\.\d+)?$/.test(normalized)) return Number(normalized);
  return raw;
}

/**
 * Every cell's value, worked out: what is typed, or what its formula gives
 * (an error as text, "#DIV/0!" and the like). Only the cells that hold
 * something are in it.
 */
export function evaluateSheet(sheet: SheetData): Map<string, CellValue> {
  const values = new Map<string, CellValue>();
  const visiting = new Set<string>();

  function valueOf(row: number, col: number): CellValue {
    if (row < 0 || col < 0 || row >= sheet.rows || col >= sheet.cols) throw new FormulaError(ERRORS.ref);
    const key = cellKey(row, col);
    const known = values.get(key);
    if (known !== undefined) {
      if (typeof known === "string" && known === ERRORS.cycle) throw new FormulaError(ERRORS.cycle);
      return known;
    }
    const raw = sheet.cells[key]?.v ?? "";
    if (!raw.startsWith("=") || raw.length === 1) {
      const value = literal(raw);
      values.set(key, value);
      return value;
    }
    if (visiting.has(key)) throw new FormulaError(ERRORS.cycle);
    visiting.add(key);
    let value: CellValue;
    try {
      value = single(new Parser(tokenize(raw.slice(1)), valueOf).parse());
      if (typeof value === "number" && !Number.isFinite(value)) value = ERRORS.div0;
    } catch (err) {
      value = err instanceof FormulaError ? err.message : ERRORS.value;
    } finally {
      visiting.delete(key);
    }
    values.set(key, value);
    return value;
  }

  for (const key of Object.keys(sheet.cells)) {
    const [row, col] = key.split(",").map(Number);
    if (values.has(key)) continue;
    try {
      valueOf(row, col);
    } catch (err) {
      values.set(key, err instanceof FormulaError ? err.message : ERRORS.value);
    }
  }
  return values;
}

export function isFormulaError(value: CellValue | undefined): boolean {
  return typeof value === "string" && (Object.values(ERRORS) as string[]).includes(value);
}

const numberFormat = typeof Intl !== "undefined" ? new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 10 }) : null;

export function formatNumber(n: number): string {
  return numberFormat ? numberFormat.format(n) : String(n);
}

/** A worked-out value as the cell shows it. */
export function displayValue(value: CellValue | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? "VERDADEIRO" : "FALSO";
  return value;
}

// --- Out of the room ---------------------------------------------------------

function csvField(text: string): string {
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** As CSV, with ";" between fields — what Excel in Portuguese opens straight into columns. */
export function sheetToCsv(sheet: SheetData): string {
  const values = evaluateSheet(sheet);
  const { rows, cols } = usedSize(sheet);
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    const fields: string[] = [];
    for (let c = 0; c < cols; c++) fields.push(csvField(displayValue(values.get(cellKey(r, c)))));
    lines.push(fields.join(";"));
  }
  return "﻿" + lines.join("\r\n");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The part of the grid that holds anything. */
function usedSize(sheet: SheetData): { rows: number; cols: number } {
  let rows = 0;
  let cols = 0;
  for (const key of Object.keys(sheet.cells)) {
    const [r, c] = key.split(",").map(Number);
    rows = Math.max(rows, r + 1);
    cols = Math.max(cols, c + 1);
  }
  return { rows, cols };
}

/**
 * As an Excel file: an HTML table in Excel's own namespace, which Excel opens
 * as a workbook — formulas, bold, colors and column widths included.
 */
export function sheetToExcel(sheet: SheetData, title: string): string {
  const values = evaluateSheet(sheet);
  const { rows, cols } = usedSize(sheet);
  const widths = Array.from({ length: cols }, (_, c) => `<col width="${sheet.colWidths[c] ?? DEFAULT_COL_WIDTH}">`).join("");
  const body: string[] = [];
  for (let r = 0; r < rows; r++) {
    const tds: string[] = [];
    for (let c = 0; c < cols; c++) {
      const cell = sheet.cells[cellKey(r, c)];
      const value = values.get(cellKey(r, c));
      const style = [
        cell?.b ? "font-weight:bold" : "",
        cell?.i ? "font-style:italic" : "",
        cell?.bg ? `background:${cell.bg}` : "",
        cell?.color ? `color:${cell.color}` : "",
        cell?.align ? `text-align:${cell.align}` : "",
      ]
        .filter(Boolean)
        .join(";");
      const formula = cell?.v.startsWith("=") ? ` x:fmla="${escapeHtml(cell.v.replace(/;/g, ","))}"` : "";
      const num = typeof value === "number" ? ` x:num="${value}"` : "";
      tds.push(`<td${style ? ` style="${style}"` : ""}${num}${formula}>${escapeHtml(displayValue(value))}</td>`);
    }
    body.push(`<tr>${tds.join("")}</tr>`);
  }
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>${escapeHtml(
    title.slice(0, 31) || "Planilha"
  )}</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body><table>${widths}${body.join("")}</table></body></html>`;
}

/** A pasted block (from Excel, Sheets — tab-separated lines) as rows of values. */
export function parsePastedGrid(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  return lines.map((line) => line.split("\t"));
}
