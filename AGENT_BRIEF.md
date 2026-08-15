# First Floor — agent brief

**A calculator for buffered and floored funds.**

You are building a tool that takes a description of a collared equity structure and returns the
decision-critical facts about it in about two minutes of reading. It does not name funds, does not
fetch data, does not run on a schedule, and does not make recommendations.

Read this document before writing code. Read `COMPUTATIONAL_SPEC.md` before writing any arithmetic.
The three JSON Schema files are the contract; when this brief and a schema disagree, the schema wins.

---

## 1. What the tool is

A person who is considering one of these funds — or who already owns one — cannot easily find out
what it will actually do in a decline. The fact sheet states a buffer or a floor. That number is
correct and it answers a different question from the one the person is asking. The gap between the
two is recoverable from the fund's own published positions with arithmetic that fits in a few hundred
lines.

The tool makes that arithmetic available to anyone, on any structure, without the tool ever knowing
which fund it is looking at.

Three properties define it:

- **Blind.** The engine has no knowledge of any specific product. A user may label their own report
  with a ticker; the tool never supplies one, and the repository ships only synthetic examples.
- **Bring your own position.** Nothing is fetched. The user supplies a holdings file, or types six
  numbers from a fact sheet, or invents a structure they are considering building.
- **Local.** The browser reads the file and never uploads it. The MCP server runs on the user's own
  machine. There is no backend, no account, no telemetry.

## 2. What it is not

State these as refusals, not as roadmap items. The most likely inbound contribution is "add live
data fetching," and the answer is no.

- Not a data service. No scheduled fetches, no hosted holdings archive, no daily monitoring, no
  alerting, no historical database.
- Not an advice engine. No rankings, no "best," no allocation language, no forward-looking
  statements about how a fund will perform. Outputs are measurements of a dated position and
  conditional arithmetic on stated assumptions.
- Not a fund database. No bundled list of tickers, no issuer registry, no pre-computed reports on
  named products.
- Not a hosted service. No server-side computation, no API endpoint with uptime expectations.

The distinction that governs all copy: *"at a reference level of −20%, these contracts pay X"* is a
measurement. *"this fund will lose 12.4%"* is a forecast. They are one careless verb apart.

## 3. Architecture

```
first-floor/
  packages/core/          TypeScript. Pure functions. No I/O, no network, no DOM.
    schema/               generated types + validators from the three JSON Schemas
    pricing/              Black-Scholes, greeks, implied vol, normal CDF/PPF, seeded PRNG
    analytics/
      classify.ts         architecture, protection kind, reset cadence
      exposure.ts         notional accounting, Lambda, attachment, net delta
      geometry.ts         terminal payoff, floor scan, beta-conditional floor
      mark.ts             mark-to-market under a vol shock
      paths.ts            gradual decline
      capture.ts          overwrite Monte Carlo
      sleeve.ts           concentration; active share when a composition is supplied
    report.ts             assembles the result object; renders nothing
  packages/web/           static page. Reads files in-browser. No backend.
  packages/mcp/           stdio MCP server, runnable via npx. Thin wrapper on core.
  packages/copy/          the plain-English and technical copy decks (see §7)
  reference/oracle.py     the Python test oracle. Frozen. Not shipped, not maintained.
  vectors/                golden vectors emitted by the oracle
  schemas/                the three JSON Schemas
  examples/               synthetic structures and scenarios only
```

**One implementation.** The core is TypeScript and every surface consumes it. The Python oracle
exists to validate the port and is then frozen; it is not a second implementation to keep in sync.

## 4. Non-negotiable invariants

These are the properties that make the tool trustworthy. Violating any of them is a defect
regardless of how good the numbers look.

1. **Assumptions travel with numbers.** Every value the core returns carries the scenario that
   produced it. No function may return a downside figure stripped of its `vol_beta` and its held-asset
   betas. The report layer may not print a figure whose assumptions it cannot also print.

2. **The held-asset response is an explicit object, never an implicit 1.0.** Code that wants the
   unit-beta behaviour asks for it by name. This is the single assumption on which the headline
   result turns, and a hidden default would silently restore the error the tool exists to expose.

3. **Silence beats a caveated wrong number.** When an input is missing or a diagnostic fails, the
   affected metric does not render. It reports what is missing and what the user could supply. Never
   substitute a default and proceed quietly. The oracle's `weights_reconcile` returning `null` with a
   stated blocker, rather than `0.0`, is the pattern.

4. **Structure documents describe today; scenarios describe assumptions.** Nothing forward-looking
   belongs on a structure. If a field describes what might happen, it goes in the scenario document.

5. **`schema_version` is checked.** Unknown major versions are refused, not guessed at. Minor
   versions may add optional fields only.

6. **Determinism.** Every Monte Carlo takes a seed and uses the specified PRNG. A figure that moves
   between runs is not reproducible and will be reported as a bug.

