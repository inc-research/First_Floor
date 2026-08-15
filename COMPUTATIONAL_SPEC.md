# First Floor — computational spec

Every quantity in the v1 report, with its definition, its failure modes, and the value it must
reproduce on the reference examples.

The Python file `reference/oracle.py` implements all of this and emits `vectors/`. Where this
document and the oracle disagree, **this document is wrong** — correct it, do not edit the oracle to
match a mistaken spec.

Notation: `S` is an underlying level, `K` a strike, `T` years to expiry, `r` the risk-free rate, `q`
a continuous dividend yield, `σ` volatility, `N` the standard normal CDF. `NAV` is
`capital.net_assets`. A leg's `units` is `contracts × multiplier`. `w_eq` is `held_asset.weight`.

---

## 0. Conventions that cause most defects

**Strikes are quoted in their own underlying's units.** A structure may hold puts on a tenth-scale
proxy and calls on the reference itself. Never compare a strike to the reference level without
passing through `ratio_to_reference`. Every quantity that mixes legs across underlyings must state
which units it is in.

**Direction lives in `position`, never in a sign on `contracts`.** Contracts are always positive.
Internally carry `sign = +1 | −1`.

**Time is act/365 from `as_of` to `expiry`.** A leg expiring today has `T = 0` and is worth its
intrinsic value.

**Every displayed number is rounded at the render boundary, never in the core.** The core returns
full precision; the renderer decides.

**Every float accumulation is exactly rounded.** Sums go through `math.fsum` in the oracle and
`fsum()` in the core, never through a naive left-to-right loop and never through Python's `sum()`
builtin. This is not tidiness. Python 3.12 changed `sum()` to use Neumaier compensated summation, so
the same oracle source produced last-ulp-different results depending on the interpreter's minor
version — a determinism defect under invariant 6, and the reason the committed vectors did not
reproduce on 3.11. Exact summation has no version or platform dependence, and it makes the
TypeScript target a mathematical fact rather than an accident of someone's runtime. Sixteen figures
across the two vector files are bit-identical between Python and TypeScript because of it.

---

## 1. Pricing primitives

### 1.1 Normal CDF

`N(x) = 0.5 · erfc(−x/√2)`. In TypeScript there is no `erfc`; implement it. Required accuracy 1e-12
absolute.

Prefer a method whose constants can be checked to a rational minimax approximation whose constants
cannot. A Cody/Hart or fdlibm port carries thirty-odd magic numbers, and a single mistyped digit
produces an error small enough to look like an approximation limit and large enough to matter — that
failure was reproduced during the port, at 3.7e-11, localised to one branch. The core instead uses
the confluent series `erf(x) = (2x/√π)e^(−x²)·Σ(2x²)ⁿ/(1·3·…·(2n+1))` below |x| = 1, where every term
is positive so nothing cancels, and a Lentz continued fraction above it, where relative accuracy
holds deep into the tail. Between them they need one constant, `1/√π`. Measured against CPython's
`math.erfc`: worst absolute error **5.0e-16** in `erfc` and **3.3e-16** in `N(x)`.

### 1.2 Normal quantile

Acklam's rational approximation, absolute error < 1.15e-9. Needed only for delta-targeted strike
selection.

### 1.3 Black-Scholes with continuous yield

```
v  = σ√T
d1 = [ln(S/K) + (r − q + σ²/2)T] / v
d2 = d1 − v

call = S·e^(−qT)·N(d1) − K·e^(−rT)·N(d2)
put  = K·e^(−rT)·N(−d2) − S·e^(−qT)·N(−d1)
```

When `T ≤ 0` or `σ ≤ 0`, return intrinsic value. Do not return NaN; a structure holding an
expiring leg is a normal case, not an error.

### 1.4 Delta

```
call delta = e^(−qT)·N(d1)
put delta  = e^(−qT)·[N(d1) − 1]
```

At `T ≤ 0`, delta is ±1 if in the money and 0 otherwise.

### 1.5 Implied volatility

