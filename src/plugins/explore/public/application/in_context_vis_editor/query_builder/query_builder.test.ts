/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { QueryBuilder, SupportLanguageType } from './query_builder';
import {
  EditorMode,
  QueryExecutionStatus,
} from '../../../application/utils/state_management/types';
import {
  queryExecution,
  getPreloadedQueryState,
  showPromptModeNotAvailableWarning,
  showMissingPromptWarning,
  showMissingDatasetWarning,
} from './utils';

import { prepareQueryForLanguage } from '../../../application/utils/languages';
import { generatePromQLWithAgUi } from '../../../application/utils/query_assist/promql_generator';
import { getPromptModeIsAvailable } from '../../../application/utils/get_prompt_mode_is_available';
import {
  SourceTypeRegistryService,
  setSourceTypeRegistry,
} from '../../../services/source_type_registry';
import { ExploreFlavor } from '../../../../common';

const mockQuery = {
  query: 'source=logs | head 10',
  language: 'PPL',
  dataset: { id: 'test-dataset', title: 'test-dataset', type: 'INDEX_PATTERN' },
};

const mockGetServices = () =>
  ({
    osdUrlStateStorage: undefined,
    data: {
      query: {
        queryString: {
          getQuery: jest.fn().mockReturnValue(mockQuery),
          setQuery: jest.fn(),
          getDefaultQuery: jest.fn().mockReturnValue({}),
          getInitialQueryByDataset: jest
            .fn()
            .mockReturnValue({ query: '', language: 'PPL', dataset: undefined }),
          getDatasetService: jest.fn().mockReturnValue({ cacheDataset: jest.fn() }),
          getLanguageService: jest.fn().mockReturnValue({
            getLanguage: jest.fn().mockReturnValue(null),
          }),
        },
        timefilter: {
          timefilter: {
            getTime: jest.fn().mockReturnValue({ from: 'now-15m', to: 'now' }),
            setTime: jest.fn(),
          },
        },
      },
      dataViews: {
        get: jest.fn().mockResolvedValue(undefined),
        getDefault: jest.fn().mockResolvedValue(undefined),
        ensureDefaultDataView: jest.fn().mockResolvedValue(undefined),
        convertToDataset: jest.fn().mockReturnValue({}),
      },
    },
    notifications: {
      toasts: {
        addError: jest.fn(),
        addWarning: jest.fn(),
      },
    },
    uiSettings: { get: jest.fn().mockResolvedValue(false) },
    savedObjects: {},
    http: { post: jest.fn() },
    inspectorAdapters: {
      requests: {
        reset: jest.fn(),
        start: jest.fn().mockReturnValue({
          stats: jest.fn().mockReturnThis(),
          ok: jest.fn().mockReturnThis(),
          json: jest.fn().mockReturnThis(),
          getTime: jest.fn().mockReturnValue(100),
        }),
      },
    },
  }) as any;

jest.mock('../../utils/get_prompt_mode_is_available', () => ({
  getPromptModeIsAvailable: jest.fn(),
}));

jest.mock('./utils', () => ({
  ...jest.requireActual('./utils'),
  getPreloadedQueryState: jest.fn(),
  queryExecution: jest.fn(),
  showPromptModeNotAvailableWarning: jest.fn(),
  showMissingPromptWarning: jest.fn(),
  showMissingDatasetWarning: jest.fn(),
  handleAgentError: jest.fn(),
}));

jest.mock('../../utils/query_assist/promql_generator', () => ({
  generatePromQLWithAgUi: jest.fn(),
}));

jest.mock('../../../application/utils/languages', () => ({
  prepareQueryForLanguage: jest.fn(),
}));

