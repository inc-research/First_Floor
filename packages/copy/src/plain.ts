// SPDX-License-Identifier: CC-BY-4.0
//
// The plain-English deck. Prose is CC BY 4.0; the surrounding code is MIT.
//
// Every sentence here is hand-written, and the rule behind all of them is that
// jargon gets replaced by mechanism, never by a verdict. Not "you are protected
// below −10%" but "if the reference ends below 584, those contracts pay the
// difference between 584 and where it ended."
//
// Banned words, lint-enforced: protect, protected, safe, guarantee, guaranteed,
// should, will, ensures. Conditional constructions instead of future tense.

import type { Deck } from './types.ts';

export const plainDeck: Deck = {
  classification: {
    title: 'What this is',
    mechanism:
      'The shape is read off the contracts themselves rather than off what the fact sheet calls it: puts owned below the market, calls sold above it, and whatever the fund holds in between. Where a put has also been sold, the pair pays only down as far as the lower strike and then stops, and below that level losses resume at the full rate.',
    whatWouldChangeIt:
      'A different set of strikes and expiry dates. The label follows the contracts, so a holdings file missing some legs reads as a different shape.',
    whenAbsent: 'The contracts on file do not form a recognisable arrangement.',
  },

  advertised_vs_computed: {
    title: 'The fact sheet number, and the one the contracts give',
    mechanism:
      'The fact sheet quotes one figure. The other comes from the strikes in the holdings file measured against where the reference sits today. The two answer different questions: the published figure is usually measured from the level at the start of the outcome period, and this one from where things stand now.',
    whatWouldChangeIt:
      'How far the reference has travelled since the period began. The further it has moved, the further apart the two figures sit — and if the market has risen, the published figure flatters what is left.',
    whenAbsent: 'No published figure was entered for comparison.',
  },

  terminal_floor: {
    title: 'The lowest point the arithmetic reaches at expiry',
    mechanism:
      'Below the lowest strike every put owned is in the money, and each one pays the difference between its strike and where the reference ended. Add those payments to what the held assets are worth at that level and the total stops moving: further falls in the market are matched, penny for penny, by larger payments from the puts. That flat level is this figure.',
    whatWouldChangeIt:
      'Whether the held assets fall at the same rate as the reference. The flat part is only flat when the two move together one for one. It is also worth knowing that the tranches expire on different dates, so there is no single day on which all of these payments arrive — this is arithmetic about a level, not an amount anyone can collect.',
    whenAbsent: 'This arrangement owns no puts, so there is no level at which falls stop being felt.',
  },

  beta_conditional_floor: {
    title: 'What happens if the holdings fall faster than the index',
    mechanism:
      'The puts are written against a fixed number of index units, so they pay the same amount regardless of what the fund’s own shares did. The floor is level only when the holdings fall at the same rate as the index. If the holdings fall faster, the extra fall is met by nothing, and the shortfall grows with the depth of the decline rather than staying fixed. The same arithmetic works in the fund’s favour in a strong rise, which is why this is a change in the shape of the risk rather than a fault.',
    whatWouldChangeIt:
      'The rate at the head of each column. That rate is an input here, not a measurement — nothing in a holdings file records it, and this tool does not estimate it.',
    whenAbsent: 'Without puts and a holding to set them against, there is no rate to vary.',
  },

  mark_to_market: {
    title: 'What it would be worth partway down, before anything expires',
    mechanism:
      'Ahead of expiry the puts are worth more than the amount they are currently in the money by, and a sharp fall raises them further, because the price of an option rises when a market starts moving quickly. This is what the position marks at on the way down, as opposed to what it settles at on the day.',
    whatWouldChangeIt:
      'How violent the fall is. A slow drift adds very little to option prices while a crash adds a great deal, and the columns span that range — on the reference example they differ by more than four percentage points at a fall of a fifth. That spread is the size of the assumption, which is why it is shown as a range and not as one number.',
    whenAbsent: 'Some contracts carry no price, so their value part way down cannot be worked out.',
  },

  gradual_decline: {
    title: 'A slow grind rather than a crash',
    mechanism:
      'Each tranche of puts has its own expiry date. If the market is still falling when one of them expires, it pays out, and that money buys a replacement struck against the new, lower level. Repeat this through a year of steady decline and the position finishes lower than the expiry arithmetic on its own suggests, because each replacement starts from further down.',
    whatWouldChangeIt:
      'The shape of the path. This is one hand-built decline running steadily in one direction, not an average across many. A steady fall is also the kindest case for the calls that were sold, since none of them is ever called away, so the figure shown leaves the calls out entirely rather than counting a benefit that a real path would not hand over.',
    whenAbsent: 'This arrangement owns no puts to expire and replace.',
  },

  positioning: {
    title: 'How much is actually being tracked',
    mechanism:
      'Options control far more value than they cost. The puts here cover an amount close to the size of the whole fund while the contracts themselves are worth a fraction of a percent of it. The two sides face in opposite directions and the calls sold are covered by shares already held, so the large total is offsetting rather than borrowed. What it creates is a dependence on the index and the holdings moving together, not extra gearing.',
    whatWouldChangeIt:
      'The number of contracts set against the size of the fund. If the holdings file lists only part of the position, everything here reads smaller than it is.',
    whenAbsent: 'Some contracts carry no price, so the totals cannot be reconciled against the fund.',
  },

  reset_cadence: {
    title: 'How often each side renews',
    mechanism:
      'The puts and the calls run on different clocks. When the puts have months left and the calls renew every couple of weeks, a sustained rise re-strikes the calls higher again and again while the puts stay where they are. The ratio between the two lives is the clearest single fact about how the arrangement behaves in a trend.',
    whatWouldChangeIt:
      'Nothing but the expiry dates on file. That also makes this the figure most easily thrown off by a partial list: leave out one long-dated tranche of puts and the two sides look far closer together than they are.',
    whenAbsent: 'One side of the arrangement is missing, so there is nothing to compare.',
  },

  capture: {
    title: 'How much of a rise gets kept',
    mechanism:
      'Selling a call takes in a premium now and gives up anything above the strike later. When the reference finishes below that strike the position keeps the whole move and the premium as well; when it finishes above, the amount above the strike goes to the buyer. Across many paths that all end in the same place, this is the share of the rise that stays with the fund. It is a trade with income attached and a trimmed top end, not a standing deduction.',
    whatWouldChangeIt:
      'How far above the market the calls are struck and how often they renew. Shorter renewal periods keep more of a sustained rise, not less, because each new call is struck from wherever the market has already reached — which is the opposite of what most readers expect. Striking further out keeps more of the rise and takes in less income for doing so; that distance reflects what buyers are paying for downside cover, and is not a view on direction.',
    whenAbsent: 'No simulation of the sold calls was requested.',
  },

  concentration: {
    title: 'How spread out the holdings are',
    mechanism:
      'The effective count answers one question: how many equally sized holdings behave like this mix? A list of six names where one of them is seven tenths of the money behaves much more like two holdings than like six.',
    whatWouldChangeIt:
      'A fuller list of holdings. Where a file gives only the largest names, the mix reads as more concentrated than the whole. This is a description of the list as it stands today, not a statement about how it has behaved or how it might.',
    whenAbsent: 'No list of holdings was supplied, so there is nothing to count.',
  },

  active_share: {
    title: 'How far the holdings sit from the index',
    mechanism:
      'Line the two lists up name by name, take the difference in each name’s weight, and add those differences up. Half that total is the figure. Nought means the two lists match exactly; one means they have no holding in common. Names appearing on only one side count in full and are listed by name rather than quietly dropped.',
    whatWouldChangeIt:
      'The composition file supplied. A list downloaded from a fund that tracks the index is that fund’s holdings rather than the index itself, and the two differ. This compares two lists as they stand on their dates; it says nothing about how either has behaved.',
    whenAbsent: 'No index composition was supplied, so there is nothing to compare the holdings against.',
  },
};
