# First Floor — decision register

Decisions settled before implementation began, with the reasoning and the condition that would
reverse each one. The point of recording the reversal condition is that a coding agent (or you, in
six months) can tell the difference between a decision that is load-bearing and one that was merely
a coin flip.

Settled 15 August 2026. Amend by appending, never by editing in place.

---

## Scope and posture

### D-01 · The project is an educational calculator, not a research publication
The prior proposals aimed at daily holdings capture, monitoring, and published reports on named
funds. That design's expensive parts — redundant schedulers, a private archive, pre-registration,
FDR control, a corrections log, legal review of claims about commercial products — all exist to
support assertions about specific funds over time. Dropping the assertions removes the apparatus
while keeping nearly all the intellectual content, which lives in the geometry and the taxonomy
rather than in any fund's numbers.

*Reverses if:* the goal changes from "help someone understand the technique" to "publish findings
about specific products." That is a different project, not a later phase of this one.

### D-02 · The engine is blind; the user's report is not
No field in any schema is required to identify a real product. `subject` and `advertised` exist, are
optional, are user-supplied, and never enter a computation. Naming what a report describes is a fact
about the input. Publishing pre-computed reports on named funds would be a claim about a commercial
product and is out of scope.

*Reverses if:* never, for the repository. The user's own labelling is theirs.

### D-03 · Non-goals are refusals, not backlog
No scheduled fetching, no hosted archive, no monitoring, no alerting, no fund database, no advice.
Written into `CONTRIBUTING.md` so the conversation happens once.

*Reverses if:* nothing short of a deliberate re-scoping. Live data is the single change that would
convert this from an artifact into a job.

### D-04 · Measurement, not forecast
Outputs are conditional arithmetic on a dated position. "At a reference level of −20%, these
contracts pay X" is a measurement; "this fund will lose 12.4%" is a forecast. Enforced in the copy
layer by a banned-word lint (D-16).

---

## Data model

### D-05 · The schema is the primary artifact
A normalized description of a collared structure, published as JSON Schema, is what every surface
shares. Adapters, the web page, the MCP server and any third-party reimplementation agree on the
document even when they disagree about everything else.

### D-06 · Three documents, not one
`collared_structure` describes what is true on its as-of date. `scenario` carries forward-looking
assumptions. `reference_composition` is optional and user-supplied. Splitting them means a structure
never contains a claim about the future, and a scenario can be swept without touching the position.

*Reverses if:* a computation genuinely needs a forward assumption to be a property of the position.
None currently does.

### D-07 · Underlyings are a keyed dictionary; legs point at them
Makes proxy-versus-reference basis a declared field rather than an accident, and puts every strike on
one axis via `ratio_to_reference`. Also surfaces exercise style and settlement, which differ between
a cash-settled European index option and a physically-settled American ETF option.

### D-08 · Held-asset response is an explicit model object
`beta_down` and `beta_up` carry `source: assumed` and default to 1.0. There is no path to a floor
figure that does not pass through them. This is the assumption the headline result turns on; a hidden
default would silently restore the error the tool exists to expose.

### D-09 · Beta is an input, never an estimate
Sleeve reconstruction, factor decomposition, and constituent price history are all out of scope. The
structural result — the floor is flat if and only if β equals Λ — needs no external data at all, and
presenting it as a sensitivity is both cheaper and better pedagogy than presenting a point estimate
with error bars.

*Reverses if:* the arXiv note later wants an empirical section. That is a separate artifact.

### D-10 · Index membership and weight differences are derived, not asserted
Neither is knowable from a holdings file. They require a reference composition the user supplies, and
they surface as active weight and active share — conventional statistics rather than bespoke ones. If
the file is absent the section is omitted. Nothing is hosted or updated.

### D-11 · Constituents carry name, weight, sector only
Sufficient for concentration and for a sector view. Resist adding fields until a computation demands
one.

### D-12 · `roll_policy` removed from the structure document
It described a forward assumption. It now lives at `scenario.decline.replacement`.

