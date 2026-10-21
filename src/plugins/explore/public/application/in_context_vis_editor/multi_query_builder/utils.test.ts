/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { getQueryLabel } from '../../../../../data/common';
import { getQueryLabelIndex, normalizeUrlEditorState, normalizeUrlQueries } from './utils';

const pplQuery = { query: 'source = logs', language: 'PPL' };
const promQuery = { query: 'up', language: 'PROMQL' };

describe('normalizeUrlQueries', () => {
  it('returns [] for an empty value', () => {
    expect(normalizeUrlQueries(undefined)).toEqual([]);
    expect(normalizeUrlQueries(null)).toEqual([]);
  });

  it('keeps multi-query entries and their order', () => {
    expect(
      normalizeUrlQueries([
        ['B', promQuery],
        ['A', pplQuery],
      ])
    ).toEqual([
      ['B', promQuery],
      ['A', pplQuery],
    ]);
  });

  it('turns a single-query URL state into row A', () => {
    expect(normalizeUrlQueries(pplQuery)).toEqual([['A', pplQuery]]);
  });

  it('drops malformed entries', () => {
    expect(normalizeUrlQueries([['A', pplQuery], 'oops', [1, promQuery]])).toEqual([
      ['A', pplQuery],
    ]);
  });
});

describe('normalizeUrlEditorState', () => {
  it('returns no rows for an empty value', () => {
    expect(normalizeUrlEditorState(undefined)).toEqual({ rows: [] });
  });

  it('keeps multi-query editor state', () => {
    const state = {
      selectedRow: 'B',
      maxDataPoints: 500,
      rows: [
        ['A', { languageType: 'PPL', isHidden: false }],
        ['B', { languageType: 'PROMQL', isHidden: true }],
      ],
    };
    expect(normalizeUrlEditorState(state)).toEqual(state);
  });

  it('turns a single-query editor state into row A', () => {
    expect(normalizeUrlEditorState({ languageType: 'PPL', isQueryEditorDirty: true })).toEqual({
      selectedRow: 'A',
      // rows: [['A', { languageType: 'PPL', isHidden: undefined }]],
      rows: [['A', { isHidden: undefined }]],
    });
  });
});

describe('getQueryLabelIndex', () => {
  it('is the inverse of getQueryLabel', () => {
    [0, 1, 25, 26, 27, 51, 52].forEach((index) => {
      expect(getQueryLabelIndex(getQueryLabel(index))).toBe(index);
    });
  });

  it('returns -1 for a non-label refId', () => {
    expect(getQueryLabelIndex('custom')).toBe(-1);
    expect(getQueryLabelIndex('')).toBe(-1);
  });
});
