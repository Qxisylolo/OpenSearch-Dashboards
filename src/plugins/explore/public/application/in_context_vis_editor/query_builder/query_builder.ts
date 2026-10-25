/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { BehaviorSubject, EMPTY, Subscription, from, of } from 'rxjs';
import { catchError, distinctUntilChanged, switchMap, filter } from 'rxjs/operators';
import moment from 'moment';
import { MutableRefObject } from 'react';
import { firstValueFrom } from '@osd/std';
import { isEqual } from 'lodash';
import type { monaco } from '@osd/monaco';
import {
  EditorMode,
  QueryResultStatus,
  QueryExecutionStatus,
} from '../../../application/utils/state_management/types';
import { ISearchResult } from '../../../application/utils/state_management/slices';
import { ExploreServices } from '../../../types';
import { prepareQueryForLanguage } from '../../../application/utils/languages';
import { IVariableInterpolationService } from '../../../../../dashboard/public';

import { Dataset, DEFAULT_DATA, DataView, Query } from '../../../../../data/common';
import {
  QueryAssistParameters,
  QueryAssistResponse,
} from '../../../../../query_enhancements/common/query_assist';
import { PromQLQueryOptions } from '../../../../../query_enhancements/common';

import { getPromptModeIsAvailable } from '../../../application/utils/get_prompt_mode_is_available';
import { generatePromQLWithAgUi } from '../../../application/utils/query_assist/promql_generator';
import {
  queryExecution,
  showPromptModeNotAvailableWarning,
  showMissingPromptWarning,
  showMissingDatasetWarning,
  handleAgentError,
  withLanguageQueryOptions,
} from './utils';
import { EXPLORE_DEFAULT_LANGUAGE } from '../../../../common';

export enum SupportLanguageType {
  ppl = 'PPL',
  promQL = 'PROMQL',
  ai = 'AI',
  sql = 'SQL',
}

export interface QueryState {
  query: string;
  language: string;
  dataset?: Dataset;
  queryOptions?: PromQLQueryOptions;
}

export interface QueryEditorState {
  isHidden?: boolean;
  queryStatus: QueryResultStatus;
  editorMode: EditorMode;
  promptModeIsAvailable: boolean;
  promptToQueryIsLoading: boolean;

  isQueryEditorDirty: boolean;
  userInitiatedQuery: boolean;
  // languageType: SupportLanguageType;
  lastExecutedTranslatedQuery?: string; // last generated query
}

export type QueryResultState = ISearchResult | undefined;

export interface DatasetViewState {
  dataView: DataView | undefined;
  isLoading: boolean;
  error: string | null;
}

// Marks a queryStatus error as a dataset load failure (not a query failure), so a later
// successful load can clear it.
const DATASET_LOAD_ERROR = 'Error loading dataset';

export const initialQueryStatus = {
  status: QueryExecutionStatus.UNINITIALIZED,
  elapsedMs: undefined,
  startTime: undefined,
};

const initialQueryEditorState: QueryEditorState = {
  queryStatus: initialQueryStatus,
  editorMode: EditorMode.Query,
  promptModeIsAvailable: false,
  promptToQueryIsLoading: false,
  isQueryEditorDirty: false,
  userInitiatedQuery: false, // user click the refresh button
  // languageType: SupportLanguageType.ppl,
  lastExecutedTranslatedQuery: undefined,
  isHidden: false,
};

/**
 * QueryBuilder manages query state for query editor component.
 */
export class QueryBuilder {
  public queryState$ = new BehaviorSubject<QueryState>({
    query: '',
    language: 'PPL',
    dataset: undefined,
  });

  public queryEditorState$ = new BehaviorSubject<QueryEditorState>(initialQueryEditorState);

  public resultState$ = new BehaviorSubject<QueryResultState>(undefined);
  public datasetView$ = new BehaviorSubject<DatasetViewState>({
    dataView: undefined,
    isLoading: false,
    error: null,
  });
  private isInitialized = false;
  public editorRef: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null> = {
    current: null,
  };
  private subscriptions = Array<Subscription>();
  private getServices: () => ExploreServices;
  // Shared by every row and owned by the container
  private readonly getInterpolationService: () => IVariableInterpolationService | undefined;
  public lastExecutedInterpolatedQuery?: string;