---

## Implementation

### D-13 · One implementation, in TypeScript
Pyodide would ship a ~10MB Python interpreter to run a few hundred lines of arithmetic. Two
maintained implementations would need a permanent cross-language test harness. TypeScript core plus a
Node MCP wrapper is one codebase with no drift.

*Reverses if:* a numerical requirement appears that TypeScript genuinely cannot serve. Nothing in the
v1 metric list qualifies.

### D-14 · The Python prototype is a test oracle, then retired
Run once, freeze the vectors, port against them, stop. This buys the confidence of two
implementations without the recurring cost of maintaining a pair.

### D-15 · The MCP server runs locally via npx, never hosted
A hosted endpoint would reintroduce the uptime obligation the whole design avoids, and would mean
holdings data leaving the user's machine. Local stdio has neither problem.

### D-16 · Silence beats a caveated wrong number
A failed diagnostic blocks its dependent metrics and states what is missing. Never substitute a
default and proceed quietly. The oracle returning `null` with a blocker for the weights identity,
rather than `0.0`, is the pattern — and was a real defect caught by the Type C example.

### D-17 · One generic CSV adapter with a column mapper
Per-issuer adapters are a maintenance treadmill; every format drift becomes a bug report. A user maps
columns once in the browser and can save the mapping as a shareable JSON file. Option-name parsing
becomes a mapping option rather than a code branch.

### D-18 · Determinism is specified, not assumed
mulberry32 plus Box–Muller with a specified draw order, so Python and TypeScript produce identical
streams. Every Monte Carlo takes a seed. A figure that moves between runs is a bug.

### D-19 · Sweeps are core functions, not UI behaviour
`sweep(structure, scenario, parameter, values)` returns an array. The web page renders it as a
slider; the MCP server returns it as a table. If sweep logic lives in an event handler, the surfaces
have diverged.

### D-20 · Sliders bind only to closed-form parameters
`beta_down`, `beta_up`, `vol_beta`, reference move. The capture Monte Carlo is computed once per
report and is not draggable.

### D-21 · Schema versions are checked, not guessed
Unknown major refused. Minor may add optional fields only.

---

## Interaction and presentation

### D-22 · Everything happens in the browser
The file is read locally and never uploaded. No backend, no account, no telemetry, no network calls
after page load. Consequence: no shareable report URL, so the report needs "download structure
document" and "copy report as markdown."

### D-23 · The structure document is shown and editable before the report
Not an optional step. It is where the anatomy is taught, where the three input paths visibly
converge, and where adapter errors surface before they become a plausible-looking wrong number.

### D-24 · Two voices, one result object; plain English is the default
Same numbers, same caveats, different vocabulary. Plain default because the audience is
non-specialists — a specialist meeting plain language is mildly annoyed, a non-specialist meeting
`vol_beta 0.65` closes the tab. Assumption lines appear in both voices.

### D-25 · Plain mode replaces jargon with mechanism, never with a verdict
Banned words, lint-enforced: *protect, protected, safe, guarantee, guaranteed, should, will,
ensures.* Conditional constructions instead.

### D-26 · All three architectures at v1, with conditional sections
Classification is cheap; single-outcome-period structures are simpler than laddered ones and are what
most retail investors actually encounter. Held-asset sections render only when a held asset exists.

### D-27 · v1 metric list is frozen
Classification and structure summary; advertised versus computed; terminal floor; mark-to-market
across a vol sweep; gradual decline; the β-conditional floor table; positioning notional and reset
cadence; capture grid; concentration; active share when a composition is supplied. Anything else is
v2.

---

## Project

### D-28 · Name: First Floor
Coined but neutral, apt without announcing itself, and the double meaning is on-thesis — the first
floor is the level below which you do not fall, which is exactly the question, and exactly the thing
that turns out to be conditional. "Research" was dropped: it is a term of art in a securities
context, reads as an investment research shop, and over-promises relative to what the tool is.

