/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { i18n } from '@osd/i18n';
import { ToastsStart } from 'opensearch-dashboards/public';
import { ExploreServices } from '../../../types';
import { Dataset, DEFAULT_DATA, CORE_SIGNAL_TYPES, EMPTY_QUERY } from '../../../../../data/common';
import { QueryStringContract } from '../../../../../data/public';

import {
  QueryState,
  QueryEditorState,
  QueryResultState,
  SupportLanguageType,
} from './query_builder';
import { QueryExecutionStatus } from '../../../application/utils/state_management/types';

import {
  createSearchSourceWithQuery,
  shouldSkipQueryExecution,
} from '../../../application/utils/state_management/actions/query_actions';

import { getResponseInspectorStats } from '../../../application/legacy/discover/opensearch_dashboards_services';

import {
  ISearchResult,
  IPrometheusSearchResult,
} from '../../../application/utils/state_management/slices';
import { AgentError, ProhibitedQueryError } from '../../../components/query_panel/utils/error';
import { getSourceTypeRegistry } from '../../../services/source_type_registry';

export interface RootState {
  query: QueryState;
  queryEditor: QueryEditorState;
  results: QueryResultState;
}

// export const resolveDatasetByLanguage = async (
//   services: ExploreServices,
//   languageType: SupportLanguageType,
//   preferredDataset?: Dataset
// ): Promise<Dataset | undefined> => {
//   // Prefer URL/saved state and the current shared query before resolving the configured default.
//   const queryStringQuery = services.data?.query?.queryString?.getQuery();
//   let existingDataset = preferredDataset || queryStringQuery?.dataset;

//   if (!existingDataset) {
//     try {
//       // The editor explicitly opts in to the configured default only when no restored or current
//       // query state selected a dataset. QueryStringManager no longer resolves this implicitly.
//       existingDataset = await services.data.query.getDefaultDataset();
//     } catch {
//       // A default-dataset lookup failure should still allow the first compatible dataset fallback.
//     }
//   }

//   // A metrics language (PromQL, or one a registered Metrics source lists) needs a metrics
//   // dataset; any other language needs a logs or traces one.
//   const isMetrics = getSourceTypeRegistry().isMetricsLanguage(languageType);
//   const requiredSignalType = isMetrics ? CORE_SIGNAL_TYPES.METRICS : undefined;

//   if (existingDataset) {
//     try {
//       const dataView = await services.data?.dataViews?.get(
//         existingDataset.id,
//         existingDataset.type !== DEFAULT_DATA.SET_TYPES.INDEX_PATTERN
//       );
//       // Get effective signal type from dataView or existingDataset
//       const effectiveSignalType = dataView?.signalType || existingDataset?.signalType;
//       // Validate signal type matches flavor
//       if (isSignalTypeCompatible(effectiveSignalType, requiredSignalType)) {
//         return existingDataset;
//       }
//     } catch {
//       // Dataset no longer exists or validation failed
//       // Silently continue to fetch a new dataset if validation fails
//       // This is expected behavior when datasets are incompatible with current flavor
//     }
//   }

//   // Fetch first available dataset of the required type
//   const flavor = isMetrics ? ExploreFlavor.Metrics : null;
//   return await fetchFirstAvailableDataset(services, flavor, requiredSignalType);
// };

const datasetExists = async (services: ExploreServices, dataset: Dataset): Promise<boolean> => {
  const {
    data: {
      query: { queryString },
    },
  } = services;
  const datasetService = queryString.getDatasetService();

  // for index and Prometheus, it will be cached as dataview here
  if (dataset.type !== DEFAULT_DATA.SET_TYPES.INDEX_PATTERN) {
    await datasetService.cacheDataset(
      dataset,
      {
        uiSettings: services.uiSettings,
        savedObjects: services.savedObjects,
        notifications: services.notifications,
        http: services.http,
        data: services.data,
      },
      false
    );

    return true;
  }
  try {
    // for INDEX_PATTERN
    await services.data.dataViews.get(dataset.id);
    return true;
  } catch {
    return false;
  }
};

const exactMinimalDataset = (selectedDataset: Dataset) => {
  let minimalDataset: Dataset;
  // Use type assertion to check for toDataset method
  if (typeof (selectedDataset as any).toDataset === 'function') {
    minimalDataset = (selectedDataset as any).toDataset();
  } else {
    minimalDataset = {
      id: selectedDataset.id,
      title: selectedDataset.title,
      displayName: selectedDataset.displayName,
      type: selectedDataset.type,
      language: selectedDataset.language,
      timeFieldName: selectedDataset.timeFieldName,
      dataSource: selectedDataset.dataSource,
      signalType: selectedDataset.signalType,
    };
  }

  return minimalDataset;
};