Bisection on `σ ∈ [1e-4, 5.0]`, 200 iterations. Black-Scholes is monotone in σ, so bisection cannot
fail to converge; do not substitute Newton, whose vega denominator vanishes for deep out-of-the-money
legs and produces spurious solutions.

Invert only where the leg supplies `mark_per_unit` and `T > 0`. Where a leg supplies
`implied_vol` directly, use it. Where neither is present, use `scenario.fallback_iv` **and record
that you did** — the report must be able to say which legs are marked and which are modelled.
`fallback_iv` defaults to **0.20**, which is the constant the oracle applies. The oracle applies it
silently, via `l["iv"] or 0.2`; that is a violation of invariant 3 and the core must not copy it.
The core carries the same number and labels every leg's `ivSource` as `stated`, `inverted` or
`fallback`. Note also that `or` is a falsy-coalesce: it would replace an `implied_vol` of exactly
0.0. Use `??`.

**Bisection has a third failure mode, and it is the dangerous one.** Black-Scholes underflows to
exactly 0.0 for a sufficiently far out-of-the-money leg at low volatility. When the supplied price is
at or below that underflow floor, *every* σ below the threshold is a root, and bisection returns the
midpoint of whatever interval its own arithmetic underflows over. A zero mark on a 200-strike call
with spot 100 yields a confident-looking **5.66%** — a number that is not at a bound, not obviously
wrong, and completely meaningless. Neither §10 condition catches it. Reject any inversion whose price
is at or below `BS(S, K, T, r, q, σ_lower_bound)`.

Validated on example A:

| Leg | Right | K | T | Implied vol |
|---|---|---|---|---|
| P1 | put | 584.00 | 0.627 | 28.06% |
| P2 | put | 598.00 | 0.129 | 34.52% |
| P3 | put | 615.00 | 0.381 | 27.50% |
| P4 | put | 672.00 | 0.877 | 22.63% |
| C1 | call | 7725.00 | 0.014 | 17.77% |
| C2 | call | 7800.00 | 0.027 | 12.11% |
| C3 | call | 7875.00 | 0.038 | 10.47% |

The put skew across the ladder is a real feature, not noise: the nearest strike carries the highest
vol. Never flatten it to a single number.

### 1.6 Strike at a target call delta

```
d1 = N⁻¹(δ·e^(qT))
K  = S·exp[(r − q + σ²/2)T − d1·σ√T]
```

Used only inside the capture simulation. Clamp `δ·e^(qT)` to (1e-9, 1−1e-9).

### 1.7 Seeded PRNG — specified exactly

Cross-language agreement requires an exact algorithm. Use mulberry32:

```
a = (a + 0x6D2B79F5) mod 2³²
t = ((a XOR (a >>> 15)) · (1 OR a)) mod 2³²
t = (t + (((t XOR (t >>> 7)) · (61 OR t)) mod 2³²)) mod 2³² XOR t
u = ((t XOR (t >>> 14)) mod 2³²) / 2³²
```

Normals by Box–Muller, consuming exactly two uniforms per normal and discarding the sine branch:

```
z = √(−2·ln(max(u1, 1e-12))) · cos(2π·u2)
```

**Draw order is part of the specification.** In the capture simulation: for each time step, iterate
paths in ascending index and draw one normal each. Changing the loop nesting changes every result.

Do not substitute a platform generator. `Math.random()` cannot be seeded and numpy's generator will
not match.

---

## 2. Classification

Derived, never trusted from `role` hints on legs.

**Architecture.**

- `synthetic` if any long call has `K < 0.05 × reference_level × ratio_to_reference`. Such a call is
  a stock substitute, not optionality: the convention across these products is a strike near 1% of
  the reference level, and its delta is `e^(−qT)`, so the entire shortfall from 1.0 is forgone
  dividends rather than moneyness.
- `reference_tracking` if `held_asset.kind` says so, or if there are one or two constituents.
- `basket` if `held_asset.kind` says so, or if there are three or more constituents.
- `unclassified` otherwise — and this is a legitimate output, not a failure.

