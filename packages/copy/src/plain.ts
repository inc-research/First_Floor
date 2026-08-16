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
//
// Apostrophes and inner quotation marks are typographic (’ and ‘…’) throughout.
// The strings are single-quoted, so a straight apostrophe closes the string and
// breaks the build; this is a convention with teeth rather than a house style.

import type { Deck } from './types.ts';

export const plainDeck: Deck = {
  classification: {
    title: 'What this is',
    mechanism:
      'The numbers that you are paying the fund to manage. The level of the fund’s floor and ceiling relative to the primary asset(s) held by the fund are read from the contracts themselves rather than a fund’s promotional material: puts (that set the floor or buffer) owned below the price of the reference index, calls (which set the ceiling or capped upside) sold above the price of the reference index, and the actual assets which are held by the fund in between. Where a put has also been sold, the pair pays down (constructing a degree of buffer) only as far as the lower strike and then stops, and below that 1-to-1 losses resume at the full rate. Looking at these levels is critically important to understanding the operating mechanics of the fund. Looking at these levels using a tool like First Floor invokes the Sean Carter quote concerning the honesty of numbers.',
    whatWouldChangeIt:
      'A different set of strike prices and expiry dates for the options held by the fund. The label follows the contracts, so a holdings file missing some of those options reads as a different fund strategy.',
    whenAbsent: 'The contracts on file do not form a recognisable arrangement.',
  },

  advertised_vs_computed: {
    title: 'The advertised number, and the one the fund’s options currently give',
    mechanism:
      'The fund’s promotional material and fact sheet quote one figure. The active level of the buffer or floor comes from the hard numbers in the holdings file measured against where the reference index sits today. The two numbers answer different questions. The advertised figure is usually measured from the price of the reference index at the start of the ‘outcome period’, or when the fund first placed the options which are still active against the movement of the reference index. The current number describes the position of the options relative to where the market stands now.',
    whatWouldChangeIt:
      'How far the reference index value has risen or fallen since the active buffer or floor was put into place. The further it has moved, the further apart the two figures sit — and if the market has risen, the market has to fall further before it reaches whatever buffer or floor has been implemented.',
    whenAbsent: 'No published figure was entered for comparison.',
  },

  terminal_floor: {
    title: 'The lowest bottom at the expiry of the fund’s options',
    mechanism:
      'Below the lowest strike price every put owned is ‘in the money’, and those puts pay the difference between their strike price and where the reference index stopped its decline in price. Add those payments to what the assets held by the fund are worth at that market level and the total decline in value stops moving: further falls in the market are matched, penny for penny, by larger payments from the puts. The bottom where the losses reach a maximum level is this figure.',
    whatWouldChangeIt:
      'Whether the held assets fall at the same rate as the reference. It is very important to note that not every fund in this category owns the reference asset as the ‘core holding’. Some funds hold a long call which is considered a ‘synthetic holding’ of the reference index, because the value of that call is generally understood to rise and fall with the price of the reference index. Some funds hold individual equities which may, or may not, be held at the same weighting as the reference index...and sometimes a few of those equities won’t be in the reference index at all. Typically, these funds advertise that they are trying to benchmark their returns against a reference index, and that doesn’t mean that they have to get there by owning the actual index (although some funds provide direct exposure to a full-index ETF as the core holding that accompanies the options placement). The lowest bottom is only flat when the reference index and the core holding move together one-for-one. It is also worth knowing that the tranches (sets) of options expire on different dates, so there is no single day on which all of these payments arrive — this is a mathematical calculation about a numerical balance, not a dollar amount anyone can collect.',
    whenAbsent: 'This arrangement owns no puts, so there is no level at which falls stop being painful.',
  },

  beta_conditional_floor: {
    title: 'What happens if the holdings fall faster than the index',
    mechanism:
      'The puts are written against a fixed number of reference index units (such as the dollar amount which represents a certain percentage of correction in the reference index price), so in the case detailed above where the fund may not hold the reference index and chooses instead to hold a synthetic long on the index or a smaller selection of single equities, those puts pay based on what the reference index shares did, not what the fund’s own shares did. The ‘floor’ is level only when the fund’s holdings fall at the same rate as the reference index. If the fund’s holdings fall faster, the extra fall is irrelevant to what the floor is placed under, and the downside grows with the depth of the decline rather than staying fixed. The same mechanics work in the fund’s favour in a stronger rise in the fund’s holding compared to the reference index (again, if the fund has core holdings other than the reference index), which is why this is a benign feature of the funds instead of fatally flawed logic.',
    whatWouldChangeIt:
      'The rate at the head of each column. That rate is an input here, not a measurement — nothing in a holdings file records it, and this tool does not estimate it, this tool only calculates it as a variable.',
    whenAbsent: 'Without puts and a holding to set them against, there is no rate to vary.',
  },

  mark_to_market: {
    title: 'What it would be worth partway down, before anything expires',
    mechanism:
      'Until expiry (the date that an option held by the fund expires) the puts are worth more relative to the degree they are currently ‘in the money’, and a sharp fall raises that worth further, because the price of an option rises when a market starts moving quickly. This number is what the position marks-to-market as during price declines in the reference index, as opposed to the relative worth in a settled state.',
    whatWouldChangeIt:
      'How violent the fall is. A slow drift adds very little to option prices while a crash adds a great deal, and the report columns span that range. That spread is the size of the considered variability (and not total variability), which is why it is shown as a range and not as one number.',
    whenAbsent: 'Some contracts carry no price, so their value part way down cannot be worked out.',
  },

  gradual_decline: {
    title: 'A slow bleed rather than a crash',
    mechanism:
      'Each tranche of puts has its own expiry date. If the market is still falling when one of the tranches expires, it pays out, and that money buys a replacement struck against the new, lower level. Repeat this through a year of steady decline and the position finishes lower than the expiry arithmetic on its own suggests, because each replacement tranche constructing the floor or buffer is placed relative to a price of the reference index that has continued to gradually lower.',
    whatWouldChangeIt:
      'The shape of the path; whether it sustains bounces which slow the correction or just goes the wrong way a little more each day. This scenario is one hand-built decline running steadily in one direction, not an average across many. A steady fall is also the kindest case for the calls that were sold, since none of them is ever called away, so the figure shown leaves the calls out entirely rather than counting a benefit that a real path would not hand over.',
    whenAbsent: 'This arrangement owns no puts to expire and replace.',
  },

  positioning: {
    title: 'How much of the fund’s NAV is actually being tracked by the options',
    mechanism:
      'Options used in the context of these funds can provide far more value than they cost in the event that they are exercised. This creates two inputs on the holdings report; the actual cost of the options and the value if-or-when they are exercised. The puts here cover an amount close to the size of the whole fund while the contracts themselves are worth a fraction of a percent of it. The calls sold are covered by shares already held by the fund, so the large total is offsetting rather than borrowed. What it creates is a dependence on the index and the holdings moving together, not extra gearing.',
    whatWouldChangeIt:
      'The number of contracts set against the size of the fund. If the holdings file lists only part of the position, everything here reads smaller than it is.',
    whenAbsent: 'Some contracts carry no price, so the totals cannot be reconciled against the fund.',
  },

  reset_cadence: {
    title: 'How often each side of the options structure renews',
    mechanism:
      'The puts and the calls placed by the funds typically run on different clocks. When the puts have months left and the calls renew every couple of weeks, a sustained rise re-strikes the calls higher again and again while the puts stay where they are. This means that the calls representing one side of the possible outcomes defined by these funds changes more quickly, and likely to a larger degree, than the puts constructing the floor or buffer.',
    whatWouldChangeIt:
      'Nothing but the expiry dates of the options tranches on file. This is the figure most easily thrown off by a partial list: leave out one long-dated tranche of puts and the two sides look far closer together than they are.',
    whenAbsent: 'One side of the arrangement is missing, so there is nothing to compare.',
  },

  capture: {
    title: 'How much upside capture is currently available',
    mechanism:
      'Selling a call takes in a premium now and gives up anything above the strike later. When the reference index finishes below that strike the position keeps the whole move and the premium as well; when the index finishes above the call strike, the amount above the strike goes to the buyer, not the fund. When the core holdings of the fund differ from the index, this strike price affects the potential upside realized by shareholders when the fund’s core assets are increasing at a faster rate relative to the reference index. Sometimes, the house keeps the alpha generated by the core holdings relative to the reference index once the index hits the strike price on the sold call. This, and so many other reasons, is why the fund prospectus repays a careful read, with notes taken on the official policies dictating upside capture to the fund’s investors.',
    whatWouldChangeIt:
      'How far above the market the calls are struck and how often they renew. Shorter renewal periods keep more of a sustained rise, not less, because each new call is struck from wherever the market has already reached — which is the opposite of what most readers expect. Striking further out keeps more of the rise and takes in less income for doing so; that distance reflects what buyers are paying for downside cover, and is not a view on direction.',
    whenAbsent: 'No simulation of the sold calls was requested.',
  },

  concentration: {
    title: 'How are the core holdings of the fund weighted',
    mechanism:
      'The effective count answers one question: how many equally sized holdings behave like this mix? In other words: how much of this list is names stuffed into a spreadsheet instead of allocations made targeting desired fund dynamics like growth or stability? A list of six names where one of them is seven tenths of the money behaves much more like two holdings than like six.',
    whatWouldChangeIt:
      'A fuller list of holdings. Where a file gives only the largest names, the mix reads as more concentrated than the whole. It is worth noting that this describes the list as it stands on the day the file was captured — how that mix has behaved in the past, and how it might behave from here, are different questions and this figure answers neither.',
    whenAbsent: 'No list of holdings was supplied, so there is nothing to count.',
  },

  active_share: {
    title: 'How different are the core holdings of the fund from the reference index',
    mechanism:
      'Line the two lists up name by name, take the difference in each name’s weight, and add those differences up. Half that total is the figure. Zero means the two lists match exactly; one means they have no holding in common. Names appearing on only one side count in full and are listed by name, this list is where you can see how the fund managers are streamlining and re-weighting index names and sometimes augmenting the fund outside the bounds of the reference index.',
    whatWouldChangeIt:
      'The fund or index composition file supplied. A list downloaded from a fund that tracks the index is that fund’s holdings rather than the index itself, and the two differ. This compares two lists as they stand at the moment the data was captured, and it says nothing about how either list has behaved, or how either might behave from here.',
    whenAbsent: 'No index composition was supplied, so there is nothing to compare the holdings against.',
  },
};
