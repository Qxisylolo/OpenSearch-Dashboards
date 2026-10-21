/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { BehaviorSubject, Subscription, combineLatest, Observable, of } from 'rxjs';
import { distinctUntilChanged, debounceTime, map, filter, switchMap } from 'rxjs/operators';
import { isEqual } from 'lodash';

import { ExploreServices } from '../../../types';
import {
  QueryBuilder,
  QueryState,
  QueryResultState,
  QueryEditorState,
} from '../query_builder/query_builder';
import { getQueryLabel } from '../../../../../data/common';
import { QueryRows } from './utils';
import { MULTI_QUERIES_STATE_KEY, QUERY_BUILDER_QUERY_STATE_KEY } from '../types';

import {
  QueryExecutionStatus,
  QueryResultStatus,
} from '../../../application/utils/state_management/types';
import { IVariableInterpolationService } from '../../../../../dashboard/public';
import { PromQLQueryOptions } from '../../../../../query_enhancements/common';
import { getServices as getExploreServices } from '../../../services/services';
import { getSourceTypeRegistry } from '../../../services/source_type_registry';

export interface PerQueryResult {
  refId: string;
  perQueryStatus: QueryResultStatus;
  perQueryResult: QueryResultState;
}

interface UpdateMap {
  Query: Partial<QueryState>;
  QueryEditor: Partial<QueryEditorState>;
  QueryOptions: Partial<PromQLQueryOptions>;
}

export type MultiQueryResult = Record<string, PerQueryResult>;

export interface MultiQueryEditorState {
  dateRange?: { from: string; to: string };
}

export interface MultiQueryState {
  maxDataPoints?: number;
}

const initialMultiQueryEditorState: MultiQueryEditorState = {
  dateRange: undefined,
};

/**
 * MultiQueryBuilder — container over N QueryRow.
 */
export class MultiQueryBuilder {
  public queryRows$ = new BehaviorSubject<QueryRows>([]);
  public multiQueryEditorState$ = new BehaviorSubject<MultiQueryEditorState>(
    initialMultiQueryEditorState
  );

  public multiQueryState$ = new BehaviorSubject<MultiQueryState>({});
  public variableNames$ = new BehaviorSubject<string[]>([]);

  public multiQueryResults$ = new BehaviorSubject<MultiQueryResult>({});

  private getServices: () => ExploreServices;
  private refIdCounter = 0;
  public selectedRowRef$ = new BehaviorSubject<string>('');

  private subscriptions = Array<Subscription>();
  private isInitialized = false;
  // TODO Shared by every row; applied to rows created later as well.
  private interpolationService?: IVariableInterpolationService;
  // Pending row promises after init(), so MultiQueryBuilder.init() can wait for rows to be finished before callers inspect or execute them.
  private rowPromises = new WeakMap<QueryBuilder, Promise<void>>();
  // Bumped by reset(), so an init() still awaiting from the previous lifecycle can tell it's stale.
  private lifecycleId = 0;

  constructor(getServices: () => ExploreServices) {
    this.getServices = getServices;
  }

  async init(options?: { savedQueries?: QueryState[] }): Promise<void> {
    // TODO later(subsribe url) Effects can re-run init; subscriptions must only be set up once per lifecycle.
    // TODO URL sync is one-way (state -> URL). An external URL change (back/forward POP, or a PUSH
    // into the app with a different `_mq` / `_eq`) is not picked up because the app stays mounted.
    // Rather than every builder listening to the URL, remount the editor on such a change (bump the
    // page's key from scopedHistory.listen) so reset() + the first-load init re-read it. Our own
    // writes use `replace: true`, so REPLACE can be ignored. `isInitialized` can only go once the
    // page's init effect runs exactly once.
    if (this.isInitialized) {
      return;
    }
    const lifecycleId = this.lifecycleId;

    // Priority: URL > savedQueries
    const queriesFromUrl = this.readQueriesFromUrl();
    const queries = queriesFromUrl.length > 0 ? queriesFromUrl : (options?.savedQueries ?? []);

    if (queries.length > 0) {
      this.loadSavedQueries(queries);
    } else {
      // Reuse the placeholder row consumers are already linked to after component finishes rendering
      this.ensureRow();
      this.getAllRows().forEach((row) => this.startRowInit(row));
    }

    this.setupGlobalDataRangeSync();
    // TODO delete later
    this.setupSelectedRowQuerySync();
    this.setupTimefilterToDateRangeSync();

    // Wait for all rows finish initialization by waitForDatasetReady
    await this.waitForAllRowsInitialized();
    // reset() ran while we were waiting (e.g. the page unmounted): don't attach the URL sync to
    // the next lifecycle.
    if (lifecycleId !== this.lifecycleId) {
      return;
    }
    this.startUrlSync();
    this.setIsInitialized(true);
  }

