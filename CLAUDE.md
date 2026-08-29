# Karaokovic / Voice Tennis — Arbeitsregeln

Stimmgesteuertes 2.5D-Tennis für einen Live-Auftritt (Xperion Arena, LED-Wand,
NDR/ARD-Aufzeichnung). **Aufzeichnung: 21.10.2026.**

Der vollständige Stand steht in `HANDOVER-ARENA.md`, die Bedienung in
`OPERATOR-MANUAL.md`. Diese Datei enthält nur, was bei **jeder** Änderung gilt.

---

## Die Regel

> **Jeder Sprint muss begründen, warum er das BÜHNENRISIKO SENKT.**
> Was das nicht kann, wartet bis nach der Aufzeichnung.

Kein neues Untersystem, keine neue externe Abhängigkeit, kein Mechanismus,
dessen Verhalten auf dem Show-Rechner nicht gemessen ist.

**Sie gilt besonders für gut begründete Vorschläge.** ARENA-23 bis 25 waren
alle drei gut begründet und haben zusammen +17 % Code, drei Abhängigkeiten
außerhalb unserer Kontrolle und eine ungemessene Annahme in die Bedienung
gebracht. ARENA-26 hat das zurückgebaut.

---

## Nicht anfassen

- **`index.html` + `app.js`** — der eingefrorene TV-Prototyp V41. Läuft als
  Referenz daneben. Gebaut wird an **`arena.html` + `app-arena.js`**.
- **Geschützte Logik** (Änderung nur nach ausdrücklicher Freigabe):
  Autokorrelations-Mathematik, Ruheprüfung (2 s Pflicht-Stille, Rücksetz-
  logik, adaptive Grenze), Tennisregeln am Aufsprung, fehlendes Clamping im
  Overdrive (Absicht), Hotkey-Kombinationen.

---

## Hausregeln

**Ein-Quellen-Regel — die wichtigste im Projekt.** Wo eine Anzeige eine
Bedingung darstellt, ruft sie *dieselbe* Funktion auf wie die Bedingung. **Nie
eine zweite, parallele Logik bauen — auch nicht, wenn sie „dasselbe" täte.**
Eine Anzeige, die grün zeigt, während der Auslöser nicht auslöst, ist
schlimmer als gar keine Anzeige.

**Lautloses Fehlverhalten ist der teuerste Fehler.** Alles Nennenswerte bekommt
eine Protokollzeile, eine sichtbare Meldung und einen Rettungsgriff.

**Jede Zahl trägt ihre Historie im Kommentar** — alter Wert → warum geändert →
neuer Wert mit gemessener Wirkung.

**Messen statt raten.** Und: **Bühnenrisiko schlägt Eleganz.**

**Der Canvas ist das Sendebild.** Er geht auf die LED-Wand, ins Programm und
auf die Spielermonitore. Diagnose gehört ins DOM-Panel, nie ins Bild.

---

## Vorgehen

1. **Vor jedem Sprint feststellen, was im Arbeitsstand tatsächlich drin ist**
   (`git log`, `grep`). Pasted commit messages sind schon zweimal Beschreibungen
   von Arbeit gewesen, die es im Repo nicht gab.
2. Änderungen als **Patchpakete mit verifizierten Ankern** — Anker **vor** dem
   Schreiben gegen den echten Code prüfen, nie rekonstruieren.
   **Greift ein Anker nicht: melden, nicht freihändig anpassen.**
3. Danach immer: `node Entwickler-Tests/alle-tests.js` (muss grün sein) und
   `node Entwickler-Tests/webseite-bauen.js` (baut `docs/` für GitHub Pages neu).