export type VerificationWarning = 'datasetDoesNotExist' | 'datasetWrongLanguage';

interface VerifiedQuery {
  query: QueryState;
  warning?: VerificationWarning;
}

/**
 * Verifies a query's dataset before its row is built.
 */
export const verifyQueryAndDataset = async (
  services: ExploreServices,
  query: QueryState
): Promise<VerifiedQuery> => {
  // 1. query doesn't have dataset, do nothing(user need to select one)
  if (!query.dataset) {
    return {
      query,
    };
  }

  // 2. only return false when dataset(index pattern) doesn't exists, set dataset undefined and let user to select one
  // for index and Prometheus, will cache datasets first as dataview
  if (!(await datasetExists(services, query.dataset))) {
    return {
      query: {
        ...query,
        dataset: undefined,
      },
      warning: 'datasetDoesNotExist',
    };
  }

  const currentLanguage = query.language;

  const minimalDataset = exactMinimalDataset(query.dataset);
  // 3. verfiy language compatibility
  const resolvedLanguage = resolveDatasetLanguage(services, minimalDataset, currentLanguage);

  if (!resolvedLanguage || resolvedLanguage === currentLanguage) {
    return {
      query: {
        ...query,
        dataset: minimalDataset,
      },
    };
  }

  // 4. if language is not compatible with dataset, use resolved supported language from dataset.
  // The requested (saved) language wins when the dataset's type can run it: a dataset's own
  // `language` is only its default, and a source can offer another language on the same
  // dataset (e.g. its own SQL dialect next to PromQL). Otherwise keep the dataset's default.
  const initialQueryByDataset = services.data.query.queryString.getInitialQueryByDataset({
    ...minimalDataset,
    language: resolvedLanguage,
  });

  return {
    query: {
      ...query,
      dataset: minimalDataset,
      language: resolvedLanguage,
      query: initialQueryByDataset.query,
      queryOptions: undefined,
    },
    warning: 'datasetWrongLanguage',
  };
};

// export const getPreloadedQueryState = async (
//   services: ExploreServices,
//   languageType: SupportLanguageType,
//   preferredDataset?: Dataset
// ): Promise<QueryState> => {
//   // Always validate the dataset and language type
//   const selectedDataset = await resolveDatasetByLanguage(services, languageType, preferredDataset);

//   // Use toDataset method if available, otherwise extract minimal properties
//   let minimalDataset: Dataset | undefined;
//   if (selectedDataset) {
//     // Use type assertion to check for toDataset method
//     if (typeof (selectedDataset as any).toDataset === 'function') {
//       minimalDataset = (selectedDataset as any).toDataset();
//     } else {
//       minimalDataset = {
//         id: selectedDataset.id,
//         title: selectedDataset.title,
//         displayName: selectedDataset.displayName,
//         type: selectedDataset.type,
//         language: selectedDataset.language,
//         timeFieldName: selectedDataset.timeFieldName,
//         dataSource: selectedDataset.dataSource,
//         signalType: selectedDataset.signalType,
//       };
//     }
//   }

//   if (minimalDataset) {
//     // The requested (saved) language wins when the dataset's type can run it: a dataset's own
//     // `language` is only its default, and a source can offer another language on the same
//     // dataset (e.g. its own SQL dialect next to PromQL). Otherwise keep the dataset's default.
//     const supportedLanguages = services.data.query.queryString
//       .getDatasetService?.()
//       ?.getType(minimalDataset.type)
//       ?.supportedLanguages(minimalDataset);
//     const language =
//       languageType && supportedLanguages?.includes(languageType)
//         ? languageType
//         : minimalDataset.language || languageType || 'PPL';
//     const initialQueryByDataset = services.data.query.queryString.getInitialQueryByDataset({
//       ...minimalDataset,
//       language,
//     });

//     // override the initial query to be an empty string
//     return {
//       ...initialQueryByDataset,
//       // SQL needs a base query (SELECT * FROM ...) to be valid; PPL works with empty
//       ...(languageType !== SupportLanguageType.sql ? { query: '' } : {}),
//       // Ensure we use the minimal dataset
//       dataset: minimalDataset,
//     };
//   } else {
//     return {
//       query: '',
//       language: languageType ?? 'PPL',
//       dataset: undefined,
//     };
//   }
// };

export const getInitialQueryString = (
  queryString: QueryStringContract,
  dataset: Dataset | undefined,
  language: string
) =>
  language === SupportLanguageType.sql && dataset
    ? queryString.getInitialQueryByDataset({ ...dataset, language }).query
    : EMPTY_QUERY.QUERY;

