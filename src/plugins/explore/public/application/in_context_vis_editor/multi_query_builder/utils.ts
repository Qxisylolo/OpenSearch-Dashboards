/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { QueryBuilder, QueryEditorState, QueryState } from '../query_builder/query_builder';

export type QueryRows = QueryBuilder[];

export type UrlRowEntry<T> = [refId: string, state: T];
// export type UrlRowEditorState = Partial<Pick<QueryEditorState, 'languageType' | 'isHidden'>>;
// languageType isn't persisted: it follows the query's language, which `_eq` already holds.
export type UrlRowEditorState = Partial<Pick<QueryEditorState, 'isHidden'>>;

// `_e`: container-level editor state plus each row's editor state.
export interface UrlMultiEditorState {
  selectedRow?: string;
  maxDataPoints?: number;
  rows: Array<UrlRowEntry<UrlRowEditorState>>;
}

// refId of the single query (for previous single query builder adoption)
const SINGLE_QUERY_REF_ID = 'A';

const isRowEntry = (value: unknown): value is UrlRowEntry<unknown> =>
  Array.isArray(value) && value.length === 2 && typeof value[0] === 'string';

/**
 * Normalizes _eq.
 * for previous single query builder case, add refId 'A' to it
 */
export const normalizeUrlQueries = (states: unknown): Array<UrlRowEntry<QueryState>> => {
  if (!states) {
    return [];
  }
  if (Array.isArray(states)) {
    return states.filter(isRowEntry) as Array<UrlRowEntry<QueryState>>;
  }
  if (typeof states === 'object') {
    return [[SINGLE_QUERY_REF_ID, states as QueryState]];
  }
  return [];
};

export const normalizeUrlEditorState = (raw: unknown): UrlMultiEditorState => {
  if (!raw || typeof raw !== 'object') {
    return { rows: [] };
  }
  const state = raw as Partial<UrlMultiEditorState> & Partial<QueryEditorState>;
  if (Array.isArray(state.rows)) {
    return {
      selectedRow: state.selectedRow,
      maxDataPoints: state.maxDataPoints,
      rows: state.rows.filter(isRowEntry) as Array<UrlRowEntry<UrlRowEditorState>>,
    };
  }
  return {
    selectedRow: SINGLE_QUERY_REF_ID,
    rows: [
      // [
      //   SINGLE_QUERY_REF_ID,
      //   { languageType: state.languageType ?? SupportLanguageType.ppl, isHidden: state.isHidden },
      // ],
      [SINGLE_QUERY_REF_ID, { isHidden: state.isHidden }],
    ],
  };
};

/**
 * Inverse of getQueryLabel (A -> 0, Z -> 25, AA -> 26, ...); -1 when the label isn't one.
 */
export const getQueryLabelIndex = (label: string): number => {
  if (/^[A-Z]$/.test(label)) {
    return label.charCodeAt(0) - 65;
  }
  if (/^[A-Z]{2}$/.test(label)) {
    return 26 + (label.charCodeAt(0) - 65) * 26 + (label.charCodeAt(1) - 65);
  }
  return -1;
};
