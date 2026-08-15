// SPDX-License-Identifier: MIT

import { el, append } from '../dom.ts';
import { exampleALadderedFloor, exampleCMinimalBuffer } from '../examples.generated.ts';
import type { AppState } from '../state.ts';

export interface StartHandlers {
  onDraft: (json: string) => void;
  onManual: () => void;
  onMapCsv: () => void;
}

/**
 * The three input paths. They converge on one structure document, which is why
 * every one of them ends by handing a draft to the review step rather than
 * going straight to a report (D-23, brief §8).
 */
export function startView(_state: AppState, h: StartHandlers): HTMLElement {
  const root = el('div', {});

  append(root, [
    el('p', { class: 'lede' },
      'A fact sheet states a buffer or a floor. That number is correct, and it answers a different ' +
      'question from the one you are asking. Give this page a position and it works out what the ' +
      'contracts actually do in a decline.'),
    el('p', { class: 'small' },
      'Nothing is fetched and nothing is uploaded. The file you choose is read here in the browser, ' +
      'and there is no server for it to go to.'),
  ]);

  append(root, [el('h2', {}, 'Start from')]);

  const cards = el('div', { class: 'cards' });

  // --- path one: an existing structure document -----------------------------
  const fileInput = el('input', { type: 'file' });
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => h.onDraft(String(reader.result ?? ''));
    reader.readAsText(file);
  });

  append(cards, [
    card(
      'A holdings file',
      'Any CSV. Say which column is which — once — and keep that as a small file you can reuse next ' +
      'quarter or pass to anyone using the same broker.',
      h.onMapCsv,
    ),
    card(
      'A structure document',
      'A JSON file describing the position — the format this page reads and writes. If you have ' +
      'one from a previous visit, or from the command-line tool, open it here.',
      () => fileInput.click(),
    ),
    card(
      'Numbers from a fact sheet',
      'Six figures typed by hand: where the index is now, where it was when the outcome period ' +
      'began, the downside cover, the cap, the end date and the fund size. Enough to rebuild the ' +
      'contracts.',
      h.onManual,
    ),
    card(
      'A worked example',
      'Two invented structures — a laddered floor over a basket, and a single-period buffer. ' +
      'Neither describes a real product. Useful for seeing the shape of a report before typing ' +
      'anything of your own.',
      () => h.onDraft(JSON.stringify(exampleALadderedFloor, null, 2)),
    ),
  ]);

  append(root, [cards, fileInput]);

  append(root, [
    el('p', { class: 'small faint' }, 'Or load the single-period buffer example: ',
      linkButton('the hand-typed buffer', () => h.onDraft(JSON.stringify(exampleCMinimalBuffer, null, 2)))),
  ]);

  append(root, [
    el('h2', {}, 'What this does not do'),
    el('ul', { class: 'small' },
      el('li', {}, 'It does not fetch data, monitor anything, or run on a schedule.'),
      el('li', {}, 'It does not rank funds, recommend anything, or say what to hold.'),
      el('li', {}, 'It does not know the name of any product. If you label a report, that label came from you.'),
      el('li', {}, 'It does not forecast. Everything it prints is arithmetic on a dated position at index levels you choose.'),
    ),
  ]);

  return root;
}

function card(title: string, body: string, onclick: () => void): HTMLElement {
  return el('button', { class: 'card', onclick }, el('h3', {}, title), el('p', {}, body));
}

function linkButton(label: string, onclick: () => void): HTMLElement {
  const b = el('button', { onclick }, label);
  b.style.padding = '0.15rem 0.4rem';
  return b;
}