/**
 * Get languages for a dataset selected in the vis editor, from its dataset type's supportedLanguages
 */
export const getDatasetLanguages = (
  services: ExploreServices,
  dataset: Dataset
): SupportLanguageType[] => {
  // currently, editor only supports three languages
  // TODO check again for metric
  const editorLanguages = [
    SupportLanguageType.ppl,
    SupportLanguageType.promQL,
    ...(services.sqlSupportEnabled ? [SupportLanguageType.sql] : []),
  ];
  const supported =
    services.data?.query?.queryString
      ?.getDatasetService?.()
      ?.getType(dataset.type)
      ?.supportedLanguages(dataset) ?? [];
  return editorLanguages.filter((language) => supported.includes(language));
};

/**
 * The language a row switches to when its dataset changes: the preferred (current) language if
 * the dataset can run it, else the dataset's own language, else the first one it supports.
 * A dataset often carries no `language`, so it can't be read from the dataset alone.
 */

export const resolveDatasetLanguage = (
  services: ExploreServices,
  dataset: Dataset,
  preferred?: string
): string | undefined => {
  const supportedLanguages: string[] = getDatasetLanguages(services, dataset);

  if (preferred && supportedLanguages.includes(preferred)) {
    return preferred;
  }

  if (dataset.language && supportedLanguages.includes(dataset.language)) {
    return dataset.language;
  }

  return supportedLanguages?.[0] ?? dataset?.language ?? 'PPL';
};

/**
 * queryOptions only apply to metrics languages (PromQL);
 * any other language gets them cleared. Cleared with `undefined`, not omitted: the global
 * queryString.setQuery merges into the current query, so an omitted key would keep the old value.
 */
export const withLanguageQueryOptions = <T extends { language?: string; queryOptions?: unknown }>(
  query: T
): T =>
  getSourceTypeRegistry().isMetricsLanguage(query.language)
    ? query
    : { ...query, queryOptions: undefined };

export const getRequiredSignalType = (languageType?: SupportLanguageType): string | string[] =>
  getSourceTypeRegistry().isMetricsLanguage(languageType)
    ? CORE_SIGNAL_TYPES.METRICS
    : [CORE_SIGNAL_TYPES.LOGS, CORE_SIGNAL_TYPES.TRACES];

export const isSignalTypeCompatible = (
  effectiveSignalType: string | undefined,
  requiredSignalType: string | undefined
): boolean => {
  // If requiredSignalType is specified, dataset must match it exactly
  if (requiredSignalType) {
    return effectiveSignalType === requiredSignalType;
  }

  // If requiredSignalType is not specified, for languageType: ppl
  // dataset should not have signalType equal to Metrics
  return effectiveSignalType !== CORE_SIGNAL_TYPES.METRICS;
};

