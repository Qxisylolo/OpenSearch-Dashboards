/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ToastsStart } from 'opensearch-dashboards/public';
import { getQueryLabel } from '../../../../../data/common';
import { EXPLORE_DEFAULT_LANGUAGE } from '../../../../common';
import { ExploreServices } from '../../../types';
import { QueryState } from '../query_builder/query_builder';
import {
  resolveDatasetLanguage,
  getInitialQueryString,
  showDatasetQueryLanguageIncompatibleWarning,
  showDatasetNoLongerExistsWarning,
  verifyQueryAndDataset,
  VerificationWarning,
} from '../query_builder/utils';
import { QUERY_BUILDER_QUERY_STATE_KEY, QUERY_EDITOR_STATE_KEY } from '../types';
import {
  normalizeUrlEditorState,
  normalizeUrlQueries,
  UrlMultiEditorState,
  UrlRowEntry,
} from './utils';

export interface ContainerState {
  queries: Array<UrlRowEntry<QueryState>>;
  editorState: UrlMultiEditorState;
}

// for invalid datasets, will display warning
export interface ContainerStateWarning {
  kind: VerificationWarning;
  refId: string;
}

/**
 * Merges the URL and the saved object state. URL has higher priority
 */
export const mergeContainerState = (
  url: ContainerState,
  savedQueries: QueryState[] = []
): ContainerState => {
  const source: Array<UrlRowEntry<QueryState>> =
    url.queries.length > 0
      ? url.queries
      : savedQueries.map((query, index) => [getQueryLabel(index), query]);
  // avoid duplicate refId from url
  const seen = new Set<string>();
  const queries = source.filter(([refId]) => {
    if (seen.has(refId)) return false;
    seen.add(refId);
    return true;
  });

  // for each row's editor state, only apply to rows that exist
  const refIds = new Set(queries.map(([refId]) => refId));
  const { selectedRowRefId, maxDataPoints, rows } = url.editorState;
  return {
    queries,
    editorState: {
      ...(maxDataPoints !== undefined ? { maxDataPoints } : {}),
      ...(selectedRowRefId && refIds.has(selectedRowRefId) ? { selectedRowRefId } : {}),
      rows: rows.filter(([refId]) => refIds.has(refId)),
    },
  };
};

const readUrlContainerState = (services: ExploreServices): ContainerState => {
  const urlStateStorage = services.osdUrlStateStorage;
  if (!urlStateStorage) {
    return { queries: [], editorState: { rows: [] } };
  }

  try {
    return {
      queries: normalizeUrlQueries(urlStateStorage.get(QUERY_BUILDER_QUERY_STATE_KEY)),
      editorState: normalizeUrlEditorState(urlStateStorage.get(QUERY_EDITOR_STATE_KEY)),
    };
  } catch {
    return { queries: [], editorState: { rows: [] } };
  }
};

// build default query from current default dataset
const buildDefaultQuery = async (services: ExploreServices): Promise<QueryState> => {
  const queryString = services.data.query.queryString;
  try {
    const dataset = await services.data.query.getDefaultDataset();
    if (dataset) {
      const language = resolveDatasetLanguage(services, dataset) ?? EXPLORE_DEFAULT_LANGUAGE;
      return {
        dataset,
        language,
        query: getInitialQueryString(queryString, dataset, language),
      };
    }
  } catch {
    // start empty and let the user pick one.
  }
  return { query: '', language: EXPLORE_DEFAULT_LANGUAGE, dataset: undefined };
};

/**
 * Load the container's starting state: URL over saved queries
 * For a new editor, set a default row;
 * Each restored row is verified with verifyQueryAndDataset.
 * Will return warnings if the dataset is not valid for three cases:
 * 1. dataset doesn;t exist
 * 2. dataset is not compatible with language
 * 3. dataset is no longer available
 */
export const loadContainerState = async (
  services: ExploreServices,
  savedQueries?: QueryState[]
): Promise<{ state: ContainerState; warnings: ContainerStateWarning[] }> => {
  const container = mergeContainerState(readUrlContainerState(services), savedQueries);

  if (container.queries.length === 0) {
    return {
      // no loaded quries, set a default one
      state: { ...container, queries: [[getQueryLabel(0), await buildDefaultQuery(services)]] },
      warnings: [],
    };
  }

  const warnings: ContainerStateWarning[] = [];
  // Rows verify in parallel.
  const queries = await Promise.all(
    container.queries.map(async ([refId, query]): Promise<UrlRowEntry<QueryState>> => {
      const { query: verified, warning } = await verifyQueryAndDataset(services, query);

      if (warning) warnings.push({ kind: warning, refId });
      return [refId, verified];
    })
  );
  return { state: { ...container, queries }, warnings };
};

export const showContainerStateWarnings = (
  toasts: ToastsStart,
  warnings: ContainerStateWarning[]
) => {
  warnings.forEach((warning) => {
    switch (warning.kind) {
      case 'datasetDoesNotExist':
        showDatasetNoLongerExistsWarning(toasts, warning.refId);
        break;
      case 'datasetWrongLanguage':
        showDatasetQueryLanguageIncompatibleWarning(toasts, warning.refId);
        break;
    }
  });
};
