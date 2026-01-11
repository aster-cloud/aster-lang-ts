# Operator-Call-Chaining entfernt

Operator-Call-Chaining (z. B. `Text.equals(a, b).equals(c, d)`) ist entfernt. Verwende Standardaufrufe oder Infix-Operatoren.

## Warum diese Aenderung

- Ausdruecke bleiben explizit und leicht lesbar.
- Lange Ketten sind schwer zu lesen.
- Foerdert kleine, benannte Schritte mit `Let`.

## Bevorzugte Muster

```
If Text.equals(a, b):
  Return true.
```

```
If a equals to b:
  Return true.
```

```
Let total be a plus b.
Return total.
```

```
Let same be a equals to b.
If same:
  Return true.
```

## Ersetzungen

- `Text.equals(a, b).equals(c, d)` -> `If Text.equals(a, b):` dann `Text.equals(c, d)` separat behandeln.
- `List.head(xs).toString()` -> `Text.concat("", List.head(xs))` oder `Int.toString(List.head(xs))` (passenden Helper waehlen).
- `obj.getField()` -> `obj.field` (Feldzugriff) oder `Type.method(obj, ...)` wenn es ein Helper ist.

## Migrationshinweise

- Nutze `Let`-Bindings, um verschachtelte Ausdruecke aufzubrechen.
- Vermeide Punktketten; nutze verschachtelte Aufrufe oder mehrere Statements.
- Halte Ausdruecke kurz und gut lesbar fuer Nicht-Programmierer.

## Schnellcheck

- Ersetze `a.b().c()` durch mehrere Statements oder Helper-Aufrufe.
- Bevorzuge `Type.method(value, ...)` statt `value.method(...)`.
- Wenn ein Wert direkt weiterverwendet wird, zuerst mit `Let` binden.