**These tests are ordered, and the order is load-bearing.** `synthetic` is checked first and wins
outright. That is why example C classifies as `synthetic` despite having `held_asset.weight == 0`: a
long call struck near zero is a stock substitute, and that fact dominates whatever the held asset is
or is not doing. Then the `kind`/constituent tests, in the order listed.

Two further fields fall out of the same pass and belong in the report:

- `basis_live` is true exactly when the architecture is `basket`. A basket held against index options
  carries proxy basis that a reference-tracking structure does not.
- `protection_continues_below_lowest_strike` is true exactly when `protection_kind` is `plain_put`.

**Protection kind.** `put_spread` if any short put exists; `plain_put` if only long puts;
`none` otherwise. This distinction changes the tail completely and must be surfaced: a plain long put
continues to protect indefinitely below its strike, whereas below a put spread's lower strike **there
is no floor at all** — losses resume one-for-one on a shifted curve.

**Reset asymmetry.** Mean remaining life of long puts divided by mean remaining life of short calls,
in days. This is the structural fact from which most path behaviour follows: a fund whose floor
resets annually and whose cap resets fortnightly has a ratio near 20, and will behave very
differently in a trend from one whose ratio is near 1.

Validated on example A: floor 183.75 days, cap 9.667 days, ratio **19.0086**.
Validated on example C: single outcome period, ratio **1.0** — no asymmetry at all.

---

## 3. Exposure

Market value is nearly useless for these structures; notional is everything. A ladder worth 0.3% of
capital can control twice capital in tracked exposure.

```
put spot notional        = Σ_longputs  units·S / NAV
insured value            = Σ_longputs  units·K / NAV
short call spot notional = Σ_shortcalls units·S / NAV
gross option notional    = Σ_all       units·S / NAV
option book value        = Σ_all sign·units·mark / NAV
```

**Delta cancellation ratio (Λ).** The quantity on which the headline result turns. Evaluated in the
puts' own underlying units:

```
Λ = (Σ_longputs units / NAV) · S₀ / w_eq
```

where `S₀` is the puts' underlying level. Λ is the held-asset beta at which the ladder exactly
neutralises the equity delta below the lowest strike. See §5.

**Average attachment** is the mean put strike over `S₀`, minus one. **Lowest attachment** uses the
minimum strike. Average attachment is *not* a floor — compute the floor, never infer it. In some
structures the two coincide, but only because `put spot notional ≈ w_eq` was a design choice.

**Net delta** is `w_eq` plus the notional-weighted delta of every leg.

**Weights reconciliation.** `w_eq + option_book_value + cash_weight` should be 1. If any leg lacks a
mark, this identity is **not computable**: return `null` and a stated blocker. Returning `0.0` is a
defect — it was one in the oracle's first draft, caught by the Type C example.

Validated on example A:

| Quantity | Value |
|---|---|
| Held asset weight | 0.981 |
| Put spot notional | 0.980428 |
| Insured value | 0.781015 |
| Short call spot notional | 0.977918 |
| Gross option notional | 1.958345 |
| Option book value | 0.003004 |
| Weights reconcile | 1.0000036 |
| Λ | 0.999417 |
| Average attachment | −0.203394 |
| Lowest attachment | −0.246306 |
| Net delta | 0.510489 |

Note gross notional near 196% of capital against an option book worth 0.3%. This is offsetting, not
leverage: the legs face opposite directions and the calls are covered by the held asset. What it
actually creates is basis, not gearing.

---

## 4. Terminal payoff geometry

```
terminal(d, β_d, β_u) = w_eq·(1 + β·d) + cash + Σ_legs sign·units·intrinsic(S₀ᵢ·(1+d), Kᵢ) / NAV − 1
```

where `β = β_d` for `d ≤ 0` and `β_u` otherwise, and intrinsic is `max(0, S−K)` for calls,
`max(0, K−S)` for puts. Result is expressed as a return on today's NAV.

