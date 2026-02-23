# CNL-Syntax (aktueller Stil)

Dieser Leitfaden dokumentiert den aktuellen CNL-Stil in diesem Repository. Beispiele sind inference-first und verwenden keine expliziten Typannotationen.

## Kerngedanken

- Eine Anweisung pro Zeile, beendet mit einem Punkt.
- Block-Header enden mit einem Doppelpunkt und verwenden 2 Leerzeichen Einrueckung.
- Bevorzuge einfache, gut lesbare Konstrukte statt tief verschachtelter Ausdruecke.

## Module

```
Module greeting.
```

## Datentypen und Enums

```
Define User has name, age, email.

Define Status as one of Pending or Approved or Rejected.
```

## Konstruktoren und Feldzugriff

```
Rule email_domain given user, produce:
  Return Text.after(user.email, "@").
```

## Funktionen

```
Rule greet given name, produce:
  Return Text.concat("Hello, ", name).
```

```
Rule is_empty given text, produce:
  Return Text.equals(text, "").
```

## Variablen

```
Rule badge given user, produce:
  Let label be Text.concat("User ", user.name).
  Return label.
```

## Kontrollfluss

```
Rule check_access given role, produce:
  If role equals to "admin":
    Return true.
  Otherwise:
    Return false.
```

```
Rule eligibility given score, produce:
  If score at least 700:
    Return "approved".
  Otherwise:
    Return "review".
```

## Match

```
Rule explain given result, produce:
  Match result:
    When Ok(value), Return Text.concat("OK: ", value).
    When Err(error), Return Text.concat("ERR: ", error).
```

## Workflows (effects)

```
Rule sync_report, produce. It performs io:
  workflow:
    step fetch:
      Return Http.get("https://example.com/report").
    step store:
      Return Storage.write("report.txt", fetch).
```

## Kommentare

Verwende `//` fuer Inline- oder eigenstaendige Kommentare. Kommentare koennen nach einem Header oder am Satzende stehen.

```
Rule greet given name, produce: // header note
  Return Text.concat("Hi, ", name). // inline note
```

## Operatoren und Vergleiche

Uebliche Operatoren und Vergleiche lesen sich wie Englisch:

```
Let total be a plus b.
Let same be a equals to b.
Let older be age at least 21.
```

## Formatierungsregeln

- Anweisungen enden mit einem Punkt.
- Block-Header enden mit einem Doppelpunkt.
- Verwende 2 Leerzeichen Einrueckung.
- Bevorzuge inference-first (keine expliziten Typen in Beispielen).
- Kein Operator-Call-Chaining; nutze Standardaufrufe oder Infix-Operatoren.
