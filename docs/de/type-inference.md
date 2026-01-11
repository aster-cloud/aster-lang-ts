# Typinferenz

Typinferenz ist der Standard im aktuellen CNL-Stil. Parameter, Felder und Rueckgabetypen werden aus der Verwendung abgeleitet, nicht explizit deklariert.

## Was wird inferiert

- Funktionsparameter aus ihrer Verwendung.
- Datenfelder aus Konstruktion und Zugriff.
- Rueckgabetypen aus `Return`-Ausdruecken.

## Inferenzgrenzen

Inferenz ist am staerksten, wenn die Nutzung direkt und konsistent ist:

- `If`-Zweige sollen Werte gleicher Form zurueckgeben.
- `Match`-Arme sollen kompatible Werte liefern.
- `Let`-Bindings schaffen klare, benannte Zwischenschritte.

## Einfache Beispiele

```
Define User with id, name.

To get_name with user, produce:
  Return user.name.
```

```
To is_adult with age, produce:
  If age at least 18:
    Return true.
  Return false.
```

## Inferenz steuern

Wenn die Inferenz mehrdeutig wird, hilft:

- Eine kleine Hilfsfunktion mit klarer Rueckgabe.
- Aussagekraeftige Namen (`count`, `has_`, `is_`, `message`).
- Komplexe Ausdruecke in mehrere `Let`-Bindings zerlegen.
- `If` und `Match` auf denselben Rueckgabetyp ausrichten.

## Explizite Typannotationen vermeiden

In diesem Repository vermeiden Beispiele und Tests absichtlich explizite Typannotationen. Wenn du einen Typ klarer machen musst, nutze strukturelle Verwendung statt Annotationen.

## Praktische Refactoring-Muster

```
To score_label with score, produce:
  Let high be score at least 90.
  If high:
    Return "high".
  Otherwise:
    Return "standard".
```

```
To display_name with user, produce:
  Let name be user.name.
  Return Text.concat("User ", name).
```