  // Hydrate queries[] from the URL: prefer the new multi-query key; fall back to the
  // deprecated single-query key so pre-multi-query URLs still open (as N=1).
  private readQueriesFromUrl(): QueryState[] {
    const urlStateStorage = this.getServices()?.osdUrlStateStorage;
    if (!urlStateStorage) {
      return [];
    }

    const multi = urlStateStorage.get<QueryState[]>(MULTI_QUERIES_STATE_KEY);
    if (multi && multi.length > 0) {
      return multi;
    }

    // fallback: a single-query URL becomes a one-element queries[].
    const single = urlStateStorage.get<QueryState>(QUERY_BUILDER_QUERY_STATE_KEY);
    return single ? [single] : [];
  }

  //  --- Subscription ---
  private setupGlobalDataRangeSync() {
    const dataRangeSyncSub = this.multiQueryEditorState$
      .pipe(
        map((state) => state?.dateRange),
        distinctUntilChanged((prev, curr) => isEqual(prev, curr))
      )
      .subscribe((dateRange) => {
        if (dateRange && this.getServices().data?.query?.timefilter?.timefilter) {
          const timefilter = this.getServices().data.query.timefilter.timefilter;
          const currentTimefilterRange = timefilter.getTime();

          if (!isEqual(currentTimefilterRange, dateRange)) {
            timefilter.setTime(dateRange);
          }
        }
      });

    this.subscriptions.push(dataRangeSyncSub);
  }

  // Rows don't write the global query string (they're created with ownsGlobalState: false).
  // Mirror the SELECTED row into it so global consumers (search context, dataset service,
  // time picker) keep seeing the query the user is editing.
  private setupSelectedRowQuerySync() {
    const selectedRowQuerySub = this.getSelectedRow$()
      .pipe(
        switchMap((row) => row.queryState$),
        distinctUntilChanged((prev, curr) => isEqual(prev, curr))
      )
      .subscribe((queryState) => {
        const cleanQuery = getSourceTypeRegistry().isMetricsLanguage(queryState?.language)
          ? queryState
          : { ...queryState, queryOptions: undefined };
        this.getServices().data.query.queryString.setQuery(cleanQuery);
      });

    this.subscriptions.push(selectedRowQuerySub);
  }

  // Keep the shared dateRange in step with the global timefilter, which can also change outside
  // the container (`_g` URL sync, the agent setting a generated time range). isEqual guards
  // against ping-pong with setupGlobalDataRangeSync.
  private setupTimefilterToDateRangeSync() {
    const timefilter = this.getServices().data?.query?.timefilter?.timefilter;
    if (!timefilter) {
      return;
    }
    const syncFromTimefilter = () => {
      const { from, to } = timefilter.getTime();
      const dateRange = { from, to };
      if (!isEqual(this.multiQueryEditorState$.getValue().dateRange, dateRange)) {
        this.updateMultiQueryEditorState({ dateRange });
      }
    };
    // Seed it so readers have a value before the first change.
    syncFromTimefilter();
    const timefilterSub = timefilter.getTimeUpdate$().subscribe(syncFromTimefilter);

    this.subscriptions.push(timefilterSub);
  }

  // Whether any visible row's dataset is time based: decides if the shared date picker shows.
  getHasTimeBasedRow$(): Observable<boolean> {
    return this.queryRows$.pipe(
      switchMap((rows) =>
        rows.length > 0
          ? combineLatest(
              rows.map((row) =>
                combineLatest([row.datasetView$, row.queryEditorState$]).pipe(
                  map(
                    ([datasetView, editorState]) =>
                      !editorState?.isHidden && !!datasetView?.dataView?.isTimeBased()
                  )
                )
              )
            ).pipe(map((flags) => flags.some(Boolean)))
          : of(false)
      ),
      distinctUntilChanged()
    );
  }

