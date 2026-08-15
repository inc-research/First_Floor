# First Floor

**A calculator for buffered and floored funds.**

A fact sheet states a buffer or a floor. That number is correct and it answers a different question
from the one you are asking. First Floor takes a description of a collared equity structure and
returns the decision-critical facts about it in about two minutes of reading.

It does not name funds, does not fetch data, does not run on a schedule, and does not make
recommendations.

## Three properties

- **Blind.** The engine has no knowledge of any specific product. You may label your own report with
  a ticker; the tool never supplies one, and the repository ships only synthetic examples.
- **Bring your own position.** Nothing is fetched. You supply a holdings file, or type six numbers
  from a fact sheet, or invent a structure you are considering building.
- **Local.** The browser reads the file and never uploads it. The MCP server runs on your own
  machine. There is no backend, no account, no telemetry.

## What it is not

Not a data service, not an advice engine, not a fund database, not a hosted service. These are
refusals rather than roadmap items; see `CONTRIBUTING.md`.

*"At a reference level of −20%, these contracts pay X"* is a measurement. *"This fund will lose
12.4%"* is a forecast. They are one careless verb apart, and this project only does the first.

## The headline result

Below the lowest put strike, a laddered floor is flat **if and only if** the held asset's beta to the
reference equals Λ, the delta cancellation ratio. A ladder sized so that Λ ≈ 1 is sized to neutralise
a *beta-one* held asset — and whether the fund's held asset is beta-one is an assumption, not a fact.

On the synthetic example A, that gap is worth four percentage points at a −40% reference move:

| Reference move | β = 1.00 | β = 1.10 | β = 1.20 |
|---|---|---|---|
| −20% | −18.271% | −20.233% | −22.195% |
| −40% | −20.264% | −24.188% | −28.112% |
| −60% | −20.276% | −26.162% | −32.048% |

β is an input, never an estimate. The tool sweeps it and reports the sensitivity; it does not tell
you what your held asset's beta is.

## Layout

```
schemas/       the three JSON Schemas — the contract every surface shares
examples/      synthetic structures, scenarios, a holdings CSV and column mappings
vectors/       golden vectors emitted by the oracle
reference/     the Python test oracle. Frozen. Not shipped, not maintained.
packages/core/ TypeScript. Pure functions. No I/O, no network, no DOM.
packages/copy/ the plain-English and technical copy decks
packages/web/  the static page. Reads files in-browser; no backend.
packages/mcp/  a local stdio MCP server. Runs on your machine; never hosted.
```

## Using it

The page is three files that work from a folder:

```
npm install
npm run build -w @first-floor/web
npm run serve -w @first-floor/web      # or just open packages/web/dist/index.html
```

Four ways in, all converging on one structure document you review before any number is computed: a
holdings CSV with a column mapping you save and reuse, a structure document, six numbers from a fact
sheet, or a worked example.

The MCP server runs locally over stdio:

```
npm run build -w @first-floor/mcp
npx first-floor-mcp
```

It exposes `report`, `sweep`, `validate_document`, `map_holdings_csv` and `summarise` — the same core
the page uses, so the two cannot disagree.

## Verifying the arithmetic

The oracle reproduces both committed vector files byte for byte:

```
python3 reference/oracle.py examples/example_a_laddered_floor.json examples/example_scenario.json
python3 reference/oracle.py examples/example_c_minimal_hand_typed.json examples/scenario_minimal.json
```

Read `COMPUTATIONAL_SPEC.md` before writing any arithmetic and `AGENT_BRIEF.md` before writing any
code. `DECISIONS.md` records what was settled and, for each decision, the condition that would
reverse it.

## As-of dates

Every report carries the `as_of` date of the structure it describes. Every downside figure carries
its assumptions. These are measurements of a dated position, and a position from last quarter is a
statement about last quarter.

## Licence

Code is MIT (`LICENSE`). Written content is CC BY 4.0 (`LICENSE-CONTENT`) — the plain-English
explanations are the actual contribution and are meant to be quotable and translatable.
