CNL prototype (Aster CNL v0)

Goal
- A deterministic Controlled Natural Language (CNL) that reads like compact English and compiles to a strict core AST.
- v1 lexicon is locked for muscle memory. Keep room for localized lexicons in the future.
- Indentation is significant (2 spaces per level). Periods end statements.

Status
- Canonicalizer + Lexer: multi-word keyword recognition, INDENT/DEDENT, 2-space rule, string/number/ident, dotted names, punctuation.
- Parser: module/import/data/enum/function headers; let/return/if/match; minimal expressions including construction "Type with a = b and c = d"; Ok/Err/Some/None sugar.
- CLI: parses a file and prints Core-like JSON AST (not yet lowering to Truffle/JVM core; this is surface AST).

Usage
- Run with Node.js 22+.

Examples
- Parse a file:
  node test/cnl/src/cli.mjs test/cnl/examples/login.aster

Design notes
- Articles (a/an/the) are ignored as grammar noise in specific positions.
- Keywords are case-insensitive and normalized to canonical forms.
- Effects are captured from "It performs IO." / "It performs CPU." clauses.
- Error messages include line/column spans.

Future
- Localized lexicons via pluggable keyword tables (en-US first).
- LSP server, golden tests, lowering to core IR.