  async waitForAllRowsInitialized(): Promise<void> {
    await Promise.allSettled(this.getAllRows().map((row) => this.rowPromises.get(row)));
  }

  private startRowInit(row: QueryBuilder, options?: { savedQueryState?: QueryState }) {
    const initPromise = row.init(options);
    this.rowPromises.set(row, initPromise);
    return initPromise;
  }

  toSavedQueries(rows: QueryRows): QueryState[] {
    // when saving rows, serialize rows in array without refId and only persist query state.
    return rows.map((row) => row.queryState$.getValue());
  }

  private startUrlSync() {
    const urlSync = this.queryRows$
      .pipe(
        switchMap((rows) =>
          rows.length > 0
            ? combineLatest(rows.map((row) => row.queryState$)).pipe(map(() => rows))
            : of(rows)
        ),
        debounceTime(500)
      )
      .subscribe((rows) => {
        this.syncToUrl(MULTI_QUERIES_STATE_KEY, this.toSavedQueries(rows));
      });

    this.subscriptions.push(urlSync);
  }

  private syncToUrl(place: string, state: QueryState[] | Partial<MultiQueryEditorState>) {
    const urlStateStorage = this.getServices()?.osdUrlStateStorage;

    if (urlStateStorage) {
      urlStateStorage.set(place, state, { replace: true });
    }
  }

  // Builds a row without initialization
  private buildRow(): QueryBuilder {
    const row = new QueryBuilder(this.getServices, this.nextRefId());
    this.refIdCounter += 1;
    if (this.interpolationService) {
      row.setInterpolationService(this.interpolationService);
    }
    return row;
  }

  private createRow(options?: { savedQueryState?: QueryState }): QueryBuilder {
    const row = this.buildRow();
    this.startRowInit(row, options);
    return row;
  }

  // This is the placeholder row. Use it to ensure that consumers like useQueryBuilderState can use before init()
  private ensureRow(): void {
    if (this.queryRows$.getValue().length > 0) {
      return;
    }
    const row = this.buildRow();
    this.queryRows$.next([row]);
    this.selectRow(row.refId);
  }

  addRow(opts?: { savedQueryState?: QueryState }): QueryBuilder {
    const row = this.createRow(opts);
    const isBeforeEmpty = this.queryRows$.getValue().length === 0;
    this.queryRows$.next([...this.queryRows$.getValue(), row]);
    // if previous container is empty, select first row
    if (isBeforeEmpty) {
      this.selectRow(row.refId);
    }
    return row;
  }

  removeRow(refId: string): void {
    if (this.getAllRows().length <= 1) {
      return;
    }
    const deletedRow = this.getRow(refId);
    if (!deletedRow) return;
    deletedRow.dispose();
    const newRows = this.getAllRows().filter((row) => row.refId !== refId);
    this.queryRows$.next(newRows);
    // After removing the selected row, move selection to the first remaining row.
    if (this.selectedRowRef$.getValue() === refId) {
      this.selectRow(newRows[0].refId);
    }
  }

  updateMultiQueryResults(result: PerQueryResult) {
    const newResults = {
      ...this.multiQueryResults$.getValue(),
      [result.refId]: result,
    };
    this.multiQueryResults$.next(newResults);
  }

  updateQueryRow<T extends keyof UpdateMap>(refId: string, type: T, updates: UpdateMap[T]) {
    const updateRow = this.getRow(refId);

    switch (type) {
      case 'Query':
        updateRow?.updateQueryState(updates as Partial<QueryState>);
        break;
      case 'QueryEditor':
        updateRow?.updateQueryEditorState(updates as Partial<QueryEditorState>);
        break;
      case 'QueryOptions':
        updateRow?.updateQueryOptions(updates as Partial<PromQLQueryOptions>);
    }
  }

  selectRow(refId: string) {
    this.selectedRowRef$.next(refId);
  }

  getSelectedRow$(): Observable<QueryBuilder> {
    // ensure a first row exists by the time component uses
    this.ensureRow();
    return combineLatest([this.selectedRowRef$, this.queryRows$]).pipe(
      // Falls back to the first row if the selected refId can't be resolved
      map(([refId, rows]) => this.getRow(refId) ?? rows[0]),
      filter((row): row is QueryBuilder => !!row)
    );
  }

