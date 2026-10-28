/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  QueryBuilder,
  QueryEditorState,
  QueryResultState,
  QueryState,
} from '../query_builder/query_builder';
import {
  QueryExecutionStatus,
  QueryResultStatus,
} from '../../../application/utils/state_management/types';

export type QueryRows = QueryBuilder[];
export type UrlRowEntry<T> = [refId: string, state: T];
export type UrlRowEditorState = Partial<Pick<QueryEditorState, 'isHidden'>>;

// `_e`: container-level editor state plus each row's editor state.
export interface UrlMultiEditorState {
  selectedRowRefId?: string;
  maxDataPoints?: number;
  rows: Array<UrlRowEntry<UrlRowEditorState>>;
}

// default refId of the single query (for previous single query builder adoption)
const SINGLE_QUERY_REF_ID = 'A';

// One visible row's execution status and results
export interface RowExecutionState {
  refId: string;
  status: QueryResultStatus;
  result: QueryResultState;
}

// One row's result in the shape for Visualization
export interface SeriesResult {
  refId: string;
  rows: NonNullable<QueryResultState>['hits']['hits'];
  fieldSchema: NonNullable<NonNullable<QueryResultState>['fieldSchema']>;
  seriesDisplayNames?: Record<string, string>;
}

// One row as a list item: hidden / valid per row.
export interface RowListItem {
  refId: string;
  isHidden: boolean;
  isValid: boolean;
}

export const toRowListItem = (refId: string, editorState: QueryEditorState): RowListItem => ({
  refId,
  isHidden: !!editorState.isHidden,
  isValid: editorState.queryStatus?.status !== QueryExecutionStatus.ERROR,
});

export interface AggregateStatus {
  status: QueryExecutionStatus;
  /** Rows that errored; with a READY status the vis still renders the others. */
  failedQueries: Array<{ refId: string; error?: QueryResultStatus['error'] }>;
}

/**
 * The visible rows' combined status.
 * 1. LOADING until the all rows are done;
 * 2. READY when any row has results (errored rows are listed, but not fatal);
 * 3. ERROR or NO_RESULTS otherwise. Rows that never ran (no dataset) count as UNINITIALIZED and don't block.
 */
export const computeAggregateStatus = (
  states: RowExecutionState[],
  isExecuting: boolean
): AggregateStatus => {
  const statuses = states.map((state) => state.status.status);
  const failedQueries = states
    .filter((state) => state.status.status === QueryExecutionStatus.ERROR)
    .map((state) => ({ refId: state.refId, error: state.status.error }));

  let status: QueryExecutionStatus;
  if (isExecuting || statuses.includes(QueryExecutionStatus.LOADING)) {
    status = QueryExecutionStatus.LOADING;
  } else if (statuses.every((s) => s === QueryExecutionStatus.UNINITIALIZED)) {
    status = QueryExecutionStatus.UNINITIALIZED;
  } else if (statuses.includes(QueryExecutionStatus.READY)) {
    status = QueryExecutionStatus.READY;
  } else if (statuses.includes(QueryExecutionStatus.ERROR)) {
    status = QueryExecutionStatus.ERROR;
  } else {
    status = QueryExecutionStatus.NO_RESULTS;
  }
  return { status, failedQueries };
};

export const toSeriesResult = ({ refId, result }: RowExecutionState): SeriesResult => ({
  refId,
  rows: result?.hits?.hits ?? [],
  fieldSchema: result?.fieldSchema ?? [],
  // seriesDisplayNames maps a series' original name to its display name.
  seriesDisplayNames: result?.frameMeta?.seriesDisplayNames as Record<string, string> | undefined,
});

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
      selectedRowRefId: state.selectedRowRefId,
      maxDataPoints: state.maxDataPoints,
      rows: state.rows.filter(isRowEntry) as Array<UrlRowEntry<UrlRowEditorState>>,
    };
  }
  // for previous single query builder case, add refId 'A' to it
  return {
    selectedRowRefId: SINGLE_QUERY_REF_ID,
    rows: [[SINGLE_QUERY_REF_ID, { isHidden: false }]],
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

// The raw table's query: the chosen one while it's still among the results, else the first.
export const resolveRawTableRefId = (
  series: SeriesResult[],
  rawTableRefId?: string
): string | undefined =>
  series.some((s) => s.refId === rawTableRefId) ? rawTableRefId : series[0]?.refId;
