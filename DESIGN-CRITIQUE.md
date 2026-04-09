# Design Critique: CGM & Pod Tracker

**Datum**: 2026-04-09  
**Datei**: `cgm-pump-tracker.html`

---

## Anti-Patterns Verdict: FAIL — sieht sofort nach AI aus

Das UI trifft den kompletten AI-Slop-Stack von 2024:

| Anti-Pattern | Fundstelle |
|---|---|
| `#0f0f13` Dark BG + cyan/purple Akzente | CSS `:root` — *die* KI-Farbpalette |
| Gradient-Text im Header | `linear-gradient(135deg, var(--dex), var(--pod))` auf `h1` |
| 3px farbiger Top-Border auf Cards | `.status-card::before` — "lazy accent" |
| DM Mono als "technisch"-Signal überall | Monospace als Abkürzung für Developer-Vibes statt echter Typografie-Entscheidung |
| Zwei identische Status-Cards im Grid | Hero Metric Layout: Name + Zahl + Badge |
| Glühende Akzentfarben auf Dunkel | Kein echter Designentscheid, nur "cool"-Signal |

---

## Was funktioniert

1. **Timeline-Informationsarchitektur** — Datum → Gerät → Position ist logisch und scanbar. Die Highlight-Zeile für Seitenwechsel (`⇄ Seitenwechsel`) schafft nützliche visuelle Hierarchie.
2. **Konsistentes Farb-Encoding** — Dex = cyan, Pod = lila, Rechts = orange, Links = grün. Zieht sich durch alle Screens.
3. **Setup-Flow ist direkt** — 2 Felder pro Gerät, ein Button, kein Overhead.

---

## Priority Issues

### 1. Kein Update-Weg für einzelne Geräte (KRITISCH)
- **Problem**: Wenn nur der Pod gewechselt wurde, muss man komplett "Neu einrichten" — alle Daten gehen verloren.
- **Impact**: Das ist der häufigste Use-Case. Pod läuft aus → wechseln → Tracker aktualisieren sollte ein Tap sein.
- **Fix**: Je eine "Jetzt gewechselt"-Schaltfläche pro Gerät direkt im Tracker-Screen. Klick → heutiges Datum als neues Startdatum, Position rotiert automatisch.
- **Skill**: `/delight` + `/harden`

### 2. ~~"Neu einrichten"-Button ohne Confirmation (KRITISCH)~~ ✓ ERLEDIGT
- ~~**Problem**: Full-width Button am Ende der Seite, kein Dialog, löscht sofort alles (`localStorage.removeItem`).~~
- ~~**Impact**: Accidental tap → Datenverlust.~~
- **Fix umgesetzt**: `confirm()` vor Reset, Button zu kleinem Underline-Link verkleinert.
- **Skill**: `/harden`

### 3. 30-Tage-Zyklus erklärt sich nicht (MITTEL)
- **Problem**: Der Progress-Bar mit "Tag X" — wofür? Was passiert an Tag 30? Die Logik ist unklar.
- **Impact**: Cognitive load ohne Payoff. Wenn kein echter Nutzen, ist es Dekoration.
- **Fix**: Entweder erklären ("Alle 30 Tage → Seitenwechsel, heute Tag X") oder entfernen. Die Status-Cards enthalten die wertvollere Info.
- **Skill**: `/distill`

### 4. Kein Recovery-Flow bei frühem Sensor-Ausfall (MITTEL)
- **Problem**: Sensor löst sich los nach 8 Tagen → Tracker weiß es nicht → Timeline ist falsch.
- **Impact**: Passiert häufig. Ohne Korrektur ist der Plan unbrauchbar.
- **Fix**: "Sensor ausgefallen? Jetzt neu setzen" — Recovery-Flow aus der Timeline heraus.
- **Skill**: `/harden`

### 5. Visueller Stil kommuniziert das Falsche (MITTEL)
- **Problem**: Cyan-auf-Schwarz mit Lila-Akzenten = Krypto-Portfolio-Ästhetik.
- **Impact**: Ein persönliches Gesundheitstool sollte Ruhe, Klarheit und Kontrolle signalisieren — nicht Tech-Coolness.
- **Fix**: Wärmere, weniger gesättigte Farben. Gradient-Text raus. Helles Theme evaluieren.
- **Skill**: `/colorize` oder `/quieter`

---

## Minor Observations

- `<br>` in Status-Cards ([Zeile 477](cgm-pump-tracker.html#L477), [484](cgm-pump-tracker.html#L484)) — mit CSS-Gap lösen
- "Noch X Tage" — was wird am Wechseltag selbst angezeigt? (`dexLeft = 0`)
- Default-Prefill setzt Dexcom-Datum auf *morgen* — verwirrt neue User
- Timeline zeigt max. 14 Events — kein Hinweis darauf, dass mehr existieren
- Kein `<meta name="theme-color">` für Mobile Browser

---

## Offene Fragen

- **"Was braucht der User jeden Tag?"** — "Wann muss ich was wechseln?" sollte die erste und dominanteste Info sein.
- **"Braucht es wirklich zwei Screens?"** — Setup als Inline-Edit oder Drawer wäre fließender.
- **"Was wenn der Pod schon überfällig ist?"** — gibt es einen "Overdue"-State?