### D-29 · MIT for code, CC BY 4.0 for written content
MIT for familiarity; Apache-2.0's patent grant covers patents you hold, of which there are none, and
offers nothing against third-party patents. CC BY on the prose because the plain-English explanations
are the actual contribution and should be quotable and translatable. Declared in `LICENSE`,
`package.json`, and SPDX headers.

### D-30 · The arXiv note comes after the tool ships
The site's methods content is most of the note already, so writing in that order costs a weekend
rather than a month, and the tool supplies the worked examples. Target q-fin.PR or q-fin.RM; note
that first-time q-fin submitters need an endorsement, which is worth arranging before writing rather
than after.

### D-31 · Repository ships synthetic examples only
Real calibration checkpoints stay in private notes. They test the same code paths either way, and the
synthetic examples reproduce the same shapes without carrying claims about products.

### D-32 · Data-sourcing docs describe patterns, not links
Issuer URLs rot and a broken link table is a small recurring chore. Describe the path — issuer site,
fund page, holdings link — plus N-PORT on EDGAR for quarter-end. For reference composition, note that
a large tracking fund's published daily holdings is the practical free route, with the caveat that it
is the fund's holdings rather than the index.

---

## Implementation, second pass

Settled 15 August 2026, during Phases 0–2 of the TypeScript port.

### D-33 · Float accumulation is exactly rounded, everywhere
`math.fsum` in the oracle, a Shewchuk port in the core. Python 3.12 changed the `sum()` builtin to
Neumaier compensated summation, so the oracle produced last-ulp-different results depending on the
interpreter minor version, and the committed vectors — generated on 3.12+ — did not reproduce on
3.11. That is a determinism defect under invariant 6, discovered the first time Gate 0 was run.
Exact summation removes the version and platform dependence and gives the port a target that is a
mathematical fact rather than a property of someone's runtime. The vectors did not change: `fsum`
agrees with 3.12's `sum()` on these inputs. Sixteen figures across the two vector files are now
bit-identical between Python and TypeScript.

*Reverses if:* never. The cheaper alternative — pinning the oracle to Python ≥ 3.12 — leaves the
TypeScript port with no implementable specification, since JavaScript has no compensated `sum()`.

### D-34 · Below 1.0, the MINOR version is the compatibility axis
Invariant 5 refuses unknown majors, but every 0.x document shares major 0, so a major-only check
would accept every future breaking change and the invariant would be vacuous. A 0.2.x reader
therefore refuses 0.1.x and 0.3.x alike. At and above 1.0 the ordinary rule resumes: majors must
match, a newer minor is refused because it may carry fields this build would ignore, an older minor
is accepted because minors may only add optional fields.

*Reverses if:* the schema reaches 1.0, at which point the second clause is the whole rule.

### D-35 · Bit-exact capture is abandoned, on measurement
`AGENT_BRIEF.md` and §11 required the capture grid to match exactly, and named the PRNG as the likely
culprit. The PRNG is not the culprit: mulberry32's uniforms are 6000/6000 bit-identical across six
seeds. Box–Muller calls `log` and `cos`, Black-Scholes calls `exp` and `erfc`, and V8's libm is not
CPython's — `Math.exp` disagrees on 9.7% of sampled inputs, `Math.log` on 6.3%, each by one ulp. No
implementation that is not a copy of the same libm can close that. The gate is now 1e-12 relative for
capture, with the uniform stream still held to exactness so that a real PRNG defect still fails
loudly. `vectors/primitives.json` carries the measurement so the claim can be rechecked on any
runtime rather than taken on trust.

*Reverses if:* both surfaces move to a shared correctly-rounded math library. Not worth it for a
figure quoted to four significant figures.

### D-36 · The core stays pure; schemas reach it through a generated module
`packages/core` is specified as pure functions with no I/O, and a browser bundle cannot read a file
off disk. The JSON Schemas remain canonical — they are the published contract a third-party
reimplementation reads — and `scripts/generate-schema-module.mjs` emits them as a TypeScript module.
Drift is prevented by a test that regenerates and compares, rather than by discipline.

