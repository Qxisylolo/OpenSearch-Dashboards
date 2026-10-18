/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { useObservable } from 'react-use';
import { getQueryBuilder } from '../query_builder/query_builder';

export const useQueryBuilderState = () => {
  const queryBuilder = getQueryBuilder();
  const queryState = useObservable(queryBuilder.queryState$, queryBuilder.queryState$.getValue());

  const queryEditorState = useObservable(
    queryBuilder.queryEditorState$,
    queryBuilder.queryEditorState$.getValue()
  );

  const resultState = useObservable(
    queryBuilder.resultState$,
    queryBuilder.resultState$.getValue()
  );

  const datasetView = useObservable(
    queryBuilder.datasetView$,
    queryBuilder.datasetView$.getValue()
  );

  return useMemo(
    () => ({
      queryState,
      queryEditorState,
      resultState,
      datasetView,
      queryBuilder,
    }),
    [queryState, queryEditorState, resultState, datasetView, queryBuilder]
  );
};

// export const useMultiQueryBuilderState = () => {
//   const container = getMultiQueryBuilder();

//   const selectedRow$ = useMemo(() => container.getSelectedRow$(), [container]);
//   // Synchronous first-row fallback for the very first render frame (before the
//   // effect subscribes). The invariant guarantees a first row exists here.
//   const selectedRow = useObservable(selectedRow$, container.getAllRows()[0]);

//   const queryState = useObservable(selectedRow.queryState$, selectedRow.queryState$.getValue());
//   const queryEditorState = useObservable(
//     selectedRow.queryEditorState$,
//     selectedRow.queryEditorState$.getValue()
//   );
//   const resultState = useObservable(selectedRow.resultState$, selectedRow.resultState$.getValue());
//   const datasetView = useObservable(selectedRow.datasetView$, selectedRow.datasetView$.getValue());

//   return useMemo(
//     () => ({
//       queryState,
//       queryEditorState,
//       resultState,
//       datasetView,
//       selectedRow,
//       // Row-level consumers use `queryBuilder` (the selected row); panel-level
//       // consumers (page lifecycle, save, run-all) use `container`.
//       queryBuilder: selectedRow,
//       container,
//     }),
//     [queryState, queryEditorState, resultState, datasetView, selectedRow, container]
//   );
// };
