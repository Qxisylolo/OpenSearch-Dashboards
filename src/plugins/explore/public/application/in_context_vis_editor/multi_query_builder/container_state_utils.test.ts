/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  loadContainerState,
  mergeContainerState,
  showContainerStateWarnings,
} from './container_state_utils';
import {
  getInitialQueryString,
  resolveDatasetLanguage,
  showDatasetNoLongerExistsWarning,
  showDatasetQueryLanguageIncompatibleWarning,
  showUndefinedDatasetWarning,
  verifyQueryAndDataset,
} from '../query_builder/utils';
import { QUERY_BUILDER_QUERY_STATE_KEY, QUERY_EDITOR_STATE_KEY } from '../types';

jest.mock('../query_builder/utils', () => ({
  getInitialQueryString: jest.fn(),
  resolveDatasetLanguage: jest.fn(),
  showDatasetNoLongerExistsWarning: jest.fn(),
  showDatasetQueryLanguageIncompatibleWarning: jest.fn(),
  showUndefinedDatasetWarning: jest.fn(),
  verifyQueryAndDataset: jest.fn(),
}));

const ppl = (query: string, dataset?: any) => ({ query, language: 'PPL', dataset }) as any;
const logs = { id: 'logs', title: 'logs', type: 'INDEX_PATTERN' };

describe('mergeContainerState', () => {
  const emptyEditorState = { rows: [] };

  it('uses the URL queries over the saved ones', () => {
    const merged = mergeContainerState(
      { queries: [['B', ppl('url')]], editorState: emptyEditorState },
      [ppl('saved')]
    );
    expect(merged.queries).toEqual([['B', ppl('url')]]);
  });

  it('labels saved queries A, B, … when the URL has none', () => {
    const merged = mergeContainerState({ queries: [], editorState: emptyEditorState }, [
      ppl('first'),
      ppl('second'),
    ]);
    expect(merged.queries).toEqual([
      ['A', ppl('first')],
      ['B', ppl('second')],
    ]);
  });

  it('keeps the first of duplicate refIds', () => {
    const merged = mergeContainerState({
      queries: [
        ['A', ppl('first')],
        ['A', ppl('again')],
        ['B', ppl('b')],
      ],
      editorState: emptyEditorState,
    });
    expect(merged.queries.map(([refId, query]) => [refId, query.query])).toEqual([
      ['A', 'first'],
      ['B', 'b'],
    ]);
  });

  it('keeps editor state only for rows that exist', () => {
    const merged = mergeContainerState({
      queries: [['A', ppl('a')]],
      editorState: {
        selectedRowRefId: 'Z',
        maxDataPoints: 300,
        rows: [
          ['A', { isHidden: true }],
          ['Z', { isHidden: false }],
        ],
      },
    });
    expect(merged.editorState).toEqual({ maxDataPoints: 300, rows: [['A', { isHidden: true }]] });
  });

  it('keeps a selected row that exists', () => {
    const merged = mergeContainerState({
      queries: [
        ['A', ppl('a')],
        ['B', ppl('b')],
      ],
      editorState: { selectedRowRefId: 'B', rows: [] },
    });
    expect(merged.editorState.selectedRowRefId).toBe('B');
  });
});

describe('loadContainerState', () => {
  const servicesWithUrl = (url: Record<string, unknown> = {}) =>
    ({
      osdUrlStateStorage: { get: jest.fn((key: string) => url[key]) },
      data: { query: { getDefaultDataset: jest.fn(), queryString: {} } },
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts a new editor with one row on the default dataset', async () => {
    const services = servicesWithUrl();
    services.data.query.getDefaultDataset.mockResolvedValue(logs);
    (resolveDatasetLanguage as jest.Mock).mockReturnValue('PPL');
    (getInitialQueryString as jest.Mock).mockReturnValue('source = logs');

    const { state, warnings } = await loadContainerState(services);

    expect(state.queries).toEqual([
      ['A', { dataset: logs, language: 'PPL', query: 'source = logs' }],
    ]);
    expect(warnings).toEqual([]);
    expect(verifyQueryAndDataset).not.toHaveBeenCalled();
  });

  it('starts empty when there is no default dataset', async () => {
    const services = servicesWithUrl();
    services.data.query.getDefaultDataset.mockRejectedValue(new Error('none'));

    const { state } = await loadContainerState(services);

    expect(state.queries).toEqual([['A', { query: '', language: 'PPL', dataset: undefined }]]);
  });

  it('verifies every restored row and returns its warnings by refId', async () => {
    const services = servicesWithUrl({
      [QUERY_BUILDER_QUERY_STATE_KEY]: [
        ['A', ppl('a', logs)],
        ['B', ppl('b', logs)],
      ],
      [QUERY_EDITOR_STATE_KEY]: { rows: [['B', { isHidden: true }]] },
    });
    (verifyQueryAndDataset as jest.Mock).mockImplementation(async (_services, query) =>
      query.query === 'b'
        ? { query: { ...query, dataset: undefined }, warning: 'datasetDoesNotExist' }
        : { query }
    );

    const { state, warnings } = await loadContainerState(services);

    expect(state.queries).toEqual([
      ['A', ppl('a', logs)],
      ['B', ppl('b', undefined)],
    ]);
    expect(state.editorState.rows).toEqual([['B', { isHidden: true }]]);
    expect(warnings).toEqual([{ kind: 'datasetDoesNotExist', refId: 'B' }]);
  });

  it('reads saved queries when the URL has none', async () => {
    const services = servicesWithUrl();
    (verifyQueryAndDataset as jest.Mock).mockImplementation(async (_services, query) => ({
      query,
    }));

    const { state } = await loadContainerState(services, [ppl('saved', logs)]);

    expect(state.queries).toEqual([['A', ppl('saved', logs)]]);
  });

  it('treats an unreadable URL as empty', async () => {
    const services = servicesWithUrl();
    services.osdUrlStateStorage.get.mockImplementation(() => {
      throw new Error('bad rison');
    });
    (verifyQueryAndDataset as jest.Mock).mockImplementation(async (_services, query) => ({
      query,
    }));

    const { state } = await loadContainerState(services, [ppl('saved', logs)]);

    expect(state.queries).toEqual([['A', ppl('saved', logs)]]);
  });
});

describe('showContainerStateWarnings', () => {
  it('shows a toast per changed row and none for a missing dataset', () => {
    const toasts = {} as any;
    showContainerStateWarnings(toasts, [
      { kind: 'datasetDoesNotExist', refId: 'A' },
      { kind: 'datasetWrongLanguage', refId: 'B' },
    ]);

    expect(showDatasetNoLongerExistsWarning).toHaveBeenCalledWith(toasts, 'A');
    expect(showDatasetQueryLanguageIncompatibleWarning).toHaveBeenCalledWith(toasts, 'B');
    // A row without a dataset is told about when it runs, not on load.
    expect(showUndefinedDatasetWarning).not.toHaveBeenCalled();
  });
});
