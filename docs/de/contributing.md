# Contributing

Danke, dass du Aster CNL verbesserst. Dieser Leitfaden beschreibt den aktuellen Beitragungsprozess und die Stilregeln.

## Stilregeln

- Verwende den aktuellen CNL-Stil: inference-first, keine expliziten Typannotationen in Beispielen/Tests.
- Kein Operator-Call-Chaining; nutze Standardaufrufe oder Infix-Operatoren.
- Anweisungen enden mit Punkten, Block-Header mit Doppelpunkten.
- 2 Leerzeichen Einrueckung verwenden.

## Setup

```
pnpm install
pnpm build
```

## Tests

```
pnpm test
```

## Goldens und Datensaetze aktualisieren

Wenn du CNL-Quellen in Tests oder Beispielen aenderst:

```
node dist/scripts/update-golden-ast.js
node scripts/update-all-core-golden.js
node scripts/generate-ai-training-data.mjs
```

## Docs-Updates

Wenn du Syntax, Inferenzregeln oder Beispiele aenderst, aktualisiere:

- `README.md`
- `docs/cnl-syntax.md`
- `docs/type-inference.md`
- `docs/operator-call.md`
- `docs/examples.md`

## Lokalisierung

Das Repository pflegt lokalisierte Docs in Englisch, vereinfachtem Chinesisch und Deutsch.

- Halte `docs/zh/` und `docs/de/` mit den englischen Docs unter `docs/` synchron.
- Wenn du Abschnitte hinzufuegst oder umbenennst, aktualisiere alle drei Sprachen.
- Bevorzuge klare Uebersetzungen, auch wenn sie nicht woertlich sind.
