// SPDX-License-Identifier: CC-BY-4.0
//
// Prose is CC BY 4.0; surrounding code is MIT.

import { append, el } from '../dom.ts';

/**
 * A real page, linked in navigation, not a footer.
 *
 * The point of putting it in the navigation is that limitations discovered
 * after a number has been believed are worth much less than limitations read
 * beside it.
 */
export function limitationsView(): HTMLElement {
  const root = el('div', {});

  append(root, [
    el('h2', {}, 'What this page cannot tell you'),
    el('p', { class: 'lede' },
      'Everything here is arithmetic on a position you supplied, at index levels you chose. That ' +
      'makes some questions answerable and others not, and the difference is worth being clear about.'),
  ]);

  for (const [heading, paragraphs] of SECTIONS) {
    append(root, [el('h3', {}, heading), ...paragraphs.map((p) => el('p', {}, p))]);
  }

  append(root, [
    el('h3', {}, 'Licence'),
    el('p', { class: 'small' },
      'The code is MIT. The written explanations are CC BY 4.0 — they are the part of this project ' +
      'worth reusing, and they are meant to be quotable and translatable.'),
  ]);

  return root;
}

const SECTIONS: [string, string[]][] = [
  [
    'The rate at which your holdings move is an input, not a measurement',
    [
      'The single most important figure on the page — how far the fund’s own holdings fall relative ' +
      'to the index — is one you set with a slider. Nothing in a holdings file records it, and this ' +
      'page does not estimate it. It has no price history, no factor model and no way to work it out.',
      'That is a deliberate limit rather than a missing feature. Presenting a range and letting you ' +
      'move through it is honest about what is knowable from a position statement; presenting a single ' +
      'estimated number with error bars would suggest a precision that the input does not support.',
    ],
  ],
  [
    'The lowest point at expiry is not an amount anyone collects',
    [
      'Where a structure holds several tranches of puts expiring on different dates, there is no ' +
      'single day on which all of them settle. The lowest point the arithmetic reaches is a statement ' +
      'about a level, not about a sum of money arriving. It is shown beside the slow-decline figure ' +
      'for exactly that reason: the second is closer to what a year of falling markets does.',
    ],
  ],
  [
    'One path is not a distribution',
    [
      'The slow-decline figure follows a single hand-built path running steadily downward. Real ' +
      'markets do not, and a different path gives a different answer. It is included because a ' +
      'laddered floor behaves worst in a grind rather than a crash, and that fact is invisible in the ' +
      'expiry arithmetic — not because the particular number is precise.',
    ],
  ],
  [
    'The simulation is a model of a rule, not of a market',
    [
      'The upside-capture table simulates a simple rule — sell a call at a fixed distance, wait, ' +
      'repeat — under an assumption that index returns are smooth and lognormal. Real index returns ' +
      'are not. The table is useful for comparing one renewal frequency against another, which is a ' +
      'question the model can answer, rather than for predicting what any fund returns.',
    ],
  ],
  [
    'A position is a snapshot, and it ages',
    [
      'Every page carries the date the position was true. A holdings file from last quarter describes ' +
      'last quarter. Options expire, tranches roll, and a structure’s character can change ' +
      'substantially between statements.',
    ],
  ],
  [
    'Where a price is missing, the page says so rather than guessing',
    [
      'Contracts arriving without a price are valued at an assumed volatility, and every figure that ' +
      'depends on them is labelled accordingly. Where a check cannot be completed at all — the ' +
      'reconciliation against the fund’s size is the usual one — nothing is shown in its place. ' +
      'A blank with a reason is more use than a number with a caveat.',
    ],
  ],
  [
    'The comparison against an index is a comparison of two lists',
    [
      'It needs a composition file that you supply, and it compares the names and weights on two ' +
      'dates. A list downloaded from a fund that tracks an index is that fund’s holdings rather than ' +
      'the index itself. Neither figure says anything about how either set of holdings has behaved.',
    ],
  ],
  [
    'This is not advice, and it does not describe any particular product',
    [
      'There are no rankings here, no suggestion of what to hold, and no statement about how any fund ' +
      'is going to perform. If a report carries a ticker, you typed it: the arithmetic never sees it. ' +
      'What the page produces are measurements of a dated position and conditional arithmetic on ' +
      'assumptions you set.',
    ],
  ],
];
