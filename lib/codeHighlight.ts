// Syntax colours for chat code blocks (```js ... ```). Deliberately small: a
// single scanner that knows comments, strings, numbers and each language's
// keywords, which is what makes a snippet in a chat readable — not a parser,
// and nothing downloaded. A language it does not know is drawn plain.

export type CodeTokenType = "comment" | "string" | "number" | "keyword" | "literal" | "func" | "tag" | "attr" | "added" | "removed";

export interface CodeToken {
  type: CodeTokenType | null;
  value: string;
}

interface LanguageSpec {
  line?: string[];
  block?: [string, string];
  quotes: string[];
  keywords: Set<string>;
  literals: Set<string>;
}

const words = (list: string) => new Set(list.split(" "));

const C_LITERALS = words("true false null undefined NaN Infinity this self super nil None True False");

const JS = words(
  "abstract any as async await boolean break case catch class const constructor continue debugger declare default delete do else enum export extends finally for from function get if implements import in infer instanceof interface keyof let module namespace never new number object of package private protected public readonly return satisfies set static string switch symbol throw try type typeof unknown var void while with yield"
);
const PY = words(
  "and as assert async await break class continue def del elif else except finally for from global if import in is lambda match case nonlocal not or pass print raise return try while with yield"
);
const JAVA = words(
  "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized throw throws transient try var void volatile while record sealed permits yield"
);
const CSHARP = words(
  "abstract as async await base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new object operator out override params private protected public readonly record ref return sbyte sealed short sizeof stackalloc static string struct switch throw try typeof uint ulong unchecked unsafe ushort using var virtual void volatile while"
);
const C = words(
  "auto bool break case char class const constexpr continue default define delete do double else endif enum explicit extern float for friend goto if ifdef ifndef include inline int long namespace new noexcept operator private protected public register return short signed sizeof static static_cast struct switch template throw try typedef typename union unsigned using virtual void volatile while"
);
const GO = words(
  "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var bool byte error float32 float64 int int32 int64 rune string uint uint8 any"
);
const RUST = words(
  "as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return static struct trait type unsafe use where while Self i8 i16 i32 i64 u8 u16 u32 u64 usize isize f32 f64 bool char str String Vec Option Result Some Ok Err"
);
const KOTLIN = words(
  "as break class companion continue data do else enum false for fun if import in interface internal is lateinit null object open override package private protected public return sealed super suspend this throw true try typealias val var when while"
);
const SWIFT = words(
  "as associatedtype break case catch class continue default defer do else enum extension fallthrough fileprivate for func guard if import in init inout internal is let open operator private protocol public repeat rethrows return static struct subscript switch throw throws try typealias var where while"
);
const PHP = words(
  "abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile extends final finally fn for foreach function global goto if implements include instanceof interface isset list match namespace new or print private protected public readonly require return static switch throw trait try unset use var while yield"
);
const RUBY = words(
  "alias and begin break case class def defined? do else elsif end ensure for if in module next not or redo require rescue retry return self super then undef unless until when while yield attr_accessor attr_reader puts"
);
const SHELL = words(
  "if then else elif fi for while until do done case esac in function return local export echo exit set unset source alias cd sudo"
);
const SQL = words(
  "select from where and or not insert into values update set delete create table drop alter add column primary key foreign references join left right inner outer full on as group by order having limit offset distinct union all index view default null is in like between exists case when then else end count sum avg min max asc desc integer int varchar text boolean date timestamp"
);
const LUA = words("and break do else elseif end for function goto if in local not or repeat return then until while");
const CSS = words("important media import supports keyframes font-face from to");
const NONE = new Set<string>();

const CLIKE = { line: ["//"], block: ["/*", "*/"] as [string, string] };

const LANGUAGES: Record<string, LanguageSpec> = {
  js: { ...CLIKE, quotes: ['"', "'", "`"], keywords: JS, literals: C_LITERALS },
  python: { line: ["#"], quotes: ['"', "'"], keywords: PY, literals: C_LITERALS },
  java: { ...CLIKE, quotes: ['"', "'"], keywords: JAVA, literals: C_LITERALS },
  csharp: { ...CLIKE, quotes: ['"', "'"], keywords: CSHARP, literals: C_LITERALS },
  c: { ...CLIKE, quotes: ['"', "'"], keywords: C, literals: C_LITERALS },
  go: { ...CLIKE, quotes: ['"', "'", "`"], keywords: GO, literals: C_LITERALS },
  rust: { ...CLIKE, quotes: ['"'], keywords: RUST, literals: C_LITERALS },
  kotlin: { ...CLIKE, quotes: ['"', "'"], keywords: KOTLIN, literals: C_LITERALS },
  swift: { ...CLIKE, quotes: ['"'], keywords: SWIFT, literals: C_LITERALS },
  php: { line: ["//", "#"], block: ["/*", "*/"], quotes: ['"', "'"], keywords: PHP, literals: C_LITERALS },
  ruby: { line: ["#"], quotes: ['"', "'"], keywords: RUBY, literals: C_LITERALS },
  shell: { line: ["#"], quotes: ['"', "'"], keywords: SHELL, literals: NONE },
  sql: { line: ["--"], block: ["/*", "*/"], quotes: ["'", '"'], keywords: SQL, literals: words("true false null TRUE FALSE NULL") },
  lua: { line: ["--"], quotes: ['"', "'"], keywords: LUA, literals: words("true false nil self") },
  css: { block: ["/*", "*/"], quotes: ['"', "'"], keywords: CSS, literals: NONE },
  json: { quotes: ['"'], keywords: NONE, literals: words("true false null") },
  yaml: { line: ["#"], quotes: ['"', "'"], keywords: NONE, literals: words("true false null yes no on off") },
};

