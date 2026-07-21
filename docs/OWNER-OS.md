# Owner OS — Transparenz trotz 5 LLMs

**Für dich als Owner.** Nicht für npm. Nicht für den Code-Review.

Ziel: In **2 Minuten** wissen: *Kann das Tool etwas? Wohin gehen wir? Was ist live? Was dürfen Agenten anfassen?*

---

## 0. Live-Stand (CLI) — eine Wahrheit

| Frage | Antwort | Befehl |
|-------|---------|--------|
| Was ist **live auf npm**? | **0.8.4** | `npm view getadvantage version` |
| Was kann ich lokal laufen lassen? | **0.9.0 candidate** (first-party Action) | `node index.mjs --version` |
| Funktioniert der Kern noch? | Scoreboard | `npm run evidence` → **8/8 GREEN** oder ROT |
| Tests grün? | **65/65** erwartet (Action + PR summary + repair hostiles) | `npm test` |
| Alles auf einmal? | Live-Version vs. lokal **+** Scoreboard | `npm run owner` |

> **Live npm remains 0.8.4.** Local candidate **0.9.0** = first-party GitHub
> Action (`action.yml` + `uses: BellmeJoe/getadvantage-cli@v1`) + update-in-place
> PR summary + job-summary fallback. State: **REVIEW_PENDING** — no publish/tag/
> social LIVE flip until independent REVIEW_GO with 0 open P1/P2.

---

## 1. Was das Tool **wirklich** kann (Outcome, nicht Feature-Liste)

**Ein Satz:**  
**Bevor du deployst, sagt dir `npx getadvantage check` klar GO oder NO-GO — und blockiert, wenn Secrets oder Dreck mitgehen würden.**

| Outcome (Kunde versteht das) | Wie das Tool es prüft (komplex, unsichtbar) |
|------------------------------|-----------------------------------------------|
| **„Kein Live-Key im Repo“** | Secret-Scan inkl. Sourcemaps/Dist, Redaction, kein Full-Key in Output |
| **„Kein .env committed“** | Tracked-.env-Check (History = Leak) |
| **„Ich shippe nicht aus Versehen ungespeicherten Dreck“** | Dirty-tree-Check: warnt bei lokal geänderten, noch nicht committeten Dateien — Hosts wie Vercel deployen genau diesen Stand |
| **„Ein sauberes Projekt wird nicht falsch blockiert“** | Clean fixture → GO |
| **„Ich verstehe mich auch als Vite/React-Mensch“** | Map ohne Express-Jargon auf Client-Apps |
| **„Backend-Routen sehe ich“** | Map Express/Next/… + Warnung bei offenem POST |

Das ist die **Verkaufs-Logik**:  
- **Outcome simpel** (GO / NO-GO, Secret weg, deploy sicher).  
- **Mechanismus schwer** (Patterns, Stack-Detection, Fan-in, …) — das ist der Graben, den Konkurrenten nicht in einer Woche nachbauen, *wenn* die Outcomes stimmen.

Alles andere (Brief, Handoff, Fan-out, MCP, Architecture) ist **Werkzeug für Builder/Agenten** — nützlich, aber nicht der Pitch für den ersten Satz.

---

## 2. Die richtigen Loops (Owner + Agenten)

```
┌─────────────────────────────────────────────────────────────┐
│  LOOP A — Jeden Tag / jede Session (30 Sekunden)            │
│  git status · npm view getadvantage version                 │
│  docs/sessions/* lesen wenn da · ACTIVE-LANES.md            │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│  LOOP B — Vor jedem „ist das Tool kaputt?“ (2 Minuten)      │
│  npm run evidence                                           │
│  → 8/8 GREEN = Kern lebt                                    │
│  → irgendein RED = erst das fixen, kein Feature-Pitch       │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│  LOOP C — Vor Public / Show HN (1 Stunde)                   │
│  evidence GREEN + npm test                                  │
│  + 2. Modell: Scoreboard in ops/loop1/REFUTE-PROMPT.md      │
│    einfügen und einem ANDEREN Modell geben                  │
│  + docs/launch/ Visual (Outcome-Karte)                      │
│  → GREEN = hard pitch · SOFT = beta · RED = halt            │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│  LOOP D — Nach fremdem Review (nächste Release)             │
│  Review-Findings → ROADMAP 0.8 (nicht Hotfix 0.7.4)        │
│  Nur Blocker, die evidence ROT machen würden, sofort        │
└─────────────────────────────────────────────────────────────┘
```

| Loop | Owner-Frage | Artefakt |
|------|-------------|----------|
| A | Wer arbeitet wo? | `docs/ACTIVE-LANES.md` |
| B | Kann das Tool noch etwas? | `npm run evidence` |
| C | Darf ich werben? | Evidence + Refute + Launch-Visual |
| D | Was kommt als Nächstes? | `ROADMAP.md` 0.8 |