**Floor scan.** Evaluate on a grid of reference moves from −95% to 0 in 1901 steps and take the
minimum. Two subtleties, both learned the hard way:

- Where the payoff is flat below the ladder, the minimum is attained over an *interval*. Report the
  **shallowest** move that attains it — the point at which further decline stops mattering. Reporting
  the grid edge instead implies the floor only binds at −95%, which is wrong and confusing.
- Flatness is approximate. A ladder with Λ ≠ 1 leaves a residual slope invisible at any single point
  but material over a deep decline. Test flatness against a tolerance of **5bp**, and report the
  tolerance alongside the verdict. A tolerance of 1e-6 declares nothing flat; this was a defect in
  the oracle's first draft.

**Reporting caveat, mandatory.** The terminal floor is not a collectible outcome. Where tranches
expire on several dates spanning months, there is no calendar date on which all of them protect.
Always report it alongside the gradual-decline figure, and always with that caveat attached.

Validated on example A: floor **−20.2957%**, attained from **−24.6%** downward, flat to 5bp.
Validated on example C: **−81.767%** at −95%, **not flat** — correct, because a put spread's
protection stops at its lower strike and losses resume below it.

---

## 5. The beta-conditional floor — the headline result

Below the lowest strike every long put is in the money, so the slope of the whole position with
respect to the reference is:

```
∂/∂S [ w_eq·β_d·S/S₀ − Σ units/NAV ] = w_eq·β_d/S₀ − Σ units/NAV
```

which is zero **if and only if**:

```
β_d = (Σ units / NAV)·(S₀ / w_eq) ≡ Λ
```

The correct reading of `Λ ≈ 1`: **the ladder is sized to neutralise a beta-one held asset.** Whether
the structure is actually floored depends on whether its held asset is beta-one — which, for a name
subset of an index, is an assumption rather than a fact.

If `β_d > Λ`, a residual short exposure of `w_eq·(β_d − Λ)` survives below the ladder, producing two
distinct effects:

- **A level effect.** At the attachment point the held asset has already fallen `β_d ×` the reference,
  so the position arrives at its floor from lower down.
- **A slope effect.** Below the ladder the position continues to lose `w_eq·(β_d − Λ)` per unit of
  further reference decline, indefinitely. There is no floor in that case, only a shallower slope.

Above the cap the same term flips sign: the structure pays reference performance and receives
held-asset performance, so a high-beta held asset *adds* to return in a strong rally. The honest
framing is therefore **a risk transformation, not a hidden defect** — better in rallies, worse in
selloffs, and invisible in a symmetric tracking-error statistic that averages the two.

β is an input, never an estimate. The tool sweeps it and reports the sensitivity. It does not
estimate it from returns, does not require constituent price history, and does not tell the user what
their held asset's beta is.

Validated on example A:

| Reference move | β = 1.00 | β = 1.10 | β = 1.20 |
|---|---|---|---|
| −20% | −18.271% | −20.233% | −22.195% |
| −40% | −20.264% | −24.188% | −28.112% |
| −60% | −20.276% | −26.162% | −32.048% |

The β = 1.00 column is flat past the attachment point; the others are not, and the gap widens with
the depth of the decline. That table is the project's central finding in six numbers.

---

## 6. Mark-to-market under a volatility shock

The terminal payoff understates the near-term picture because a sudden decline raises option values.

```
σ_shocked(leg) = max(0.02, σ_leg + vol_beta · max(0, −d))
mtm(d) = w_eq·(1 + d) + cash + Σ sign·units·BS(S₀ᵢ(1+d), Kᵢ, Tᵢ, σ_shocked) / NAV − 1
```

`vol_beta` is volatility points added per unit of reference drawdown; 0.65 means +13 points at −20%.
It is a reduced form and its virtue is legibility. **It must be swept and never reported bare.**