export const queryExecution = async ({
  services,
  query,
  queryString,
  updateEditorStateFn,
  updateResultFn,
  activeQueryAbortController,
}: {
  services: ExploreServices;
  query: QueryState;
  queryString: string;
  updateEditorStateFn: (updates: Partial<QueryEditorState>) => void;
  updateResultFn: (result: ISearchResult) => void;
  activeQueryAbortController: AbortController;
}) => {
  // early exit if query should skipped (for PROMQL)
  if (shouldSkipQueryExecution(query)) {
    return;
  }
  const queryStartTime = Date.now();

  try {
    updateEditorStateFn({
      queryStatus: {
        status: QueryExecutionStatus.LOADING,
        startTime: queryStartTime,
        elapsedMs: undefined,
        error: undefined,
      },
    });

    services.inspectorAdapters.requests.reset();
    const title = i18n.translate('explore.discover.inspectorRequestDataTitle', {
      defaultMessage: 'data',
    });
    const description = i18n.translate('explore.discover.inspectorRequestDescription', {
      defaultMessage: 'This request queries OpenSearch to fetch the data for the search.',
    });
    const inspectorRequest = services.inspectorAdapters.requests.start(title, { description });

    await services.data.dataViews.ensureDefaultDataView();
    const dataView = query.dataset
      ? await services.data.dataViews.get(query.dataset.id, query.dataset.type !== 'INDEX_PATTERN')
      : await services.data.dataViews.getDefault();

    if (!dataView) {
      throw new Error('Dataset not found for query execution');
    }

    const dataset = await services.data.dataViews.convertToDataset(dataView);

    // const preparedQueryObject = {
    //   ...query,
    //   ...(getSourceTypeRegistry().isMetricsLanguage(query.language)
    //     ? {}
    //     : // TODO PPL add queryOptions
    //       { queryOptions: undefined }),
    //   dataset,
    //   query: queryString,
    // };
    // TODO PPL add queryOptions
    const preparedQueryObject = {
      ...withLanguageQueryOptions(query),
      dataset,
      query: queryString,
    };

    const searchSource = await createSearchSourceWithQuery(
      preparedQueryObject,
      dataView,
      services,
      {
        useProvidedQuery: true,
      }
    );

    if ((services as any).getRequestInspectorStats && inspectorRequest) {
      inspectorRequest.stats((services as any).getRequestInspectorStats(searchSource));
    }

    if (inspectorRequest) {
      searchSource.getSearchRequestBody().then((body: object) => {
        inspectorRequest.json(body);
      });
    }

    const languageConfig = services.data.query.queryString
      .getLanguageService()
      .getLanguage(query.language);

    // Execute query
    const rawResults = await searchSource.fetch({
      abortSignal: activeQueryAbortController.signal,
      withLongNumeralsSupport: await services.uiSettings.get('data:withLongNumerals'),
      ...(languageConfig?.fields?.formatter ? { formatter: languageConfig.fields.formatter } : {}),
    });

    if (activeQueryAbortController.signal.aborted) {
      return;
    }

    // Add response stats to inspector
    inspectorRequest
      .stats(getResponseInspectorStats(rawResults, searchSource))
      .ok({ json: rawResults });

    const rawResultsWithMeta: ISearchResult | IPrometheusSearchResult = {
      ...rawResults,
      elapsedMs: inspectorRequest.getTime()!,
      fieldSchema: searchSource.getDataFrame()?.schema,
      profile: searchSource.getDataFrame()?.meta?.profile,
      frameMeta: searchSource.getDataFrame()?.meta,
    };

    updateResultFn(rawResultsWithMeta);
    updateEditorStateFn({
      queryStatus: {
        status:
          rawResults.hits?.hits?.length > 0
            ? QueryExecutionStatus.READY
            : QueryExecutionStatus.NO_RESULTS,
        startTime: queryStartTime,
        elapsedMs: inspectorRequest.getTime()!,
        error: undefined,
      },
    });
  } catch (error) {
    if (activeQueryAbortController.signal.aborted) {
      return;
    }

    // Handle abort errors - reset query status to initial state
    if (error instanceof Error && error.name === 'AbortError') {
      updateEditorStateFn({
        queryStatus: {
          status: QueryExecutionStatus.UNINITIALIZED,
          startTime: undefined,
          elapsedMs: undefined,
          error: undefined,
        },
      });
      return;
    }

    let parsedError;
    try {
      parsedError = JSON.parse(error.body.message);
    } catch (parseError) {
      parsedError = {
        error: {
          reason: error.body?.message || error.message || 'Unknown Error',
          details: error.body?.error || 'An error occurred',
          type: error.name,
        },
      };
    }

    updateEditorStateFn({
      queryStatus: {
        status: QueryExecutionStatus.ERROR,
        startTime: queryStartTime,
        elapsedMs: undefined,
        error: {
          error: error.body?.error || 'Unknown Error',
          message: {
            details: parsedError?.error?.details || 'Unknown Error',
            reason: parsedError?.error?.reason || 'Unknown Error',
            type: parsedError?.error?.type,
          },
          statusCode: error.body?.statusCode,
          originalErrorMessage: error.body?.message,
        },
      },
    });
    throw error;
  }
};

export const showPromptModeNotAvailableWarning = (toasts: ToastsStart) => {
  toasts.addWarning({
    title: i18n.translate('explore.queryPanel.queryAssist-not-available-title', {
      defaultMessage: 'Unavailable',
    }),
    text: i18n.translate('explore.queryPanel.queryAssist-not-available-text', {
      defaultMessage: 'Query assist feature is not enabled or configured.',
    }),
    id: 'queryAssist-not-available',
  });
};

export const showMissingPromptWarning = (toasts: ToastsStart) => {
  toasts.addWarning({
    title: i18n.translate('explore.queryPanel.missing-prompt-warning-title', {
      defaultMessage: 'Missing prompt',
    }),
    text: i18n.translate('explore.queryPanel.missing-prompt-warning-text', {
      defaultMessage: 'Enter a question to automatically generate a query',
    }),
    id: 'missing-prompt-warning',
  });
};