  getSelectedRow(): QueryBuilder {
    this.ensureRow();
    return this.getRow(this.selectedRowRef$.getValue()) ?? this.getAllRows()[0];
  }

  getRow(refId: string) {
    return this.getAllRows().find((row) => row.refId === refId);
  }

  getAllRows() {
    return this.queryRows$.value;
  }

  private nextRefId(): string {
    return getQueryLabel(this.refIdCounter);
  }

  // --- global ---
  updateMultiQueryEditorState(updates: Partial<MultiQueryEditorState>) {
    const currentState = this.multiQueryEditorState$.value;
    this.multiQueryEditorState$.next({
      ...currentState,
      ...updates,
    });
  }

  /**
   * Executes every visible row in parallel; one row failing doesn't affect the others.
   * `userInitiated: false` runs the query directly instead of the submit flow.
   */
  async executeAll({ userInitiated = true }: { userInitiated?: boolean } = {}): Promise<void> {
    // const currentRows = this.queryRows$.getValue();
    // Hidden rows are neither executed nor merged.
    const currentRows = this.queryRows$
      .getValue()
      .filter((row) => !row.getQueryEditorState().isHidden);

    await Promise.allSettled(
      currentRows.map(async (row) => {
        try {
          // await row.onQueryExecutionSubmit();
          if (userInitiated) {
            await row.onQueryExecutionSubmit();
          } else {
            await row.executeQuery();
          }
        } catch (e) {
          // skip
        }

        const result = {
          refId: row.refId,
          perQueryResult: row.resultState$.getValue(),
          perQueryStatus: row.queryEditorState$.getValue().queryStatus,
        };
        this.updateMultiQueryResults(result);
      })
    );
  }

  // Abort row and reset their status.
  cancelAll(): void {
    this.getAllRows().forEach((row) => {
      row.abortActiveQueries();
      row.clearResultState();
      row.updateQueryEditorState({
        queryStatus: {
          status: QueryExecutionStatus.UNINITIALIZED,
          startTime: undefined,
          elapsedMs: undefined,
          error: undefined,
        },
        userInitiatedQuery: false,
      });
    });
  }

  loadSavedQueries(queries: QueryState[]): void {
    this.disposeAllRows();
    this.refIdCounter = 0;
    queries.forEach((saveQuery) => {
      this.addRow({ savedQueryState: saveQuery });
    });
  }

  private disposeAllRows(): void {
    this.queryRows$.getValue().forEach((r) => r.dispose());
    this.queryRows$.next([]);
  }

  setVariableNames(names: string[]) {
    this.variableNames$.next(names);
  }

  setInterpolationService(service: IVariableInterpolationService) {
    this.interpolationService = service;
    this.getAllRows().forEach((row) => row.setInterpolationService(service));
  }

  getVariableNames(): string[] {
    return this.variableNames$.value;
  }

  dispose(): void {
    // Container-level syncs (timefilter, URL, selected-row query) must stop with the container.
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions = [];
    this.disposeAllRows();
    this.queryRows$.complete();
    this.multiQueryEditorState$.complete();
    this.multiQueryState$.complete();
    this.multiQueryResults$.complete();
    this.variableNames$.complete();
  }

  setIsInitialized(isInitialized: boolean) {
    this.isInitialized = isInitialized;
  }

  reset(): void {
    this.dispose();
    this.queryRows$ = new BehaviorSubject<QueryRows>([]);
    this.multiQueryEditorState$ = new BehaviorSubject<MultiQueryEditorState>(
      initialMultiQueryEditorState
    );
    this.multiQueryState$ = new BehaviorSubject<MultiQueryState>({});
    this.multiQueryResults$ = new BehaviorSubject<MultiQueryResult>({});
    this.variableNames$ = new BehaviorSubject<string[]>([]);
    this.refIdCounter = 0;
    this.selectedRowRef$.next('');
    this.setIsInitialized(false);
    this.interpolationService = undefined;
    this.lifecycleId += 1;
  }
}

// Singleton instance
let multiQueryBuilderInstance: MultiQueryBuilder | null = null;

export function getMultiQueryBuilder(): MultiQueryBuilder {
  if (!multiQueryBuilderInstance) {
    multiQueryBuilderInstance = new MultiQueryBuilder(() => getExploreServices());
  }

  return multiQueryBuilderInstance;
}
