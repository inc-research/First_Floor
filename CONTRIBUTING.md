# Contributing to First Floor

Contributions are welcome. Before opening one, read this page — it exists so that a few
conversations happen once rather than every time.

## What this project refuses

These are refusals, not backlog items. A pull request implementing any of them will be declined
regardless of how well it is written.

- **No live data fetching.** No scheduled fetches, no hosted holdings archive, no daily monitoring,
  no alerting, no historical database. This is the single change that would convert the project from
  an artifact into a job, and it is the most likely inbound contribution. The answer is no.
- **No advice.** No rankings, no "best", no allocation language, no forward-looking statements about
  how a fund will perform. Outputs are measurements of a dated position and conditional arithmetic on
  stated assumptions.
- **No fund database.** No bundled list of tickers, no issuer registry, no pre-computed reports on
  named products. The repository ships synthetic examples only.
- **No hosted service.** No server-side computation, no API endpoint with uptime expectations. The
  MCP server runs locally over stdio; the web page runs in the user's browser.

The distinction that governs all copy: *"at a reference level of −20%, these contracts pay X"* is a
measurement. *"this fund will lose 12.4%"* is a forecast. They are one careless verb apart.

If you believe one of these should change, open an issue describing the re-scoping rather than a pull
request. See `DECISIONS.md` D-01 through D-04, each of which records the condition that would reverse
it.

## Invariants a contribution must not break

1. **Assumptions travel with numbers.** No function may return a downside figure stripped of its
   `vol_beta` and its held-asset betas.
2. **The held-asset response is an explicit object, never an implicit 1.0.**
3. **Silence beats a caveated wrong number.** A failed diagnostic blocks its dependent metrics and
   states what is missing. Never substitute a default and proceed quietly.
4. **Structure documents describe today; scenarios describe assumptions.**
5. **`schema_version` is checked.** Unknown majors are refused, not guessed at.
6. **Determinism.** Every Monte Carlo takes a seed and uses the specified PRNG.
7. **Nothing leaves the machine.** The web package must have zero network calls after page load.

## Numerical changes

`COMPUTATIONAL_SPEC.md` is the specification and `reference/oracle.py` is the frozen test oracle.
Where the two disagree, **the spec is wrong** — correct the spec, do not edit the oracle to match it.

Any change touching arithmetic must keep `vectors/example_a.json` and `vectors/example_c.json`
reproducing exactly:

```
python3 reference/oracle.py examples/example_a_laddered_floor.json examples/example_scenario.json
python3 reference/oracle.py examples/example_c_minimal_hand_typed.json examples/scenario_minimal.json
```

Float accumulation goes through exact summation, not a naive loop — see `COMPUTATIONAL_SPEC.md` §0.
A naive left-to-right sum reproduces neither vector file.

Do not add a second implementation of the engine. The core is TypeScript and every surface consumes
it (D-13).

## Adapters

Do not write one adapter per issuer (D-17). Formats drift and each drift becomes a bug report. The
generic CSV adapter plus a saved column mapping covers new formats without code changes; contribute a
mapping file rather than a parser.

## Copy

Plain-mode copy has lint-enforced banned words: *protect, protected, safe, guarantee, guaranteed,
should, will, ensures.* Replace jargon with mechanism, never with a verdict. Assumption lines appear
in both voices — the temptation is to strip them from plain mode because they are hard to phrase
simply, and that is exactly backwards.

## Licensing

Code is MIT, written content is CC BY 4.0. By contributing you agree your contribution is licensed
under whichever applies to the file you touched. Add SPDX headers to new files.