  public refId: string;
  // The query state seen by the previous query sync, to detect dataset/language changes.
  private prevQueryState?: QueryState;
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(
    getServices: () => ExploreServices,
    refId = 'A',
    getInterpolationService: () => IVariableInterpolationService | undefined = () => undefined
  ) {
    this.getServices = getServices;
    this.refId = refId;
    this.getInterpolationService = getInterpolationService;
  }

  // Initialize row with given and merged state
  init(options?: { savedQueryState?: QueryState; savedEditorState?: Partial<QueryEditorState> }) {
    if (this.isInitialized) {
      return;
    }

    if (typeof options?.savedEditorState?.isHidden === 'boolean') {
      this.updateQueryEditorState({ isHidden: options.savedEditorState.isHidden });
    }

    this.updateQueryState(
      withLanguageQueryOptions(
        options?.savedQueryState ?? {
          query: '',
          language: EXPLORE_DEFAULT_LANGUAGE,
          dataset: undefined,
        }
      )
    );
    this.updateQueryEditorState({
      editorMode: EditorMode.Query,
      queryStatus: initialQueryStatus,
    });

    this.setupQuerySync();

    // await this.waitForDatasetReady();
    this.setIsInitialized(true);
  }

  private async handleDatasetChange(query: Query): Promise<DataView | undefined> {
    const dataset = query.dataset;
    if (!dataset) {
      this.updateQueryEditorState({
        promptModeIsAvailable: false,
      });
      return undefined;
    }

    const dataView = await this.fetchDataView(dataset);
    await this.checkAgentAvailability(query);
    return dataView;
  }

  private setupQuerySync() {
    const querySyncSub = this.queryState$
      .pipe(
        // Only a dataset or language change triggers fetch dataview. Other edits (query text,
        // options) must not reach here: it would cancel a load still in flight.
        distinctUntilChanged(
          (prev, curr) =>
            isEqual(prev.dataset, curr.dataset) && isEqual(prev.language, curr.language)
        ),
        switchMap((newQuery) => {
          // Compare against this row's own previous state: the global query string reflects
          // whichever row is selected.
          const prevQuery = this.prevQueryState;
          this.prevQueryState = newQuery;
          const isDatasetChanged = !isEqual(prevQuery?.dataset, newQuery?.dataset);
          const isLanguageChanged = !isEqual(prevQuery?.language, newQuery?.language);

          // sync dataset change
          // check isLanguageChanged and isInitialized for the initial sync
          if (isDatasetChanged || isLanguageChanged || !this.isInitialized) {
            this.datasetView$.next({ ...this.datasetView$.getValue(), isLoading: true });

            // Handle the error here to avoid error stops stream
            return from(this.handleDatasetChange(newQuery)).pipe(
              catchError((error) => {
                const message = `Error loading dataset: ${error.message}`;
                this.datasetView$.next({
                  dataView: undefined,
                  isLoading: false,
                  error: message,
                });
                this.setDatasetLoadError(message);
                this.getServices().notifications?.toasts.addError(error, {
                  title: `Query ${this.refId}: error loading dataset`,
                });
                return EMPTY;
              })
            );
          }

          return of(null); // no change
        }),
        filter((result) => result !== null)
      )
      .subscribe({
        next: (dataView) => {
          this.datasetView$.next({
            dataView,
            isLoading: false,
            error: null,
          });
          // A dataset that loads again (the user picked another one) clears its load error.
          if (this.queryEditorState$.value.queryStatus.error?.error === DATASET_LOAD_ERROR) {
            this.updateQueryEditorState({ queryStatus: initialQueryStatus });
          }
        },
      });

    this.subscriptions.push(querySyncSub);
  }

  private async checkAgentAvailability(query: Query) {
    const result = await getPromptModeIsAvailable(this.getServices(), query);
    this.updateQueryEditorState({ promptModeIsAvailable: result });
  }