7. **Nothing leaves the machine.** No fetch, no upload, no analytics, no error reporting. The web
   package must have zero network calls after page load.

## 5. Build order

Each phase gates the next. Do not begin a phase before its predecessor's gate passes.

| Phase | Content | Gate |
|---|---|---|
| 0 | Schema types + validators; load and validate both example structures and both scenarios | Round-trips without loss; invalid documents rejected with a useful message |
| 1 | Pricing primitives: normal CDF/PPF, Black-Scholes, delta, implied vol, mulberry32, Box–Muller | Matches `vectors/primitives.json` to 1e-10 |
| 2 | Classification and exposure | Matches both golden vector sets exactly |
| 3 | Payoff geometry: terminal value, floor scan, beta-conditional table | Matches vectors; property tests in §6 pass |
| 4 | Mark-to-market and the vol_beta sweep | Matches vectors to 1e-9 |
| 5 | Gradual decline | Matches vectors to 1e-9 |
| 6 | Capture Monte Carlo | Matches vectors **exactly** — same seed, same stream, same result |
| 7 | Report assembly + both copy decks | Every metric renders in both voices; every figure carries its assumptions |
| 8 | Static page: three input paths, structure document review, report with sliders | Works offline after load |
| 9 | Column-mapper adapter; MCP server | A holdings CSV maps to a valid structure document without code changes |

Phase 6 is the one most likely to fail on a first attempt, because cross-language PRNG agreement is
unforgiving. Get phase 1's PRNG byte-exact before attempting it.

## 6. Property tests

Two tests encode the results the project exists to communicate. They are worth more than the vectors
because they hold for structures nobody has written down yet.

**The floor is flat if and only if the held-asset beta equals Lambda.** For a structure with long
puts and a positive held-asset weight, compute Λ. Then for β = Λ, the terminal value below the lowest
strike must be constant to within 5bp across a wide range of reference moves. For β = Λ + 0.1, the
terminal value must decline monotonically, at a rate matching `w_eq · (β − Λ)` to within 1e-6 per
unit of reference move.

**Terminal value is the sum of its parts.** At every sampled reference level, the computed terminal
value must equal the held asset's response plus cash plus the signed intrinsic value of every leg.
This catches sign errors, multiplier errors, and underlying-unit confusion, which are the three most
likely defects in the ingest path.

Add a third once the adapter exists: **round-trip stability.** A structure document, rendered to a
report and back, must produce identical numbers. This is what catches unit drift between the proxy
underlying and the reference.

## 7. Copy decks

The report is a data structure. Two renderers consume it: `technical` and `plain`. Same numbers, same
caveats, different vocabulary. Plain is the default.

Every metric needs a hand-written plain-English sentence explaining its *mechanism*. These cannot be
generated. They are the highest-value content in the project and should be written with the same care
as the arithmetic.

Rules for the plain deck:

- Replace jargon with mechanism, never with a verdict. Not "you are protected below −10%" but "if the
  reference ends below 584, those contracts pay the difference between 584 and where it ended."
- Banned words in plain mode, enforced by a lint rule: *protect, protected, safe, guarantee,
  guaranteed, should, will, ensures.* Use conditional constructions.
- Assumption lines appear in both voices. The temptation is to strip them from plain mode because
  they are hard to phrase simply; that is exactly backwards.
- Every figure gets a "what would make this different" line. That is more useful to a
  non-specialist than any Greek.

## 8. Interaction model

Three input paths converge on one structure document, which the user reviews and edits, which then
produces the report. The review step is not optional — it is where the anatomy is taught and where
adapter errors surface.

Sliders bind only to closed-form parameters: `beta_down`, `beta_up`, `vol_beta`, and the reference
move. These recompute on every input event. The capture grid is Monte Carlo and is computed once per
report; it is not draggable.

A sweep is a core function (`sweep(structure, scenario, parameter, values)`), not a UI behaviour. The
web page renders its result as a slider; the MCP server returns it as a table. If the sweep logic
lives in an event handler, the surfaces have diverged.

## 9. Adapters

Do not write one adapter per issuer. Formats drift and each drift becomes a bug report.

Write one generic CSV adapter with an in-browser column mapper: parse any CSV, show the columns,
let the user map them onto schema fields, let them save the mapping as a small JSON file they can
reuse or share. Ship two or three example mappings. Option-name parsing (the two common string
formats and the OCC 21-character identifier) becomes a mapping option rather than a branch in the
code.

A file containing several accounts needs an account picker. An unmapped file falls through to manual
entry, not to an error.

## 10. Licensing and posture

MIT for code, CC BY 4.0 for written content, declared in `LICENSE`, `package.json`, and SPDX headers.

Every page carries its as-of date in the header. Every downside figure carries its assumptions. A
short disclaimer exists and is reviewed by counsel before launch. There is a limitations page and it
is a real page, linked in navigation, not a footer.

`CONTRIBUTING.md` states the non-goals in §2 as refusals so that the conversation happens once.