**Kein Loop „5 Agents pushen Features ohne Scoreboard“.**  
Features ohne grünes Evidence = Lärm.

---

## 3. Multi-LLM-Chaos stoppen (Regeln, die funktionieren)

1. **Eine kanonische Wahrheit pro Concern**  
   - Evidence: nur `npm run evidence`  
   - Launch HTML im Repo: nur `docs/launch/`  
   - Brand (Site): nur `getadvantage/docs/BRAND.md`  

2. **Eine Lane = ein Owner-Pfad**  
   Vor Start: in `docs/ACTIVE-LANES.md` eine Zeile: wer / was / Pfad / bis wann.

3. **Kein paralleles „gleiche Aufgabe, zwei Suiten“**  
   Zweiter Agent muss die Session-Logs und ACTIVE-LANES lesen.

4. **Publish nach objektivem Gate, nicht nach Owner-Klick**
   Ein Release braucht: genau eine beabsichtigte Lane, aktuelle Tests,
   `npm run evidence` 8/8, Pack- und Cold-Path-Prüfung, unabhängiges
   `REVIEW_GO`, keine offene P1/P2, sauberen beabsichtigten Repo-Stand und
   Rollback. Ein späterer Grok-Zyklus darf danach den Versions-Bump pushen; CI
   publisht automatisch. Benjamin ist Empfänger des Berichts, kein Routine-Gate.

5. **Nach Session: Session-Log**  
   `docs/sessions/YYYY-MM-DD-…-SESSION.md` mit: Live-Version, Evidence-Stand, was noch nicht committed ist, nächster Schritt.  
   *(Session-Logs bleiben lokal — der Ordner ist gitignored und nicht im öffentlichen Repo.)*

---

## 4. Visualisierung — was du und der Kunde sehen müssen

### Für dich (Owner)
Nicht 40 Commits. **Ein Scoreboard:**

```
npm run evidence
→ 8/8 GREEN
  Catches the leak · Leak in build · .env · Clean GO · Dirty · First-run · Client map · Server map
```

Optional später: ein HTML-Dashboard, das `evidence --json` rendert — **nicht** nötig, solange Terminal-Scoreboard sitzt.

### Für den Markt (Kunde)
Nicht Architecture Diagrams. **Ein Outcome-Moment:**

| Visual | Wo | Aussage |
|--------|-----|---------|
| **Verdict-Karte** NO-GO → GO | `docs/launch/verdict-hero.html` | „Key im Sourcemap → blockiert → fix → grün“ |
| **15s Storyboard** | `docs/launch/gif-storyboard-15s.html` | Gleicher Story-Arc für GIF/X |
| **Live-Demo** | `npx getadvantage demo` | Fan-in-Wow: mehrere Agenten-Arbeitszweige sicher zusammenführen (fortgeschritten) — Pitch **zweitrangig** |

**Marketing-Regel (wie du sagst):**  
- **Was rauskommt:** simpel genug für jeden.  
- **Wie es drin gelöst ist:** kompliziert genug, dass es nicht trivial kopierbar ist.  
Die Karte zeigt nur Outcome; der Scan-Code bleibt der Graben.

---

## 5. Feature-Lärm vs. Richtung

| Richtung (behalten) | Lärm (nicht pitchen, bis Evidence + Story sitzen) |
|---------------------|-----------------------------------------------------|
| GO/NO-GO Gate | „Fleet / 12 Commands / MCP / Architecture“ als Hero |
| Secret + .env + dirty tree | Interne Brief/Handoff-Details im ersten Satz |
| Ehrliche Map (Client vs Server) | Jede Stack-Nische als „wir können alles“ |
| Open source, lokal | Enterprise-Control-Plane, bevor Gate verkauft |

**Richtung in einem Satz:**  
Wir sind das **GO/NO-GO vor dem Deploy** für AI-gebaute Apps — mit Beweis, dass Secrets und Dreck nicht mitgehen.

Get Found / plus×plus = andere Story, anderer Markt (siehe Product-Map der Site).

---

## 6. Zweite Reviews (später reinkommend)

Wenn ein Review **nach** 0.7.3 kommt:

1. **Evidence noch GREEN?** Wenn nein → Fix sofort, Patch-Release.  
2. **Nützlich aber nicht trust-kritisch?** → `ROADMAP.md` **0.8**, nicht 0.7.4-Spam.  
3. **Marketing/Visual?** → `docs/launch/` anpassen, nicht neues CLI-Feature erfinden.

---

## 7. Deine wöchentliche 10-Minuten-Routine

```text
1. npm run owner        (Live-Version vs. lokal + Evidence-Scoreboard, ein Befehl)
2. ACTIVE-LANES.md leer / aktuell?
3. Ein Satz notieren: „Diese Woche pitchen wir: ____“
4. Wenn Evidence rot: nichts pitchen, nur fixen
```

Mehr brauchst du nicht, um Owner zu bleiben, während Agents bauen.