describe('QueryBuilder', () => {
  let builder: QueryBuilder;
  let services: ReturnType<typeof mockGetServices>;

  beforeEach(() => {
    services = mockGetServices();
    builder = new QueryBuilder(() => services);
  });

  afterEach(() => {
    builder.dispose();
  });

  describe('init', () => {
    it('initialize with default state when no URL state or saved state', async () => {
      await builder.init();
      expect(builder.queryState$.value).toEqual({
        query: '',
        language: 'PPL',
        dataset: undefined,
      });
      expect(builder.queryEditorState$.value.editorMode).toBe(EditorMode.Query);
    });

    it('load query from saved state', async () => {
      await builder.init({
        savedQueryState: { query: 'source = logs', language: 'PPL', dataset: undefined },
      });
      expect(builder.queryState$.value.query).toBe('source = logs');
      expect(builder.queryState$.value.language).toBe('PPL');
    });

    it('hydrates from savedQueryState only, ignoring URL state', async () => {
      services.osdUrlStateStorage = {
        get: jest.fn(() => ({ query: 'source = from_url', language: 'PPL' })),
        set: jest.fn(),
      } as any;

      await builder.init({
        savedQueryState: { query: 'source = logs', language: 'PPL', dataset: undefined },
      });
      expect(services.osdUrlStateStorage.get).not.toHaveBeenCalled();
      expect(builder.queryState$.value.query).toBe('source = logs');
      expect(builder.queryState$.value.language).toBe('PPL');
    });

    it('sets up subscriptions', async () => {
      await builder.init();
      // expect((builder as any).subscriptions.length).toBe(2);
      // Only the query sync: the language follows the query, so there's no language sync.
      expect((builder as any).subscriptions.length).toBe(1);
    });
  });

  describe('updateQueryState', () => {
    beforeEach(() => {
      builder.updateQueryState({
        query: 'source = logs1',
        language: 'PPL',
        dataset: undefined,
      });
    });
    it('merges partial updates into queryState$', () => {
      builder.updateQueryState({ query: 'source = logs' });
      expect(builder.queryState$.value.query).toBe('source = logs');
      expect(builder.queryState$.value.language).toBe('PPL');
    });
  });

  describe('updateQueryEditorState', () => {
    beforeEach(() => {
      builder.updateQueryEditorState({
        promptModeIsAvailable: false,
        editorMode: EditorMode.Query,
      });
    });
    it('merges partial updates into queryEditorState$', () => {
      builder.updateQueryEditorState({ promptModeIsAvailable: true });
      expect(builder.queryEditorState$.value.promptModeIsAvailable).toBe(true);
      expect(builder.queryEditorState$.value.editorMode).toBe(EditorMode.Query);
    });

    it('updates editorMode', () => {
      builder.updateQueryEditorState({ editorMode: EditorMode.Prompt });
      expect(builder.queryEditorState$.value.editorMode).toBe(EditorMode.Prompt);
    });
  });

  describe('updateQueryResultForEditor', () => {
    it('updates resultState$', () => {
      const result = { hits: { hits: [], total: 0 } } as any;
      builder.updateQueryResultForEditor(result);
      expect(builder.resultState$.value).toEqual(result);
    });
  });

  describe('clearResultState', () => {
    it('resets resultState$ to undefined', () => {
      builder.updateQueryResultForEditor({ hits: { hits: [] } } as any);
      builder.clearResultState();
      expect(builder.resultState$.value).toBeUndefined();
    });
  });

  describe('dispose', () => {
    it('completes all subjects', () => {
      const completeSpy = jest.spyOn(builder.queryState$, 'complete');
      builder.dispose();
      expect(completeSpy).toHaveBeenCalled();
    });
  });

  describe('waitForDatasetReady', () => {
    it('waits until isLoading becomes false', async () => {
      builder.datasetView$.next({ dataView: undefined, isLoading: true, error: null });

      setTimeout(() => {
        builder.datasetView$.next({ dataView: undefined, isLoading: false, error: null });
      }, 50);

      const result = await builder.waitForDatasetReady();
      expect(result.isLoading).toBe(false);
    });
  });

  describe('executeQuery', () => {
    beforeEach(() => {
      (prepareQueryForLanguage as jest.Mock).mockReturnValue({
        query: 'source = logs',
      });
    });
    it('interpolates with the interpolation service current at execution time', async () => {
      const makeService = (value: string) => ({
        hasVariables: jest.fn(() => true),
        interpolate: jest.fn(() => value),
      });
      let current: ReturnType<typeof makeService> | undefined = makeService('source = first');
      const row = new QueryBuilder(
        () => services,
        'B',
        () => current as any
      );
      row.setIsInitialized(true);
      row.datasetView$.next({ dataView: { id: 'logs' } as any, isLoading: false, error: null });

      await row.executeQuery();
      expect(row.lastExecutedInterpolatedQuery).toBe('source = first');

      // The container replaced its service: the row picks it up without being told.
      current = makeService('source = second');
      await row.executeQuery();
      expect(row.lastExecutedInterpolatedQuery).toBe('source = second');

      current = undefined;
      await row.executeQuery();
      expect(row.lastExecutedInterpolatedQuery).toBe('source = logs');
      row.dispose();
    });

    it('does nothing when datasetView has no dataView', async () => {
      builder.setIsInitialized(true);
      // datasetView has no dataView by default
      await builder.executeQuery();
      expect(builder.queryEditorState$.value.queryStatus.status).toBe(
        QueryExecutionStatus.UNINITIALIZED
      );
    });

    it('does nothing when datasetView has an error', async () => {
      builder.setIsInitialized(true);
      builder.datasetView$.next({ dataView: undefined, isLoading: false, error: 'some error' });
      await builder.executeQuery();
      expect(builder.queryEditorState$.value.queryStatus.status).toBe(
        QueryExecutionStatus.UNINITIALIZED
      );
    });

    it('does nothing when datasetView is loading', async () => {
      builder.setIsInitialized(true);
      builder.datasetView$.next({ dataView: undefined, isLoading: true, error: null });
      await builder.executeQuery();
      expect(builder.queryEditorState$.value.queryStatus.status).toBe(
        QueryExecutionStatus.UNINITIALIZED
      );
    });

    it('executes query when dataView is ready', async () => {
      builder.setIsInitialized(true);
      const mockDataView = {
        id: 'logs',
        title: 'logs',
        fields: [],
      } as any;

      builder.datasetView$.next({
        dataView: mockDataView,
        isLoading: false,
        error: null,
      });

      await builder.executeQuery();

      expect(queryExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          queryString: 'source = logs',
        })
      );
    });
  });

  describe('onQueryExecutionSubmit', () => {
    it('calls executeQuery in Query mode', async () => {
      const executeQuerySpy = jest.spyOn(builder, 'executeQuery').mockResolvedValue();
      const callAgentSpy = jest.spyOn(builder, 'callAgent').mockResolvedValue();

      builder.updateQueryEditorState({ editorMode: EditorMode.Query });
      await builder.onQueryExecutionSubmit();
      expect(executeQuerySpy).toHaveBeenCalled();
      expect(callAgentSpy).not.toHaveBeenCalled();
    });

    it('shows warning when in Prompt mode but promptModeIsAvailable is false', async () => {
      builder.updateQueryEditorState({
        editorMode: EditorMode.Prompt,
        promptModeIsAvailable: false,
      });
      await builder.onQueryExecutionSubmit();
      expect(showPromptModeNotAvailableWarning).toHaveBeenCalledWith(services.notifications.toasts);
    });

    it('calls callAgent when in Prompt mode and promptModeIsAvailable is true', async () => {
      const callAgentSpy = jest.spyOn(builder, 'callAgent').mockResolvedValue();
      builder.updateQueryEditorState({
        editorMode: EditorMode.Prompt,
        promptModeIsAvailable: true,
      });
      await builder.onQueryExecutionSubmit();
      expect(callAgentSpy).toHaveBeenCalled();
    });
  });

  describe('callAgent', () => {
    it('returns early when editorRef is null', async () => {
      await builder.callAgent();
      expect(services.http.post).not.toHaveBeenCalled();
    });

    it('shows missing prompt warning when editor is empty', async () => {
      builder.setEditor({ getValue: jest.fn().mockReturnValue('') } as any);
      await builder.callAgent();
      expect(showMissingPromptWarning).toHaveBeenCalledWith(services.notifications.toasts);
    });

    it('shows missing dataset warning when no dataset', async () => {
      builder.setEditor({ getValue: jest.fn().mockReturnValue('some text') } as any);
      services.data.query.queryString.getQuery.mockReturnValue({
        query: '',
        language: 'PPL',
        dataset: undefined,
      });
      await builder.callAgent();
      expect(showMissingDatasetWarning).toHaveBeenCalledWith(services.notifications.toasts);
    });

    it('handles PROMETHEUS dataset type', async () => {
      builder.setEditor({
        getValue: jest.fn().mockReturnValue('question'),
      } as any);

      // callAgent reads the row's own query state, not the global query string.
      builder.updateQueryState({
        query: '',
        language: 'PromQL',
        dataset: {
          id: 'prom-1',
          title: 'prometheus',
          type: 'PROMETHEUS',
        } as any,
      });

      (generatePromQLWithAgUi as jest.Mock).mockResolvedValue({
        query: 'generated PromQL',
      });

      await builder.callAgent();

      expect(builder.queryEditorState$.value.lastExecutedTranslatedQuery).toBe('generated PromQL');
    });

    it('able to handle t2ppl', async () => {
      builder.setEditor({
        getValue: jest.fn().mockReturnValue('question'),
      } as any);

      builder.updateQueryState({
        query: '',
        language: 'PPL',
        dataset: {
          id: 'ppl-1',
          title: 'ppl',
          type: 'PPL',
        } as any,
      });

      const mockApiResponse = {
        query: 'source=logs | head 10',
        timeRange: null,
      };
      services.http.post.mockResolvedValue(mockApiResponse);
      await builder.callAgent();
      expect(builder.queryEditorState$.value.lastExecutedTranslatedQuery).toBe(
        mockApiResponse.query
      );
    });
  });

  describe('handleDatasetChange', () => {
    it('returns undefined and disables agents when no dataset', async () => {
      const result = await (builder as any).handleDatasetChange({ query: '', language: 'PPL' });
      expect(result).toBeUndefined();
      expect(builder.queryEditorState$.value.promptModeIsAvailable).toBe(false);
    });

    it('fetches dataView and checks agent availability for dataset', async () => {
      const mockDataView = { id: 'logs', title: 'logs' };
      services.data.dataViews.get = jest.fn().mockResolvedValue(mockDataView);
      const checkAgentSpy = jest.spyOn(builder as any, 'checkAgentAvailability');

      const dataset = {
        id: 'logs',
        title: 'logs',
        type: 'INDEX_PATTERN',
        dataSource: { id: 'ds-123' },
      } as any;

      const query = { query: '', language: 'PPL', dataset };
      await (builder as any).handleDatasetChange(query);

      // The row's own query, not the global one, decides AI availability.
      expect(checkAgentSpy).toHaveBeenCalledWith(query);
    });
  });

  describe('fetchDataView', () => {
    it('returns cached dataView when available', async () => {
      const mockDataView = { id: 'logs', title: 'logs' };
      services.data.dataViews.get = jest.fn().mockResolvedValue(mockDataView);

      const dataset = { id: '123', title: 'logs', type: 'INDEX_PATTERN' } as any;
      const result = await (builder as any).fetchDataView(dataset);

      expect(result).toEqual(mockDataView);
      expect(services.data.dataViews.get).toHaveBeenCalledTimes(1);
      expect(services.data.dataViews.get).toHaveBeenCalledWith('123', false);
    });

    it('caches dataset when not found in cache', async () => {
      services.data.dataViews.get = jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ id: 'logs', title: 'logs' });
      const cacheDatasetSpy = jest.fn().mockResolvedValue(undefined);
      services.data.query.queryString.getDatasetService = jest
        .fn()
        .mockReturnValue({ cacheDataset: cacheDatasetSpy });

      const dataset = { id: 'logs', title: 'logs', type: 'INDEX_PATTERN' } as any;
      await (builder as any).fetchDataView(dataset);

      expect(cacheDatasetSpy).toHaveBeenCalled();
      expect(services.data.dataViews.get).toHaveBeenCalledTimes(2);
    });

    it('uses onlyCheckCache=true for non-index-pattern datasets', async () => {
      const mockDataView = { id: 'prom', title: 'prometheus' };
      services.data.dataViews.get = jest.fn().mockResolvedValue(mockDataView);

      const dataset = { id: 'prom', title: 'prometheus', type: 'PROMETHEUS' } as any;
      await (builder as any).fetchDataView(dataset);

      expect(services.data.dataViews.get).toHaveBeenCalledWith('prom', true);
    });
  });

  it('updates agent flag when both checks succeed', async () => {
    (getPromptModeIsAvailable as jest.Mock).mockResolvedValue(true);

    await (builder as any).checkAgentAvailability('ds-123');

    expect(builder.queryEditorState$.value.promptModeIsAvailable).toBe(true);
  });

  describe("a registered Metrics source's own language", () => {
    const dataset = { id: 'my-metrics', title: 'My metrics', type: 'MY_DATASET_TYPE' } as any;
    beforeEach(() => {
      const registry = new SourceTypeRegistryService();
      registry.register({
        id: 'my-source',
        label: 'My Source',
        datasetTypes: ['MY_DATASET_TYPE'],
        flavors: [ExploreFlavor.Metrics],
        languageSettings: { MY_SQL: {} },
        resolveDefaultDataset: async () => undefined,
      });
      setSourceTypeRegistry(registry);
      (getPreloadedQueryState as jest.Mock).mockResolvedValue({
        query: '',
        language: 'MY_SQL',
        dataset,
      });
    });
    afterEach(() => setSourceTypeRegistry(new SourceTypeRegistryService()));

    it('keeps the saved query options on init', async () => {
      await builder.init({
        savedQueryState: {
          query: 'SELECT 1',
          language: 'MY_SQL',
          dataset,
          queryOptions: { maxDataPoints: 50 },
        },
      });

      expect(builder.queryState$.value.queryOptions).toEqual({ maxDataPoints: 50 });

      builder.updateQueryOptions({ maxDataPoints: 75 });
      expect(builder.queryState$.value.queryOptions).toEqual({ maxDataPoints: 75 });
    });

    it('still drops query options for a logs language', async () => {
      (getPreloadedQueryState as jest.Mock).mockResolvedValue(mockQuery);
      await builder.init({
        savedQueryState: { ...mockQuery, queryOptions: { maxDataPoints: 50 } },
      });

      expect(builder.queryState$.value.queryOptions).toBeUndefined();
    });
  });

  describe('setupQuerySync', () => {
    it('handles dataset changes', async () => {
      await builder.init();

      const mockDataView = { id: 'logs', title: 'logs' };
      jest.spyOn(builder as any, 'handleDatasetChange').mockResolvedValue(mockDataView);

      const dataset = { id: 'logs', title: 'logs', type: 'INDEX_PATTERN' } as any;
      builder.updateQueryState({ dataset });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(builder.datasetView$.value.dataView).toEqual(mockDataView);
      expect(builder.datasetView$.value.isLoading).toBe(false);
      expect(builder.datasetView$.value.error).toBeNull();
    });

    it('shows error toast when dataset loading fails', async () => {
      await builder.init();
      jest
        .spyOn(builder as any, 'handleDatasetChange')
        .mockRejectedValue(new Error('Dataset not found'));

      const dataset = { id: 'invalid', title: 'invalid', type: 'INDEX_PATTERN' } as any;
      builder.updateQueryState({ dataset });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(builder.datasetView$.value.error).toContain('Error loading dataset');
    });
  });

  // describe('setupLanguageSync', () => {
  //   it('updates query state when language type changes', async () => {
  //     await builder.init();

  //     const newQueryState = {
  //       query: '',
  //       language: 'PromQL',
  //       dataset: { id: 'prom', title: 'prometheus', type: 'PROMETHEUS' },
  //     };
  //     (getPreloadedQueryState as jest.Mock).mockResolvedValue(newQueryState);

  //     builder.updateQueryEditorState({ languageType: SupportLanguageType.promQL });

  //     await new Promise((resolve) => setTimeout(resolve, 100));

  //     expect(builder.queryState$.value.language).toBe('PromQL');
  //     expect(builder.queryState$.value.dataset).toEqual(newQueryState.dataset);
  //   });

  //   it('handles language switch errors', async () => {
  //     await builder.init();

  //     const error = new Error('Failed to load dataset');
  //     (getPreloadedQueryState as jest.Mock).mockRejectedValue(new Error('Failed to load dataset'));

  //     builder.updateQueryEditorState({ languageType: SupportLanguageType.promQL });

  //     await new Promise((resolve) => setTimeout(resolve, 100));

  //     expect(builder.datasetView$.value.error).toBe('Failed to load dataset');
  //     expect(services.notifications.toasts.addError).toHaveBeenCalledWith(error, {
  //       title: 'Error switching language',
  //     });
  //   });
  // });

  // languageType was removed from QueryEditorState: the language lives on the query state only.
  describe('language lives on the query state', () => {
    it("is set from the preloaded query's language on init", async () => {
      (getPreloadedQueryState as jest.Mock).mockResolvedValue({
        query: '',
        language: 'PROMQL',
        dataset: { id: 'prom', title: 'prometheus', type: 'PROMETHEUS' },
      });
      await builder.init({ savedQueryState: { query: 'up', language: 'PROMQL' } });

      expect(builder.queryState$.value.language).toBe(SupportLanguageType.promQL);
    });

    it('updates when the query language changes, without preloading another dataset', async () => {
      await builder.init();
      const dataset = builder.queryState$.value.dataset;
      (getPreloadedQueryState as jest.Mock).mockClear();

      builder.updateQueryState({ language: 'SQL', query: '' });

      expect(builder.queryState$.value.language).toBe(SupportLanguageType.sql);
      expect(builder.queryState$.value.dataset).toEqual(dataset);
      expect(getPreloadedQueryState).not.toHaveBeenCalled();
    });
  });

  describe('multi-query row isolation', () => {
    let row: QueryBuilder;

    beforeEach(() => {
      services.osdUrlStateStorage = { get: jest.fn(), set: jest.fn() } as any;
      (getPreloadedQueryState as jest.Mock).mockResolvedValue({
        query: '',
        language: 'PPL',
        dataset: undefined,
      });
      row = new QueryBuilder(() => services, 'B');
    });

    afterEach(() => {
      row.dispose();
    });

    it('does not write URL, global query string or timefilter', async () => {
      jest.useFakeTimers();
      await row.init();
      row.updateQueryState({ query: 'source = edited' });
      jest.advanceTimersByTime(1000);
      jest.useRealTimers();

      expect(services.osdUrlStateStorage.set).not.toHaveBeenCalled();
      expect(services.data.query.queryString.setQuery).not.toHaveBeenCalled();
      expect(services.data.query.timefilter.timefilter.setTime).not.toHaveBeenCalled();
    });

    it('executes with its own abort map (no shared/global map)', async () => {
      row.setIsInitialized(true);
      row.datasetView$.next({ dataView: { id: 'logs' } as any, isLoading: false, error: null });
      (prepareQueryForLanguage as jest.Mock).mockReturnValue({ query: 'source = logs' });

      (queryExecution as jest.Mock).mockClear();
      await row.executeQuery();
      await builder.executeQuery();

      // Keyed by refId so a new run of the same row cancels its previous request.
      const calls = (queryExecution as jest.Mock).mock.calls.map(([args]) => args);
      const rowCall = calls.find((args) => args.abortKey === row.refId);
      const builderCall = calls.find((args) => args.abortKey === builder.refId);
      expect(rowCall?.activeQueryAbortControllers).toBeInstanceOf(Map);
      expect(rowCall?.activeQueryAbortControllers).not.toBe(
        builderCall?.activeQueryAbortControllers
      );
    });
  });

  describe('abortActiveQueries', () => {
    it("aborts only this builder's queries", async () => {
      const other = new QueryBuilder(() => services, 'Z');
      const controllers = new Map<QueryBuilder, AbortController>();
      (queryExecution as jest.Mock).mockImplementation(
        ({ queryString, activeQueryAbortControllers }) => {
          const controller = new AbortController();
          activeQueryAbortControllers.set(queryString, controller);
          return controller;
        }
      );
      (prepareQueryForLanguage as jest.Mock).mockReturnValue({ query: 'q' });
      [builder, other].forEach((b) => {
        b.setIsInitialized(true);
        b.datasetView$.next({ dataView: { id: 'logs' } as any, isLoading: false, error: null });
      });
      await builder.executeQuery();
      controllers.set(builder, (queryExecution as jest.Mock).mock.results.slice(-1)[0].value);
      await other.executeQuery();
      controllers.set(other, (queryExecution as jest.Mock).mock.results.slice(-1)[0].value);

      other.abortActiveQueries();

      expect(controllers.get(other)?.signal.aborted).toBe(true);
      expect(controllers.get(builder)?.signal.aborted).toBe(false);
      (queryExecution as jest.Mock).mockReset();
      other.dispose();
    });
  });
});