  private async fetchDataView(dataset: Dataset) {
    const {
      dataViews,
      query: { queryString },
    } = this.getServices().data;

    const onlyCheckCache = dataset.type !== DEFAULT_DATA.SET_TYPES.INDEX_PATTERN;
    let dataView = await dataViews.get(dataset.id, onlyCheckCache);
    if (!dataView) {
      // Cache the dataset
      await queryString.getDatasetService().cacheDataset(
        dataset,
        {
          uiSettings: this.getServices().uiSettings,
          savedObjects: this.getServices().savedObjects,
          notifications: this.getServices().notifications,
          http: this.getServices().http,
          data: this.getServices().data,
        },
        false,
        dataset?.signalType // set data view signalType from dataset
      );

      // Try to get it again from cache
      dataView = await dataViews.get(dataset.id, onlyCheckCache);
    }
    return dataView;
  }

  // This is used when user proactively submits a query or a prompt.
  // This called executeQuery under the hood
  async onQueryExecutionSubmit() {
    const queryEditorState = this.queryEditorState$.value;
    // Set flag to indicate user has initiated a query
    this.updateQueryEditorState({ userInitiatedQuery: true });

    const { editorMode, promptModeIsAvailable } = queryEditorState;
    if (editorMode === EditorMode.Prompt) {
      // Handle the unlikely situation where user is on prompt mode but does not have prompt available
      if (!promptModeIsAvailable) {
        showPromptModeNotAvailableWarning(this.getServices().notifications.toasts);
        return;
      }

      await this.callAgent();
    } else {
      await this.executeQuery();
    }
  }

  async callAgent() {
    if (!this.editorRef.current) return;

    // for prompt mode, we won't store the prompt and generated query
    // so directly read user input
    const editorText = this.editorRef.current.getValue();

    if (!editorText.length) {
      showMissingPromptWarning(this.getServices().notifications.toasts);
      return;
    }

    // const currentQuery = this.getServices().data.query.queryString.getQuery();
    // Use this row's own query: the global one belongs to the selected row only.
    const currentQuery = this.queryState$.getValue();
    if (!currentQuery.dataset) {
      showMissingDatasetWarning(this.getServices().notifications.toasts);
      return;
    }

    try {
      this.updateQueryEditorState({ promptToQueryIsLoading: true });
      if (currentQuery.dataset.type === 'PROMETHEUS') {
        const result = await generatePromQLWithAgUi({
          data: this.getServices().data,
          question: editorText,
          dataSourceName: currentQuery.dataset.title,
          dataSourceId: currentQuery.dataset.dataSource?.id,
          dataSourceMeta: currentQuery.dataset.dataSource?.meta as Record<string, unknown>,
        });

        const queryString = result.query;

        this.clearResultState();

        this.updateQueryEditorState({
          queryStatus: initialQueryStatus,
          lastExecutedTranslatedQuery: queryString,
        });

        await queryExecution({
          services: this.getServices(),
          query: this.queryState$.getValue(),
          queryString,
          updateEditorStateFn: this.updateQueryEditorState.bind(this),
          updateResultFn: this.updateQueryResultForEditor.bind(this),
          activeQueryAbortControllers: this.abortControllers,
          // one request per row; a new run cancels the previous one.
          abortKey: this.refId,
        });

        return;
      }

      const params: QueryAssistParameters = {
        question: editorText,
        index: currentQuery.dataset.title,
        language: 'PPL',
        dataSourceId: currentQuery.dataset.dataSource?.id,
        currentTime: moment().format('YYYY-MM-DD HH:mm:ss'),
        timeField: currentQuery.dataset.timeFieldName,
      };

      const response = await this.getServices().http.post<QueryAssistResponse>(
        '/api/enhancements/assist/generate',
        {
          body: JSON.stringify(params),
        }
      );
      if (response.timeRange) {
        const convertedTimeRange = {
          from: moment(response.timeRange.from, 'YYYY-MM-DD HH:mm:ss').toISOString(),
          to: moment(response.timeRange.to, 'YYYY-MM-DD HH:mm:ss').toISOString(),
        };
        this.getServices().data.query.timefilter.timefilter.setTime(convertedTimeRange);
      }
      const queryString = response.query;

      this.clearResultState();

      this.updateQueryEditorState({
        queryStatus: initialQueryStatus,
        lastExecutedTranslatedQuery: queryString,
      });

      await queryExecution({
        services: this.getServices(),
        query: this.queryState$.getValue(),
        queryString,
        updateEditorStateFn: this.updateQueryEditorState.bind(this),
        updateResultFn: this.updateQueryResultForEditor.bind(this),
        activeQueryAbortControllers: this.abortControllers,
        abortKey: this.refId,
      });
    } catch (error) {
      handleAgentError(this.getServices().notifications.toasts, error);
    } finally {
      this.updateQueryEditorState({ promptToQueryIsLoading: false });
    }
  }