*Reverses if:* a bundler-native JSON import story becomes uniform across the surfaces.

### D-37 · Blockers carry a remedy, not just a cause
Invariant 3 says a failed diagnostic reports what is missing and what the user could supply. The
second half is easy to drop, so `Blocker.remedy` is a required field rather than an optional one. A
blocker with no remedy is a dead end, and "what would make this different" is more useful to a
non-specialist than any Greek (§7 of the brief).

---

## Adapters and surfaces

Settled 15 August 2026, during Phase 9.

### D-38 · The adapter never invents an underlying level
A holdings file records positions, not levels, dividend yields or the risk-free rate. The adapter
produces a *draft* structure document and asks for the levels it cannot know, rather than seeding
them from anything. Inventing them would be exactly the silent defaulting invariant 3 forbids, and
the failure would be invisible: a plausible level produces a plausible report that is wrong
throughout.

*Reverses if:* never for levels. A future adapter reading a file that genuinely contains them would
read them, which is not the same thing.

### D-39 · A mapping is chosen by result, not guessed from column names
The mapper tries every shipped mapping and keeps whichever reads the most rows and fails the fewest.
Whether a mapping works is observable; a heuristic over header titles is not, and would be one more
thing to maintain per issuer. A file that no shipped mapping reads falls through to manual entry
rather than to an error — being unable to parse someone's export is ordinary, and should not be the
end of the road.

### D-40 · Active share is validated by properties, not by vectors — O-05 closed
Closed in favour of D-14: the oracle is retired once the port passes, not extended. Active share is a
conventional statistic with checkable algebra — zero against an identical composition, one against a
disjoint one, bounded in [0,1], invariant to relabelling and to rescaling either side — and those
hold for compositions nobody has written down, which a frozen number does not.

### D-41 · Issuer recognition is data, and it explains itself
Settled 16 August 2026. A holdings file from a large issuer is not an arbitrary CSV: the file name
and the header row are both stable, and asking someone to answer twelve dropdowns about a file whose
shape is already known is the step at which an ordinary user gives up. So a mapping may carry a
`match` block — a header fingerprint, a file-name pattern, preamble markers — and a recogniser picks
the profile that fits.

The line this must not cross is D-17. **Nothing about an issuer is ever encoded in code.** A profile
is an ordinary `ColumnMapping` in `examples/`, supporting another issuer is a JSON file, and a
drifted export is an edit to that file. `applyMapping` remains the single path a file travels, and
the recognised mapping is shown prefilled and editable exactly as a hand-built one is (D-23).

This qualifies D-39 rather than reversing it: header matching *nominates* a profile, and the profile
is still required to read the file before it is offered. A signature that matches a file whose body
is something else is discarded on the result, which is the half of D-39 that was load-bearing.

Two consequences are deliberate. Recognition states its evidence — which headers matched, whether
the name fit, how many contracts came out — because a page that silently fills a form in is asking
to be trusted about something the user can no longer see. And the file name may only ever *add*
confidence: renaming a download is the likelier accident, so a renamed file is still recognised from
its columns alone.

*Reverses if:* profiles start needing per-issuer behaviour that no mapping field can express. The
answer then is a new mapping field, and only if that fails is it a new decision.

---

## Open

| # | Question | Blocking |
|---|---|---|
| O-01 | Is `firstfloor` / `first-floor` free on npm and GitHub? | Repo creation |
| O-02 | Who reviews the disclaimer, and when does that start? | Launch, not build |
| O-03 | Does the capture estimator's conditioning band need widening at 20k paths? | Phase 6 gate |
| O-04 | Site hosting: GitHub Pages default, or a custom domain? | Launch |
| O-06 | Should `subject`/`advertised` be stripped from a downloaded structure document by default, so a shared file carries no product claim? | Phase 8 |