**Note what the first term does not contain.** The held asset moves `w_eq·(1 + d)`, not
`w_eq·(1 + β_d·d)`: mark-to-market is a β = 1.0 figure by construction and does not consult the
scenario's `beta_down` at all. That is intentional — the vol shock is about option value, not about
held-asset response — but under invariant 1 the report must label the block *"held-asset response
fixed at 1.0"* rather than printing the scenario's beta beside a number that never used it. Printing
an assumption a figure did not consume is its own kind of wrong number.

Base volatilities come from the legs' own marks (§1.5), not from a modelled surface. A parametric
surface is a labelled fallback for marks that will not invert.

Validated on example A:

| Reference move | vb = 0 | vb = 0.35 | vb = 0.65 | vb = 1.0 |
|---|---|---|---|---|
| −10% | −7.927% | −7.332% | −6.793% | −6.147% |
| −20% | −14.871% | −13.457% | −12.246% | −10.827% |
| −30% | −19.239% | −17.508% | −15.930% | −14.038% |

The spread between `vb = 0` and `vb = 1.0` at −20% is over four percentage points. That is the size of
the assumption, and it is why the sweep is mandatory rather than optional.

---

## 7. Gradual decline

The case the terminal floor hides. A laddered floor performs worst not in a crash but in a slow
grind, because each tranche expires while the market is still falling and is replaced below it.

Model a monotone path from today's level to `decline.total_move` over `decline.horizon_days`:

```
S(t) = S₀ · (1 + total_move)^(t / horizon_days)
```

On each day, any floor tranche reaching expiry realises its intrinsic value into cash and is replaced
at `floor_strike_pct_of_spot × S(t)` with tenor `floor_tenor_days`, funded from cash at
`floor_iv`. Remaining live tranches are marked at the horizon. Subtract the pro-rated expense ratio.

Replacement puts are priced at **`q = 0`**, not at the underlying's dividend yield. This is a
simplification in the oracle rather than a modelling claim, and it is stated here because it is
invisible at the call site and worth a line in the methods page.

**Two disclosures are mandatory on this figure.** First, a monotone path is the *best* case for a call
writer — no roll is ever assigned — so including the call overlay flatters the result substantially.
The default is to exclude it and to say so. Second, this is one hand-built path, not a distribution;
call it what it is.

Validated on example A, −30% over 365 days, overlay excluded: **−22.306%**. That is worse than the
same structure's terminal floor of −20.296%, and the divergence is the point.

---

## 8. Upside capture

Monte-Carlo the overwrite calibrated to the structure's own observed cap notional.

For each step of length `tenor_days`: strike the call at the target delta from the *then-current*
level, collect the premium, evolve the reference one step, pay the call's intrinsic value. Position
return per step:

```
ret = (S'/S − 1) + overwrite · [premium·e^(r·dt) − max(0, S' − K)] / S
```

`overwrite` defaults to the structure's own short-call spot notional. Capture is the mean position
return divided by the mean reference return, **conditioned** on paths finishing within `band` of
`reference_move`. Condition rather than take a raw ratio: a ratio of two small numbers is unstable
by construction when the denominator approaches zero, and produces figures like "beta 2.40" that mean
nothing.

Report `conditioned_paths` alongside the estimate. Below 50 conditioned paths, return `null` rather
than a number.

Validated on example A — 20,000 paths, seed 11, +15.2% over 91 days at 16% vol, 97.79% overwrite:

| Cap tenor | δ 0.30 | δ 0.25 | δ 0.20 |
|---|---|---|---|
| 14 days | 64.35% | 69.73% | 75.28% |
| 30 days | 60.57% | 66.43% | 72.64% |
| 91 days | 46.44% | 52.61% | 60.01% |

**Preserve the counter-intuitive result:** shorter tenors forfeit *less* in a trend, because each roll
re-strikes from the new level. It is the single most useful thing on the page for someone comparing
structures, and it is the opposite of what most readers expect.