// A restored query's dataset no longer existed.
export const showDatasetNoLongerExistsWarning = (toasts: ToastsStart, refId: string) => {
  toasts.addWarning({
    title: i18n.translate('explore.queryPanel.datasetNoExistTitle', {
      defaultMessage: 'Query {refId}: dataset no longer exists',
      values: { refId },
    }),
    text: i18n.translate('explore.queryPanel.datasetNoExistText', {
      defaultMessage: 'Select one to run it.',
    }),
    id: `dataset-no-exist-${refId}`,
  });
};

// A restored query's language didn't fit its dataset and was replaced.
export const showDatasetQueryLanguageIncompatibleWarning = (toasts: ToastsStart, refId: string) => {
  toasts.addWarning({
    title: i18n.translate('explore.queryPanel.datasetQueryLanguageIncompatibleWarningTitle', {
      defaultMessage: 'Query {refId} has incompatible language against selected dataset',
      values: { refId },
    }),
    text: i18n.translate('explore.queryPanel.datasetQueryLanguageIncompatibleWarningText', {
      defaultMessage:
        "Its dataset can't run current query, so the query was reset. Write it again.",
    }),
    id: `dataset-query-language-incompatible-${refId}`,
  });
};

// A restored query without a dataset stays empty
export const showUndefinedDatasetWarning = (toasts: ToastsStart, refId: string) => {
  toasts.addWarning({
    title: i18n.translate('explore.queryPanel.undefinedDatasetTitle', {
      defaultMessage: 'Query {refId} has no dataset',
      values: { refId },
    }),
    text: i18n.translate('explore.queryPanel.undefinedDatasetText', {
      defaultMessage: 'Select a dataset to run it.',
    }),
    id: `undefined-dataset-${refId}`,
  });
};

// Several rows run together: the time range the agent generated for one row is not applied.
export const showGeneratedTimeRangeIgnoredWarning = (
  toasts: ToastsStart,
  refId: string,
  timeRange: { from: string; to: string }
) => {
  toasts.addWarning({
    title: i18n.translate('explore.queryPanel.generatedTimeRangeIgnoredTitle', {
      defaultMessage: 'Query {refId}: generated time range not applied',
      values: { refId },
    }),
    text: i18n.translate('explore.queryPanel.generatedTimeRangeIgnoredText', {
      defaultMessage:
        'Several queries share one time range. Set {from} to {to} in the time picker to use it.',
      values: { from: timeRange.from, to: timeRange.to },
    }),
    id: `generated-time-range-ignored-${refId}`,
  });
};

export const showSkippedQueriesWarning = (
  toasts: ToastsStart,
  { noDataset, emptyQuery }: { noDataset: string[]; emptyQuery: string[] }
) => {
  const lines = [
    noDataset.length > 0
      ? i18n.translate('explore.queryPanel.skippedNoDatasetText', {
          defaultMessage: 'Query {refIds}: no dataset selected.',
          values: { refIds: noDataset.join(', ') },
        })
      : undefined,
    emptyQuery.length > 0
      ? i18n.translate('explore.queryPanel.skippedEmptyQueryText', {
          defaultMessage: 'Query {refIds}: the query is empty.',
          values: { refIds: emptyQuery.join(', ') },
        })
      : undefined,
  ].filter(Boolean);
  if (lines.length === 0) return;
  toasts.addWarning({
    title: i18n.translate('explore.queryPanel.skippedQueriesTitle', {
      defaultMessage: 'Some queries were skipped',
    }),
    text: lines.join(' '),
    id: 'skipped-queries-warning',
  });
};

export const showMissingDatasetWarning = (toasts: ToastsStart) => {
  toasts.addWarning({
    title: i18n.translate('explore.queryPanel.missing-dataset-warning', {
      defaultMessage: 'Select a dataset to ask a question',
    }),
    id: 'missing-dataset-warning',
  });
};

export const handleAgentError = (toasts: ToastsStart, error: Error) => {
  if (error instanceof ProhibitedQueryError) {
    toasts.addError(error, {
      id: 'prohibited-query-error',
      title: i18n.translate('explore.queryPanel.prohibited-query-error', {
        defaultMessage: 'I am unable to respond to this query. Try another question',
      }),
    });
  } else if (error instanceof AgentError) {
    toasts.addError(error, {
      id: 'agent-error',
      title: i18n.translate('explore.queryPanel.agent-error', {
        defaultMessage: 'I am unable to respond to this query. Try another question',
      }),
    });
  } else {
    toasts.addError(error, {
      id: 'miscellaneous-prompt-error',
      title: i18n.translate('explore.queryPanel.miscellaneous-prompt-error', {
        defaultMessage: 'Failed to generate results',
      }),
    });
  }
};
