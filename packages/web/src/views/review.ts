// SPDX-License-Identifier: MIT

import { append, clear, download, el, table } from '../dom.ts';
import { prepareStructure, type CollaredStructure, type Problem } from '@first-floor/core';
import type { AppState } from '../state.ts';

export interface ReviewHandlers {
  onDraftChange: (json: string) => void;
  onRun: () => void;
  onBack: () => void;
  onLoadComposition: (text: string) => void;
}

/**
 * The structure-document review. **Not an optional step** (D-23).
 *
 * Three things happen here that cannot happen anywhere else. The anatomy gets
 * taught — someone who has only ever seen "15% buffer" sees the four contracts
 * that produce it. The three input paths visibly converge, so a fact sheet and a
 * holdings file are evidently the same kind of object by the time they reach the
 * arithmetic. And mapping errors surface *before* they become a plausible
 * looking wrong number, which is the failure mode that would do real damage.
 */
export function reviewView(state: AppState, h: ReviewHandlers): HTMLElement {
  const root = el('div', {});

  append(root, [
    el('h2', {}, 'Check the position before anything is worked out'),
    el('p', { class: 'lede' },
      'This is what the page understood. Every figure in the report comes from these contracts, so ' +
      'it is worth a moment now — a mis-read strike produces a report that looks entirely reasonable ' +
      'and is entirely wrong.'),
  ]);

  const anatomy = el('div', {});
  const problems = el('div', {});

  const editor = el('textarea', { spellcheck: 'false' }, state.draft) as HTMLTextAreaElement;
  editor.addEventListener('input', () => {
    h.onDraftChange(editor.value);
    refresh();
  });

  const runButton = el('button', { class: 'primary', onclick: h.onRun }, 'Work out the report');

  function refresh(): void {
    clear(anatomy);
    clear(problems);
    const ok = state.structure !== null && state.problems.length === 0;
    (runButton as HTMLButtonElement).disabled = !ok;
    runButton.style.opacity = ok ? '1' : '0.45';
    runButton.style.cursor = ok ? 'pointer' : 'not-allowed';

    if (state.problems.length > 0) {
      append(problems, [problemList(state.problems)]);
      return;
    }
    if (state.structure) append(anatomy, anatomySection(state.structure));
  }

  append(root, [
    problems,
    anatomy,
    el('h3', {}, 'The document itself'),
    el('p', { class: 'small faint' },
      'Editable. Changes take effect as you type, and anything invalid is reported above rather than ' +
      'carried quietly into the arithmetic.'),
    editor,
    el('div', { class: 'row' },
      runButton,
      el('button', {
        onclick: () => download('structure.json', editor.value),
      }, 'Download this document'),
      compositionButton(h),
      el('button', { onclick: h.onBack }, 'Start again'),
    ),
    state.composition
      ? el('p', { class: 'small' },
          `Index composition loaded, dated ${state.composition.as_of}. The report compares the held ` +
          'names against it.')
      : el('p', { class: 'small faint' },
          'No index composition loaded. Without one the report leaves out the comparison against the ' +
          'index rather than guessing at it.'),
  ]);

  refresh();
  return root;
}

function compositionButton(h: ReviewHandlers): HTMLElement {
  const input = el('input', { type: 'file' }) as HTMLInputElement;
  input.style.display = 'none';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => h.onLoadComposition(String(reader.result ?? ''));
    reader.readAsText(file);
  });
  const button = el('button', { onclick: () => input.click() }, 'Add an index composition');
  return el('span', {}, button, input);
}

function problemList(problems: Problem[]): HTMLElement {
  return el('div', { class: 'blocked' },
    el('strong', {}, problems.length === 1 ? 'One thing to fix' : `${problems.length} things to fix`),
    el('ul', {}, ...problems.map((p) => el('li', {}, p.message))),
  );
}

/**
 * The anatomy: what each contract does, in terms of the reference level rather
 * than its own units.
 *
 * Moneyness is shown against the reference deliberately. A structure may hold
 * puts on a tenth-scale proxy and calls on the index itself, and a strike of 584
 * beside a level of 7,748 looks like a mistake until the ratio is applied. This
 * is exactly where a mis-mapped column shows itself.
 */
function anatomySection(doc: CollaredStructure): HTMLElement[] {
  const prepared = prepareStructure(doc);
  const refLevel = prepared.referenceLevel;

  const rows = prepared.legs.map((l) => {
    const strikeOnRefAxis = l.K / l.ratio;
    const moneyness = strikeOnRefAxis / refLevel - 1;
    const days = Math.round(l.T * 365);
    return [
      l.id,
      `${l.sign > 0 ? 'own' : 'sold'} ${l.right}`,
      fmt(l.K),
      l.ratio === 1 ? 'the index' : `${l.ratio}× the index`,
      `${moneyness >= 0 ? '+' : ''}${(moneyness * 100).toFixed(1)}%`,
      `${days}d`,
      l.units.toLocaleString('en'),
      l.mark === null ? '—' : fmt(l.mark),
      l.ivSource === 'stated' ? 'given' : l.ivSource === 'inverted' ? `${(l.iv * 100).toFixed(1)}%` : 'assumed',
    ];
  });

  const unmarked = prepared.legs.filter((l) => l.ivSource === 'fallback').map((l) => l.id);

  const out: HTMLElement[] = [
    el('h3', {}, 'The contracts'),
    table(
      ['Leg', 'Position', 'Strike', 'On', 'Against today', 'Left', 'Units', 'Price', 'Volatility'],
      rows,
    ),
    el('p', { class: 'small' },
      `“Against today” places every strike on the index’s own scale, so a contract on a proxy at ` +
      `${fmt(refLevel * 0.1)} and one on the index at ${fmt(refLevel)} can be read in the same column. ` +
      'If a strike here looks implausible, the file was probably read wrongly.'),
  ];

  if (unmarked.length > 0) {
    out.push(el('div', { class: 'blocked' },
      el('strong', {}, 'Some contracts came without a price'),
      el('p', { class: 'small' },
        `${unmarked.join(', ')} carry neither a price nor a volatility, so their values are modelled ` +
        'rather than measured. The report says so wherever it matters, and the reconciliation against ' +
        'the fund’s size is left out entirely rather than filled in with a guess.'),
    ));
  }

  const summary = [
    ['Dated', doc.as_of],
    ['Index level', fmt(refLevel)],
    ['Held assets', `${((doc.held_asset.weight ?? 0) * 100).toFixed(1)}% of the fund`],
    ['Cash', `${((doc.capital.cash_weight ?? 0) * 100).toFixed(1)}%`],
    ['Fund size', doc.capital.net_assets.toLocaleString('en')],
    ['Contracts', String(doc.option_legs.length)],
  ];

  out.unshift(
    el('h3', {}, 'In summary'),
    table(['', ''], summary),
  );

  return out;
}

function fmt(x: number): string {
  return x.toLocaleString('en', { maximumFractionDigits: 2 });
}