const ALIASES: Record<string, string> = {
  javascript: "js", jsx: "js", ts: "js", typescript: "js", tsx: "js", mjs: "js", cjs: "js",
  py: "python", python3: "python",
  cs: "csharp", "c#": "csharp",
  cpp: "c", "c++": "c", h: "c", hpp: "c", cc: "c", arduino: "c",
  golang: "go", rs: "rust", kt: "kotlin", kts: "kotlin", rb: "ruby",
  sh: "shell", bash: "shell", zsh: "shell", console: "shell", ps1: "shell", powershell: "shell",
  mysql: "sql", postgres: "sql", postgresql: "sql", sqlite: "sql",
  scss: "css", sass: "css", less: "css", yml: "yaml", toml: "yaml", ini: "yaml",
  jsonc: "json", json5: "json",
};

const MARKUP = new Set(["html", "xml", "svg", "vue", "htm"]);

/** Whether a fence's language gets colours at all. */
export function isHighlighted(lang: string | null): boolean {
  if (!lang) return false;
  return lang === "diff" || MARKUP.has(lang) || Boolean(LANGUAGES[ALIASES[lang] ?? lang]);
}

export function highlightCode(code: string, lang: string | null): CodeToken[] {
  if (!lang) return [{ type: null, value: code }];
  if (lang === "diff") return highlightDiff(code);
  if (MARKUP.has(lang)) return highlightMarkup(code);
  const spec = LANGUAGES[ALIASES[lang] ?? lang];
  return spec ? highlightWith(code, spec) : [{ type: null, value: code }];
}

const NUMBER = /(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)[a-zA-Z]*/y;
const IDENT = /[A-Za-z_$@][\w$]*[?!]?/y;

function highlightWith(code: string, spec: LanguageSpec): CodeToken[] {
  const out: CodeToken[] = [];
  let plain = "";
  const push = (type: CodeTokenType | null, value: string) => {
    if (type === null) {
      plain += value;
      return;
    }
    if (plain) out.push({ type: null, value: plain });
    plain = "";
    out.push({ type, value });
  };

  let i = 0;
  while (i < code.length) {
    const ch = code[i];

    const line = spec.line?.find((marker) => code.startsWith(marker, i));
    if (line) {
      const end = code.indexOf("\n", i);
      const stop = end === -1 ? code.length : end;
      push("comment", code.slice(i, stop));
      i = stop;
      continue;
    }
    if (spec.block && code.startsWith(spec.block[0], i)) {
      const end = code.indexOf(spec.block[1], i + spec.block[0].length);
      const stop = end === -1 ? code.length : end + spec.block[1].length;
      push("comment", code.slice(i, stop));
      i = stop;
      continue;
    }

    if (spec.quotes.includes(ch)) {
      let j = i + 1;
      while (j < code.length && code[j] !== ch) {
        // A backtick string may span lines; the others end at the line.
        if (code[j] === "\n" && ch !== "`") break;
        j += code[j] === "\\" ? 2 : 1;
      }
      const stop = Math.min(code.length, code[j] === ch ? j + 1 : j);
      push("string", code.slice(i, stop));
      i = stop;
      continue;
    }

    if (/\d/.test(ch) && !/[\w$]/.test(code[i - 1] ?? "")) {
      NUMBER.lastIndex = i;
      const match = NUMBER.exec(code);
      if (match) {
        push("number", match[0]);
        i += match[0].length;
        continue;
      }
    }

    IDENT.lastIndex = i;
    const ident = /[A-Za-z_$@]/.test(ch) ? IDENT.exec(code) : null;
    if (ident) {
      const word = ident[0];
      const type = spec.keywords.has(word)
        ? "keyword"
        : spec.literals.has(word)
          ? "literal"
          : code[i + word.length] === "("
            ? "func"
            : null;
      push(type, word);
      i += word.length;
      continue;
    }

    push(null, ch);
    i += 1;
  }
  if (plain) out.push({ type: null, value: plain });
  return out;
}

// Tags, attribute names, their quoted values and <!-- comments -->.
const MARKUP_TOKEN = /(<!--[\s\S]*?(?:-->|$))|(<\/?[A-Za-z][\w:.-]*)|([A-Za-z_:][\w:.-]*)(?==)|("[^"]*"|'[^']*')|(\/?>)/g;

function highlightMarkup(code: string): CodeToken[] {
  const out: CodeToken[] = [];
  let last = 0;
  let inTag = false;
  for (const match of code.matchAll(MARKUP_TOKEN)) {
    const start = match.index ?? 0;
    const [whole, comment, open, attr, quoted, close] = match;
    // Attribute names and values only mean something inside a tag.
    if ((attr || quoted) && !inTag) continue;
    if (start > last) out.push({ type: null, value: code.slice(last, start) });
    if (comment) out.push({ type: "comment", value: whole });
    else if (open) {
      out.push({ type: "tag", value: whole });
      inTag = true;
    } else if (attr) out.push({ type: "attr", value: whole });
    else if (quoted) out.push({ type: "string", value: whole });
    else if (close) {
      out.push({ type: "tag", value: whole });
      inTag = false;
    }
    last = start + whole.length;
  }
  if (last < code.length) out.push({ type: null, value: code.slice(last) });
  return out;
}

function highlightDiff(code: string): CodeToken[] {
  return code.split("\n").flatMap((line, index, lines): CodeToken[] => {
    const type: CodeTokenType | null = line.startsWith("+")
      ? "added"
      : line.startsWith("-")
        ? "removed"
        : line.startsWith("@@")
          ? "keyword"
          : null;
    return [{ type, value: index < lines.length - 1 ? `${line}\n` : line }];
  });
}
