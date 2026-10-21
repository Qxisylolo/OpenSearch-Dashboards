/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useMemo, useRef } from 'react';
import { uniq } from 'lodash';
import { useOpenSearchDashboards } from '../../../../../opensearch_dashboards_react/public';
import { CORE_SIGNAL_TYPES, Dataset, DEFAULT_DATA, EMPTY_QUERY } from '../../../../../data/common';
import { ExploreServices } from '../../../types';
import { EXPLORE_DEFAULT_LANGUAGE } from '../../../../common';

import { useQueryBuilderState } from '../hooks/use_query_builder_state';
import { useEditorOperations } from '../hooks/use_editor_operations';

import { resolveDatasetLanguage } from '../query_builder/utils';
import '../visualization_editor.scss';
import { SupportLanguageType } from '../query_builder/query_builder';

const PROMETHEUS_DATASET_TYPE = 'PROMETHEUS';

export const DatasetSelectWidget = () => {
  const { services } = useOpenSearchDashboards<ExploreServices>();
  const { queryBuilder, queryState } = useQueryBuilderState();
  const { clearEditor, setEditorText, resetEditorMode } = useEditorOperations();

  const {
    data: {
      ui: { DatasetSelect },
      query: { queryString },
    },
  } = services;

  const containerRef = useRef<HTMLDivElement>(null);

  const handleDatasetSelect = useCallback(
    async (dataset: Dataset | undefined) => {
      try {
        if (!dataset) {
          // Clear dataset - reset to empty query state with explore default language
          queryBuilder.updateQueryState({
            query: EMPTY_QUERY.QUERY,
            language: EXPLORE_DEFAULT_LANGUAGE,
            dataset: undefined,
          });

          queryBuilder.updateQueryEditorState({ isQueryEditorDirty: true });

          clearEditor();
          return;
        }
        // TODO try to reuse previous language selection first, otherwise use resolved language type by dataset
        // const currentLanguage = queryBuilder.queryState$.getValue().language;
        const language = resolveDatasetLanguage(services, dataset);
        const initialQuery = queryString.getInitialQueryByDataset({ ...dataset, language });
        // SQL require base query (SELECT * FROM ...), others start empty.
        const query = language === SupportLanguageType.sql ? initialQuery.query : EMPTY_QUERY.QUERY;
        queryBuilder.updateQueryState({
          language,
          dataset,
          query,
          queryOptions: undefined,
        });

        queryBuilder.updateQueryEditorState({ isQueryEditorDirty: true });

        setEditorText(query);
        // reset to query mode
        resetEditorMode();
      } catch (error) {
        services.notifications?.toasts.addError(error, {
          title: 'Error selecting dataset',
        });
      }
    },
    [queryString, clearEditor, setEditorText, resetEditorMode, queryBuilder, services]
  );

  const supportedTypes = useMemo(() => {
    const datasetService = queryString.getDatasetService();
    const metricsTypes = [
      // built-in Prometheus type from OpenSearch source
      ...(datasetService.getType(PROMETHEUS_DATASET_TYPE) ? [PROMETHEUS_DATASET_TYPE] : []),
      // TODO Plugin metrics sources (registry.getAll(ExploreFlavor.Metrics) minus the built-in
      // OpenSearch one): their datasets usually run the plugin's own language, which the language
      // toggle, initial query, editor choice and result shape don't support yet. They may also need
      // their own `datasetSelector`, and can register after this memo runs.
      // // plugins installed metric source from Metric page
      // ...getSourceTypeRegistry()
      //   .getAll(ExploreFlavor.Metrics)
      //   .filter((sourceType) => sourceType.id !== OPENSEARCH_SOURCE_TYPE_ID)
      //   .flatMap((sourceType) => sourceType.datasetTypes),
    ];
    return uniq([
      ...(services.supportedTypes || [
        DEFAULT_DATA.SET_TYPES.INDEX,
        DEFAULT_DATA.SET_TYPES.INDEX_PATTERN,
      ]),
      ...metricsTypes,
    ]);
  }, [queryString, services.supportedTypes]);

  const signalTypes = useMemo(
    () => [CORE_SIGNAL_TYPES.LOGS, CORE_SIGNAL_TYPES.TRACES, CORE_SIGNAL_TYPES.METRICS],
    []
  );

  return (
    <div ref={containerRef} className="exploreDatasetSelectWrapper">
      <DatasetSelect
        onSelect={handleDatasetSelect}
        appName="explore"
        supportedTypes={supportedTypes}
        signalType={signalTypes}
        showNonTimeFieldDatasets={false}
        controlledSelectedDataset={queryState.dataset}
      />
    </div>
  );
};
