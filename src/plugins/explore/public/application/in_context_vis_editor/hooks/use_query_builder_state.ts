/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { useObservable } from 'react-use';
import { getMultiQueryBuilder } from '../multi_query_builder/multi_query_builder';

export const useMultiQueryBuilderState = () => {
  const container = getMultiQueryBuilder();

  const selectedRow$ = useMemo(() => container.getSelectedRow$(), [container]);
  const selectedRow = useObservable(selectedRow$, container.getSelectedRow());
  const queryState = useObservable(selectedRow.queryState$, selectedRow.queryState$.getValue());
  const queryEditorState = useObservable(
    selectedRow.queryEditorState$,
    selectedRow.queryEditorState$.getValue()
  );
  const resultState = useObservable(selectedRow.resultState$, selectedRow.resultState$.getValue());
  const datasetView = useObservable(selectedRow.datasetView$, selectedRow.datasetView$.getValue());

  const multiQueryEditorState = useObservable(
    container.multiQueryEditorState$,
    container.multiQueryEditorState$.getValue()
  );
  const hasTimeBasedRow$ = useMemo(() => container.getHasTimeBasedRow$(), [container]);
  const hasTimeBasedRow = useObservable(hasTimeBasedRow$, false);

  return useMemo(
    () => ({
      queryState,
      queryEditorState,
      resultState,
      datasetView,
      queryBuilder: selectedRow,
      container,
      dateRange: multiQueryEditorState.dateRange,
      hasTimeBasedRow,
    }),
    [
      queryState,
      queryEditorState,
      resultState,
      datasetView,
      selectedRow,
      container,
      multiQueryEditorState.dateRange,
      hasTimeBasedRow,
    ]
  );
};

export const useQueryBuilderState = () => useMultiQueryBuilderState();
