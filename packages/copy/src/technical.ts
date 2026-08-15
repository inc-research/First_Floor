// SPDX-License-Identifier: CC-BY-4.0
//
// The technical deck. Same numbers, same caveats, different vocabulary.
//
// The banned-word lint does not apply here: a specialist reading "the puts
// protect below the attachment point" understands it as a description of a
// payoff, not a promise. What does still apply is the measurement/forecast
// distinction — nothing here says what a structure is going to do.

import type { Deck } from './types.ts';

export const technicalDeck: Deck = {
  classification: {
    title: 'Classification',
    mechanism:
      'Architecture, protection kind and reset cadence are derived from the legs, never trusted from role hints. A long call struck near zero is a synthetic long and dominates the classification. A short put anywhere makes the downside a put spread, which terminates protection at the lower strike rather than continuing it indefinitely.',
    whatWouldChangeIt:
      'The leg set. Classification is a function of strikes, rights, positions and expiries only.',
    whenAbsent: 'The leg set matches no known architecture; unclassified is a legitimate output.',
  },

  advertised_vs_computed: {
    title: 'Advertised versus computed',
    mechanism:
      'The published protection percentage against the computed terminal floor and lowest attachment. A buffer quoted from an inception level and a floor computed from today\'s spot are not the same measurement, and the comparability flag says which case applies.',
    whatWouldChangeIt:
      'Distance travelled since the outcome period began. Mid-period, the two diverge by roughly the reference move.',
    whenAbsent: 'No advertised block was supplied on the structure document.',
  },

  terminal_floor: {
    title: 'Terminal floor',
    mechanism:
      'Minimum of the terminal payoff over reference moves from −95% to 0 on a 1901-point grid, reported at the shallowest move attaining it. Below the lowest strike the position\'s delta with respect to the reference is w_eq·β_d/S₀ − Σ units/NAV, which vanishes at β_d = Λ. Flatness is tested to 5bp; a tighter tolerance reports an attachment at the scan edge.',
    whatWouldChangeIt:
      'β_d relative to Λ. Note also that tranches expire across several dates, so the floor is not a collectible outcome and belongs beside the gradual-decline figure.',
    whenAbsent: 'No long puts, so there is no attachment and no floor to scan for.',
  },

  beta_conditional_floor: {
    title: 'Beta-conditional floor',
    mechanism:
      'Terminal value across a grid of held-asset betas. Λ ≈ 1 means the ladder is sized to neutralise a beta-one held asset; it does not mean the held asset is beta-one. Where β_d > Λ a residual short of w_eq·(β_d − Λ) survives below the ladder, producing a level effect at the attachment point and a slope effect below it. Above the cap the term flips sign, so the structure is a risk transformation rather than a defect: better in rallies, worse in selloffs, and invisible to a symmetric tracking-error statistic.',
    whatWouldChangeIt:
      'β_d. It is an input and is swept; the tool does not estimate it from returns and does not require constituent price history.',
    whenAbsent: 'Λ is undefined without long puts and a positive held-asset weight.',
  },

  mark_to_market: {
    title: 'Mark-to-market under a volatility shock',
    mechanism:
      'Legs repriced at σ_shocked = max(0.02, σ_leg + vol_beta·max(0, −d)), with base volatilities inverted from the legs\' own marks rather than from a modelled surface. vol_beta is volatility points added per unit of reference drawdown; 0.65 gives +13 points at −20%. The held asset enters at unit beta by construction: this block does not consult β_d.',
    whatWouldChangeIt:
      'vol_beta. The spread between 0 and 1.0 at −20% exceeds four points on the reference example, which is why it is swept and never reported bare.',
    whenAbsent: 'One or more legs supply neither a mark nor an implied volatility.',
  },

  gradual_decline: {
    title: 'Gradual decline',
    mechanism:
      'Monotone path S(t) = S₀·(1 + total_move)^(t/horizon). Floor tranches reaching expiry realise intrinsic value into cash and are replaced at a fixed percentage of the then-current spot, funded from cash at the replacement volatility. Survivors are marked at the horizon and the expense ratio is pro-rated. Replacement puts are priced at q = 0.',
    whatWouldChangeIt:
      'The path. A monotone decline is the best case for a call writer — no roll is ever assigned — so the overlay is excluded by default. This is one path, not a distribution.',
    whenAbsent: 'No long puts to roll.',
  },

  positioning: {
    title: 'Exposure and notional',
    mechanism:
      'Market value is nearly useless here; notional is everything. Put spot notional, insured value, short-call spot notional and gross option notional, all over NAV, plus Λ, attachment and net delta. Gross notional near 196% against an option book worth 0.3% is offsetting rather than levered — the legs face opposite directions and the calls are covered. What it creates is basis, not gearing.',
    whatWouldChangeIt:
      'Contract counts against NAV. Average attachment is not a floor: compute the floor, never infer it from the mean strike.',
    whenAbsent: 'The weights identity is not computable when any leg lacks a mark.',
  },

  reset_cadence: {
    title: 'Reset asymmetry',
    mechanism:
      'Mean remaining life of long puts over mean remaining life of short calls, in days. A ratio near 20 — an annual floor against a fortnightly cap — behaves very differently in a trend from a ratio near 1.',
    whatWouldChangeIt:
      'Expiry dates alone — the ratio is a function of the leg calendar and nothing else. It is also the figure most distorted by a partial holdings file: drop one long-dated put tranche and the mean floor life collapses toward the cap life, understating the asymmetry.',
    whenAbsent: 'One side has no legs, so the ratio is undefined.',
  },

  capture: {
    title: 'Upside capture',
    mechanism:
      'Monte Carlo of a constant-delta overwrite calibrated to the structure\'s own short-call spot notional, conditioned on paths finishing within a band of the target reference move. Conditioning rather than a raw ratio, because a ratio of two small numbers is unstable as the denominator approaches zero. Overwriting is a positive-carry trade with a truncated up-tail, not a permanent haircut, and a constant-delta strike is an inverse proxy for the cost of downside skew rather than a directional view.',
    whatWouldChangeIt:
      'Tenor and target delta. Shorter tenors forfeit less in a trend, because each roll re-strikes from the new level. Note the realisation label: for rolling caps a shortfall is realised and permanent, whereas for a single outcome period it is largely unrealised time value that reverses mechanically by expiry.',
    whenAbsent: 'Fewer than 50 conditioned paths, or no capture block on the scenario.',
  },

  concentration: {
    title: 'Concentration',
    mechanism:
      'HHI over weights normalised to sum to 1, with effective N its reciprocal. Cross-sectional only.',
    whatWouldChangeIt:
      'Completeness of the constituent list; check weights_sum_raw before reading the effective count. These are statistics about today\'s composition, not a claim about realised or prospective behaviour.',
    whenAbsent: 'No constituents supplied.',
  },

  active_share: {
    title: 'Active share',
    mechanism:
      'Half the sum of absolute active weights against a user-supplied reference composition, with name coverage reported alongside. Both sides are normalised before differencing. Names present on one side only carry full active weight and are enumerated.',
    whatWouldChangeIt:
      'The composition supplied. A composition sourced from a tracking fund\'s published holdings is that fund\'s holdings, not the index. A composition materially staler than the position blocks the statistic rather than joining quietly.',
    whenAbsent: 'No reference composition supplied; the section is omitted rather than estimated.',
  },
};
