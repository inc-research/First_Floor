// SPDX-License-Identifier: MIT

/**
 * The page.
 *
 * Everything happens here in the browser (D-22): the file is read locally and
 * never uploaded, there is no backend, no account and no telemetry. The build
 * asserts that this bundle contains no network call sites at all, so the claim
 * is checked rather than made.
 */

import { append, clear, el } from './dom.ts';
import {
  computeReport,
  initialState,
  loadComposition,
  validateDraft,
  type AppState,
  type View,
} from './state.ts';
import { startView } from './views/start.ts';
import { manualView } from './views/manual.ts';
import { mapperView } from './views/mapper.ts';
import { reviewView } from './views/review.ts';
import { reportView } from './views/report.ts';
import { limitationsView } from './views/limitations.ts';
import type { Voice } from '@first-floor/copy';

const state: AppState = initialState();

function go(view: View): void {
  state.view = view;
  render();
  window.scrollTo(0, 0);
}

function setDraft(json: string): void {
  state.draft = json;
  const { structure, problems } = validateDraft(state);
  state.structure = structure;
  state.problems = problems;
  state.report = null;
}

function render(): void {
  const app = document.getElementById('app');
  if (!app) return;
  clear(app);
  append(app, [masthead(), body(), disclaimer()]);
}

function masthead(): HTMLElement {
  const nav = el('nav', { class: 'masthead-nav' });

  const link = (label: string, view: View, enabled = true) =>
    el('a', {
      'aria-current': state.view === view ? 'page' : 'false',
      onclick: () => {
        if (enabled) go(view);
      },
    }, label);

  append(nav, [
    link('Start', 'start'),
    state.structure ? link('Position', 'review') : null,
    state.report ? link('Report', 'report') : null,
    link('Limitations', 'limitations'),
  ]);

  const head = el('header', { class: 'masthead' },
    el('h1', {}, 'First Floor ', el('span', {}, '· a calculator for buffered and floored funds')),
  );

  // Every page carries the as-of date of the position it describes.
  if (state.structure) {
    append(head, [el('span', { class: 'as-of' }, `Position dated ${state.structure.as_of}`)]);
  }
  append(head, [nav]);
  return head;
}

function body(): HTMLElement {
  switch (state.view) {
    case 'start':
      return startView(state, {
        onDraft: (json) => {
          setDraft(json);
          go('review');
        },
        onManual: () => go('manual'),
        onMapCsv: () => go('mapper'),
      });

    case 'mapper':
      return mapperView({
        onDraft: (json) => {
          setDraft(json);
          go('review');
        },
        onManual: () => go('manual'),
        onCancel: () => go('start'),
      });

    case 'manual':
      return manualView({
        onDraft: (json) => {
          setDraft(json);
          go('review');
        },
        onCancel: () => go('start'),
      });

    case 'review':
      return reviewView(state, {
        onDraftChange: (json) => {
          setDraft(json);
        },
        onRun: () => {
          state.report = computeReport(state);
          if (state.report) go('report');
        },
        onBack: () => {
          Object.assign(state, initialState());
          go('start');
        },
        onLoadComposition: (text) => {
          state.composition = loadComposition(text);
          render();
        },
      });

    case 'report':
      return reportView(state, {
        onSliders: (next) => {
          Object.assign(state.sliders, next);
        },
        onVoice: (voice: Voice) => {
          state.voice = voice;
          render();
        },
        onBack: () => go('review'),
      });

    case 'limitations':
      return limitationsView();
  }
}

function disclaimer(): HTMLElement {
  return el('footer', { class: 'disclaimer' },
    el('p', {},
      'First Floor is an educational calculator. It measures a position you supply under assumptions ' +
      'you set. It is not investment advice, not a recommendation, and not a statement about how any ' +
      'fund is going to perform. No data is fetched and nothing you open here leaves your machine.'),
    el('p', {}, 'Code MIT. Written content CC BY 4.0.'),
  );
}

render();
