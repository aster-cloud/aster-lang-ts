# Dokumentenuebersicht

Aster CNL ist eine kontrollierte Natursprache, die fuer Nicht-Programmierer lesbar sein soll und trotzdem typsicher bleibt.
Dieses Repository enthaelt die TypeScript-Compiler-Toolchain sowie Beispiele und Tests.

Was im aktuellen CNL-Stil neu ist:

- Typinferenz ist Standard. Beispiele nutzen keine expliziten Typannotationen fuer Parameter, Felder oder Rueckgaben.
- Operator-Call-Chaining wurde entfernt. Verwende Standardaufrufe (z. B. `Text.concat(a, b)`) oder Infix-Operatoren (z. B. `a plus b`).
- CNL-Anweisungen enden mit einem Punkt. Block-Header enden mit einem Doppelpunkt und nutzen 2 Leerzeichen Einrueckung.

Sprachversionen:

- English (default): `docs/overview.md`, `docs/cnl-syntax.md`, `docs/type-inference.md`, `docs/operator-call.md`, `docs/examples.md`, `docs/contributing.md`
- 简体中文: `docs/zh/overview.md`, `docs/zh/cnl-syntax.md`, `docs/zh/type-inference.md`, `docs/zh/operator-call.md`, `docs/zh/examples.md`, `docs/zh/contributing.md`
- Deutsch: `docs/de/overview.md`, `docs/de/cnl-syntax.md`, `docs/de/type-inference.md`, `docs/de/operator-call.md`, `docs/de/examples.md`, `docs/de/contributing.md`

Dokumentenkarte:

- `docs/cnl-syntax.md`: Kernsyntax und Formatregeln.
- `docs/type-inference.md`: Wie Inferenz funktioniert und wie man sie fuehrt.
- `docs/operator-call.md`: Migrationshinweise und Ersatzmuster.
- `docs/examples.md`: Kuratierte Beispiele und weitere Fundstellen.
- `docs/contributing.md`: Beitragsprozess und Projektkonventionen.

Empfohlene Lesereihenfolge:

1. `docs/cnl-syntax.md` fuer Grammatik und Formatierung.
2. `docs/type-inference.md` fuer das Verstaendnis der Typinferenz.
3. `docs/operator-call.md` falls du alte Patterns migrierst.
4. `docs/examples.md` fuer End-to-End-Referenzen.
