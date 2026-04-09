# Design Critique: CGM & Pod Tracker

**Datum**: 2026-04-09  
**Datei**: `index.html`

---

## Anti-Patterns Verdict: FAIL — sieht sofort nach AI aus

Das UI trifft den kompletten AI-Slop-Stack von 2024:

| Anti-Pattern | Fundstelle | Status |
|---|---|---|
| `#0f0f13` Dark BG + cyan/purple Akzente | CSS `:root` — *die* KI-Farbpalette | offen |
| ~~Gradient-Text im Header~~ | ~~`linear-gradient(135deg, ...)` auf `h1`~~ | ✓ entfernt |
| ~~3px farbiger Top-Border auf Cards~~ | ~~`.status-card::before` — "lazy accent"~~ | ✓ entfernt |
| ~~DM Mono als "technisch"-Signal überall~~ | ~~Monospace überall statt echter Typografie~~ | ✓ reduziert (nur noch für Daten/Zahlen) |
| Zwei identische Status-Cards im Grid | Hero Metric Layout: Name + Zahl + Badge | offen |
| Glühende Akzentfarben auf Dunkel | Kein echter Designentscheid, nur "cool"-Signal | offen |

---

## Was funktioniert

1. **Timeline-Informationsarchitektur** — Datum → Gerät → Position ist logisch und scanbar. Die Highlight-Zeile für Seitenwechsel (`⇄ Seitenwechsel`) schafft nützliche visuelle Hierarchie.
2. **Konsistentes Farb-Encoding** — Dex = cyan, Pod = lila. Zieht sich durch alle Screens.
3. **Setup-Flow ist direkt** — 2 Felder pro Gerät, ein Button, kein Overhead.

---

## Priority Issues

### 1. ~~Kein Update-Weg für einzelne Geräte (KRITISCH)~~ ✓ ERLEDIGT

- ~~**Problem**: Wenn nur der Pod gewechselt wurde, muss man komplett "Neu einrichten" — alle Daten gehen verloren.~~
- **Fix umgesetzt**: "Jetzt gewechselt"-Button in jeder Status-Card. Ein Tap → heutiges Datum, Position rotiert automatisch, ✓-Bestätigung für 900 ms. Deckt auch Early-Failure-Recovery ab (Issue #4).
- **Skill**: `/delight` + `/harden`

### 2. ~~"Neu einrichten"-Button ohne Confirmation (KRITISCH)~~ ✓ ERLEDIGT

- ~~**Problem**: Full-width Button am Ende der Seite, kein Dialog, löscht sofort alles (`localStorage.removeItem`).~~
- **Fix umgesetzt**: `confirm()` vor Reset, Button zu kleinem Underline-Link verkleinert.

### 3. ~~30-Tage-Zyklus erklärt sich nicht (MITTEL)~~ ✓ ERLEDIGT

- ~~**Problem**: Der Progress-Bar mit "Tag X" — wofür? Was passiert an Tag 30? Die Logik ist unklar.~~
- **Fix umgesetzt**: Gesamte Cycle-Section entfernt (`/distill`).

### 4. ~~Kein Recovery-Flow bei frühem Sensor-Ausfall (MITTEL)~~ ✓ ERLEDIGT

- ~~**Problem**: Sensor löst sich los nach 8 Tagen → Tracker weiß es nicht → Timeline ist falsch.~~
- **Fix umgesetzt**: "Jetzt gewechselt"-Button übernimmt diese Rolle — jederzeit tappbar, nicht nur am geplanten Wechseltag. Heute wird als neuer Startpunkt gesetzt.
- **Skill**: `/harden`

### 5. Visueller Stil kommuniziert das Falsche (MITTEL)

- **Problem**: Cyan-auf-Schwarz mit Lila-Akzenten = Krypto-Portfolio-Ästhetik.
- **Impact**: Ein persönliches Gesundheitstool sollte Ruhe, Klarheit und Kontrolle signalisieren — nicht Tech-Coolness.
- **Fix**: Wärmere, weniger gesättigte Farben. Gradient-Text raus. Helles Theme evaluieren.
- **Skill**: `/colorize` oder `/quieter`

---

## Minor Observations

- ~~`<br>` in Status-Cards — mit CSS-Gap lösen~~ ✓ erledigt (flexbox gap)
- ~~Kein `<meta name="theme-color">` für Mobile Browser~~ ✓ hinzugefügt
- ~~"Noch X Tage" — was wird am Wechseltag selbst angezeigt? (`dexLeft = 0`)~~ ✓ zeigt jetzt "Heute wechseln" + "X Tage überfällig" bei verpasstem Wechsel
- ~~Default-Prefill setzt Dexcom-Datum auf *morgen*~~ — bleibt vorerst, da Philipp es so nutzt
- Timeline zeigt max. 14 Events — kein Hinweis darauf, dass mehr existieren

---

## Offene Fragen

- **"Was braucht der User jeden Tag?"** — "Wann muss ich was wechseln?" sollte die erste und dominanteste Info sein.
- **"Braucht es wirklich zwei Screens?"** — Setup als Inline-Edit oder Drawer wäre fließender.
- ~~**"Was wenn der Pod schon überfällig ist?"** — gibt es einen "Overdue"-State?~~ ✓ implementiert: "X Tage überfällig" mit rotem Puls, "Heute wechseln" am Wechseltag.
