/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { QueryState } from '../query_builder/query_builder';
import type { UrlMultiEditorState, UrlRowEntry } from './utils';

/**
 * The rows and editor state as saved, reduced so two snapshots compare equal exactly when there's
 * nothing new to save. The vis has its own (see components/visualizations/vis_snapshot).
 */
export type QueriesSnapshot = Record<string, unknown>;

// Drops undefined values (and keys), so a missing field and an undefined one compare equal.
const plain = <T>(value: T): T =>
  value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);

// Only what identifies the dataset: the rest (title, time field...) is resolved from it.
const toDatasetKey = (dataset: QueryState['dataset']) =>
  dataset
    ? { id: dataset.id, type: dataset.type, dataSourceId: dataset.dataSource?.id }
    : undefined;

/** The rows and editor state as saved (see toSavedContainerState). */
export const toQueriesSnapshot = (state: {
  queries: Array<UrlRowEntry<QueryState>>;
  editorState: UrlMultiEditorState;
}): QueriesSnapshot =>
  plain({
    queries: state.queries.map(([refId, query]) => [
      refId,
      {
        query: query.query ?? '',
        language: query.language,
        dataset: toDatasetKey(query.dataset),
        queryOptions: query.queryOptions,
      },
    ]),
    hidden: state.editorState.rows.filter(([, row]) => row.isHidden).map(([refId]) => refId),
  });