  setIsInitialized(isInitialized: boolean) {
    this.isInitialized = isInitialized;
  }

  clearResultState() {
    this.resultState$.next(undefined);
  }

  updateQueryEditorState(updates: Partial<QueryEditorState>) {
    const currentState = this.queryEditorState$.value;
    this.queryEditorState$.next({
      ...currentState,
      ...updates,
    });
  }

  updateQueryResultForEditor(result: ISearchResult | undefined) {
    this.resultState$.next(result);
  }

  updateQueryState(updates: Partial<QueryState>) {
    const currentState = this.queryState$.value;
    const updatedQuery = {
      ...currentState,
      ...updates,
    };

    this.queryState$.next(updatedQuery);
  }

  // Only for updating PromQL step/legend options
  updateQueryOptions(partial: Partial<PromQLQueryOptions>) {
    const queryOptions = {
      ...this.queryState$.value.queryOptions,
      ...partial,
    };
    this.updateQueryState({ queryOptions });
  }

  async waitForDatasetReady(): Promise<DatasetViewState> {
    return firstValueFrom(this.datasetView$.pipe(filter((dv) => !dv.isLoading)));
  }

  // HTTP failures carry a status code; others (e.g. a deleted index pattern) don't.
  private setDatasetLoadError(message: string) {
    this.updateQueryEditorState({
      queryStatus: {
        status: QueryExecutionStatus.ERROR,
        error: {
          // TODO decide if deleted
          statusCode: 0,
          error: DATASET_LOAD_ERROR,
          message: { details: message, reason: DATASET_LOAD_ERROR },
          originalErrorMessage: message,
        },
      },
    });
  }

  async executeQuery() {
    this.clearResultState();

    const datasetView = await this.waitForDatasetReady();

    if (datasetView.error) return;
    this.updateQueryEditorState({
      queryStatus: initialQueryStatus,
    });

    // No dataset (e.g. a restored row without one): nothing to run, the row doesn't take part.
    if (!datasetView.dataView) {
      return;
    }
    const currentQuery = this.queryState$.value;
    // prepare querystring for execution, add clause when query is '' for PPL
    let queryString = this.prepareQueryStringToCacheKey(currentQuery);

    const interpolationService = this.getInterpolationService();
    if (interpolationService && interpolationService.hasVariables(queryString)) {
      queryString = interpolationService.interpolate(queryString, currentQuery.language);
    }

    this.lastExecutedInterpolatedQuery = queryString;

    await queryExecution({
      services: this.getServices(),
      query: this.queryState$.getValue(),
      queryString,
      updateEditorStateFn: this.updateQueryEditorState.bind(this),
      updateResultFn: this.updateQueryResultForEditor.bind(this),
      activeQueryAbortControllers: this.abortControllers,
      abortKey: this.refId,
    });
  }

  abortActiveQueries() {
    this.abortControllers.forEach((controller) => controller.abort());
    this.abortControllers.clear();
  }

  private prepareQueryStringToCacheKey(query: Query) {
    const preparedQuery = prepareQueryForLanguage(query);
    return preparedQuery.query;
  }

  setEditor(editor: monaco.editor.IStandaloneCodeEditor | null) {
    this.editorRef.current = editor;
  }

  getEditor(): monaco.editor.IStandaloneCodeEditor | null {
    return this.editorRef.current;
  }

  getQueryEditorState() {
    return this.queryEditorState$.value;
  }

  dispose(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions = [];

    this.queryEditorState$.complete();
    this.queryState$.complete();
    this.resultState$.complete();
    this.datasetView$.complete();
    this.abortActiveQueries();
  }
}