Two framings that must survive into the copy. Overwriting is not a permanent haircut — it is a
positive-carry trade with a truncated up-tail; when the call expires out of the money the position
keeps the full move *plus* premium. And a constant-delta overwrite is not a directional view — strike
distance is an inverse proxy for the cost of downside skew, not a forecast.

Capture also means different things by architecture, and the report must label which:

- **Basket and reference-tracking structures with rolling caps:** a capture shortfall is realised and
  permanent. The calls settled in the money and the money is gone.
- **Single-outcome-period structures:** a mid-period shortfall is largely unrealised time value that
  mechanically reverses by expiry. A structure showing 52% capture today may be on track for 92% at
  expiry.

Reporting one capture number across both without that label is a category error.

---

## 9. Concentration and active share

**Concentration**, from the held asset alone:

```
HHI = Σ wᵢ²     (weights normalised to sum to 1)
effective N = 1 / HHI
```

**Active share** requires the optional `reference_composition` document and is omitted entirely when
it is absent:

```
active weight(name) = w_held(name) − w_ref(name)
active share        = ½ · Σ |active weight|
name coverage       = matched names / reference names
```

Names present on one side only are counted and reported, never dropped silently. If the composition's
`as_of` is materially older than the structure's, flag it rather than joining quietly.

Two honesty requirements. A composition file sourced from a tracking fund's published holdings is
that fund's holdings, not the index — say so once. And these are cross-sectional statistics about
today's composition; they are not a claim about how the held asset has behaved or will behave.

---

## 10. Diagnostics that gate rendering

Each of these blocks its dependent metrics rather than caveating them.

| Diagnostic | Tolerance | Blocks |
|---|---|---|
| Weights reconcile to 1 | ±0.5% | Nothing, but reported prominently |
| Any leg lacks mark and implied vol | — | Weights reconciliation; mark-to-market for that leg |
| Implied vol at a bisection bound | σ ≤ 1e-3 or ≥ 4.99 | That leg's contribution to mark-to-market |
| Price at or below the underflow floor | `price ≤ BS(S,K,T,r,q,1e-4)` | That leg's implied vol entirely — see §1.5 |
| Leg priced off `fallback_iv` | — | Nothing, but the leg is labelled modelled rather than marked |
| Reference level solved from marks | residual > 5 index points | Everything; require a user-supplied level |
| Conditioned paths in capture | < 50 | That capture cell |
| Composition as-of vs structure as-of | > 90 days | Active share, with the gap stated |
| Structure has no long puts | — | Λ, attachment, floor scan, gradual decline |
| Structure has no held asset | — | Λ, concentration, active share |

---

## 11. Golden vectors

`vectors/example_a.json` and `vectors/example_c.json` are the frozen oracle outputs for the two
synthetic examples. The TypeScript core must reproduce them:

- Classification, exposure, geometry, mark-to-market, decline: to **1e-9**.
- Capture: to **1e-12 relative**, with the seeded uniform stream matching **exactly**.

That second line originally read "Capture: exactly — same seed, same PRNG, same draw order, same
floating-point result. If capture disagrees, the PRNG is wrong, not the model." It was amended on
evidence, and the evidence is worth keeping because it redirects the debugging effort the original
sentence would have sent in the wrong direction.

Bit-exact capture across Python and TypeScript is **not attainable**, and the PRNG is not why.
Measured on the samples in `vectors/primitives.json`:

| Quantity | Bit-identical, CPython 3.11 vs V8 |
|---|---|
| mulberry32 uniforms, 6 seeds × 1000 draws | **6000 / 6000 (100%)** |
| Box–Muller normals | 2836 / 3000 (94.5%), worst deviation 1 ulp |
| `Math.exp` | 90.3% |
| `Math.log` | 93.8% |

The integer pipeline has no floating point in it and agrees perfectly, so the brief's warning to get
the PRNG byte-exact before attempting Phase 6 is satisfiable and has been satisfied. But Box–Muller
calls `log` and `cos`, Black-Scholes calls `exp` and `erfc`, and no two runtimes round those
identically — none is correctly rounded, and V8's libm is not CPython's. A capture figure aggregating
20,000 paths of such calls cannot land on the same double.

So: **if capture disagrees at 1e-12, the model is wrong. If it disagrees in the last ulp, nothing is
wrong.** Anything that consumes only the uniform stream is still held to exactness.

The Type C vectors matter disproportionately despite the structure's simplicity. That example is what
caught both of the oracle's first-draft defects — the over-strict flatness tolerance and the silent
zero in the weights identity — because it exercises paths the Type A example does not: no held asset,
no marks, a put spread rather than a plain put, a single outcome period. Run both.

Regenerate with:

```
python3 reference/oracle.py examples/example_a_laddered_floor.json examples/example_scenario.json
python3 reference/oracle.py examples/example_c_minimal_hand_typed.json examples/scenario_minimal.json
```

Both commands reproduce their committed vector files byte for byte on CPython 3.11 and 3.12+.

Regenerate the Phase 1 primitives fixture with:

```
python3 reference/emit_primitives.py > vectors/primitives.json
```

Then freeze. The oracle is retired once the port passes.

---

## 12. Errata

Corrections made to this document during the TypeScript port, with what prompted each. This document
is the one that yields when it disagrees with `reference/oracle.py`, so these are amendments to the
spec, not changes to the model. The two exceptions are noted.

| # | Section | Correction |
|---|---|---|
| E-01 | §0 | Added the exact-summation convention. **This one did change the oracle**, from `sum()` to `math.fsum` at all 15 float accumulation sites. It was a genuine determinism defect, not a spec error: Python 3.12's compensated `sum()` meant the committed vectors would not reproduce on 3.11. The vectors themselves are unchanged — `fsum` agrees with 3.12's `sum()` on these inputs. |
| E-02 | §1.1 | Recorded that a rational minimax `erfc` was attempted and abandoned, with the measured accuracy of what replaced it. |
| E-03 | §1.5 | `fallback_iv` defaults to 0.20 and its use must be recorded per leg. The oracle's `l["iv"] or 0.2` does neither, which violates invariant 3; the core reproduces the number and keeps the provenance. Also flagged the falsy-coalesce. |
| E-04 | §1.5, §10 | Documented the underflow trap: a price at or below the Black-Scholes underflow floor makes every low σ a root, and bisection returns a plausible 5.66% that neither §10 condition catches. Found while building `vectors/primitives.json`. |
| E-05 | §2 | Stated that the architecture tests are ordered and that `synthetic` wins outright, which is why example C classifies as synthetic at `held_asset.weight == 0`. Defined `basis_live` and `protection_continues_below_lowest_strike`, which the oracle emits and this document did not mention. |
| E-06 | §6 | Stated that mark-to-market never consults `beta_down` and is a β = 1.0 figure by construction, and that the report must label it as such rather than printing a beta it did not use. |
| E-07 | §7 | Stated that replacement puts are priced at `q = 0`. |
| E-08 | §11 | Amended the capture gate from "exactly" to 1e-12 relative, on measured evidence, with the uniform stream still held to exactness. **The model is unchanged**; the gate was unmeetable as written. |
| E-09 | §4 | "A tolerance of 1e-6 declares nothing flat" is not what happens. On example A the residual slope is ~5.7e-4 per unit of reference move, which over one grid step of 5e-4 is only ~2.9e-7, so adjacent points near the bottom do fall inside 1e-6 and the scan still reports `flat_below`. What it gets wrong is *where*: the attachment migrates to −94.85%, saying the floor binds at the scan edge when it binds at −24.6%. The rule is unchanged — 5bp is still correct — but the symptom to recognise is a nonsense attachment, not a false flatness verdict. |

One discrepancy is recorded but **not** corrected here, because it is a gap rather than an error:
§9's active share and name coverage, and six of the eight §10 diagnostics, have no implementation in
`reference/oracle.py` and therefore no golden vectors. They will need property tests rather than
vector matching, and Phase 2's gate should not be mistaken for coverage of them.
