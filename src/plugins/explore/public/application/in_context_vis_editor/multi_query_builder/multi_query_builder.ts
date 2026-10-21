/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { BehaviorSubject, Subscription, combineLatest, Observable, of } from 'rxjs';
import { distinctUntilChanged, debounceTime, map, filter, switchMap } from 'rxjs/operators';
import { isEqual, isUndefined, omitBy } from 'lodash';

import { ExploreServices } from '../../../types';
import {
  QueryBuilder,
  QueryState,
  QueryResultState,
  QueryEditorState,
} from '../query_builder/query_builder';
import { getQueryLabel } from '../../../../../data/common';

import {
  QueryRows,
  UrlMultiEditorState,
  UrlRowEditorState,
  UrlRowEntry,
  getQueryLabelIndex,
  normalizeUrlEditorState,
  normalizeUrlQueries,
} from './utils';
import { QUERY_BUILDER_QUERY_STATE_KEY, QUERY_EDITOR_STATE_KEY } from '../types';

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
  maxDataPoints?: number;
  selectedRowRefId?: string;
}

interface RowSavedStates {
  savedQueryState?: QueryState;
  savedEditorState?: Partial<QueryEditorState>;
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
  public multiQueryResults$ = new BehaviorSubject<MultiQueryResult>({});

  public variableNames$ = new BehaviorSubject<string[]>([]);
  private interpolationService?: IVariableInterpolationService;

  private getServices: () => ExploreServices;
  private refIdCounter = 0;
  private subscriptions = Array<Subscription>();
  private isInitialized = false;

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

    const { queries: queriesFromUrl, editorState: editorStateFromUrl } = this.readUrlState();

    if (queriesFromUrl.length > 0) {
      this.loadQueryRows(queriesFromUrl, editorStateFromUrl);
    } else if (options?.savedQueries?.length) {
      this.loadSavedQueries(options.savedQueries, editorStateFromUrl);
    } else {
      this.ensureRow();
      // `_e` alone (no queries): restore the rows' visibility and the container state.
      const editorStateByRefId = new Map(editorStateFromUrl.rows);
      this.getAllRows().forEach((row) =>
        this.startRowInit(row, { savedEditorState: editorStateByRefId.get(row.refId) })
      );
      this.applyMultiEditorState(editorStateFromUrl);
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

  /* --- Subscription ---
   * - setupGlobalDataRangeSync(): sync current time filter to global.
   * - startUrlSync(): one-way, state -> URL, debounced. dateRange is left out: _g (timefilter) owns
   *   it. External URL changes (back/forward) are not read back; remount the editor instead.
   */
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

  // TODO can delete? no global query used
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

  /* --- URL ---
   * - readUrlState(): reads _eq ([refId, QueryState][]) and _e (container state + per-row isHidden),
   *   both keyed by refId. For previous single query builder that holds a single row's state, use ref A.
   * - startUrlSync(): one-way, state -> URL, debounced. dateRange is left out: _g (timefilter) owns
   *   it. External URL changes (back/forward) are not read back; remount the editor instead.
   */

  private readUrlState(): {
    queries: Array<UrlRowEntry<QueryState>>;
    editorState: UrlMultiEditorState;
  } {
    const urlStateStorage = this.getServices()?.osdUrlStateStorage;
    if (!urlStateStorage) {
      return { queries: [], editorState: { rows: [] } };
    }
    return {
      queries: normalizeUrlQueries(urlStateStorage.get(QUERY_BUILDER_QUERY_STATE_KEY)),
      editorState: normalizeUrlEditorState(urlStateStorage.get(QUERY_EDITOR_STATE_KEY)),
    };
  }

  private startUrlSync() {
    // Each row's query state and persisted editor state, in row order.
    const rowsUrlState$ = this.queryRows$.pipe(
      switchMap((rows) =>
        rows.length > 0
          ? combineLatest(
              rows.map((row) =>
                combineLatest([
                  row.queryState$,
                  row.queryEditorState$.pipe(
                    map((state): UrlRowEditorState => ({
                      isHidden: state.isHidden,
                    })),
                    distinctUntilChanged((prev, curr) => isEqual(prev, curr))
                  ),
                ]).pipe(map(([queryState, editorState]) => ({ row, queryState, editorState })))
              )
            )
          : of([])
      )
    );
    // dateRange is left out: the global timefilter (`_g`) owns it.
    const multiQueryEditorUrlState$ = this.multiQueryEditorState$.pipe(
      map(({ selectedRowRefId, maxDataPoints }) => ({ selectedRowRefId, maxDataPoints })),
      distinctUntilChanged((prev, curr) => isEqual(prev, curr))
    );

    const urlSync = combineLatest([rowsUrlState$, multiQueryEditorUrlState$])
      .pipe(debounceTime(500))
      .subscribe(([rowsState, multiQueryEditorUrlState]) => {
        const queries: Array<UrlRowEntry<QueryState>> = rowsState.map(({ row, queryState }) => [
          row.refId,
          queryState,
        ]);
        const editorState: UrlMultiEditorState = {
          ...omitBy(multiQueryEditorUrlState, isUndefined),
          rows: rowsState.map(({ row, editorState: rowEditorState }) => [
            row.refId,
            omitBy(rowEditorState, isUndefined) as UrlRowEditorState,
          ]),
        };
        this.syncToUrl(QUERY_BUILDER_QUERY_STATE_KEY, queries);
        this.syncToUrl(QUERY_EDITOR_STATE_KEY, editorState);
      });

    this.subscriptions.push(urlSync);
  }

  private syncToUrl<T>(place: string, state: T) {
    const urlStateStorage = this.getServices()?.osdUrlStateStorage;

    if (urlStateStorage) {
      urlStateStorage.set(place, state, { replace: true });
    }
  }

  /* --- Row management ---
   * Rows are identified by refId (A, B, ...)
   * - buildRow(): constructs a row without initializing it.
   * - createRow(): buildRow() + row's init, tracked in rowPromises so init() can wait.
   * - ensureRow(): a placeholder row (built, not initialized), so hooks have a selected row before init() runs.
   * - addRow(): createRow() + appends to queryRows$; selects it only when it's the first row.
   * - removeRow(): the last row can't be removed; removing the selected row selects the first one.
   * - loadQueryRows() / loadSavedQueries(): replace all rows (refIds de-duplicated), then restore
   *   per-row editor state (isHidden) and container editor state (selectedRow, maxDataPoints).
   * - selectRow() / getSelectedRow$(): get selected row
   * - getRow() / getAllRows()
   * - updateQueryRow(): update query state or query editor for a specific row
   */

  private buildRow(refId?: string): QueryBuilder {
    const row = new QueryBuilder(
      this.getServices,
      refId ?? this.nextRefId(),
      () => this.interpolationService
    );
    if (!refId) {
      this.refIdCounter += 1;
    }
    return row;
  }

  private startRowInit(row: QueryBuilder, options?: RowSavedStates) {
    const initPromise = row.init(options);
    this.rowPromises.set(row, initPromise);
    return initPromise;
  }

  private createRow(options?: RowSavedStates & { refId?: string }): QueryBuilder {
    const row = this.buildRow(options?.refId);
    this.startRowInit(row, options);
    return row;
  }

  private ensureRow(): void {
    if (this.queryRows$.getValue().length > 0) {
      return;
    }
    const row = this.buildRow();
    this.queryRows$.next([row]);
    this.selectRow(row.refId);
  }

  addRow(opts?: RowSavedStates & { refId?: string }): QueryBuilder {
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
    const newRows = this.getAllRows().filter((row) => row.refId !== refId);
    // After removing the selected row, move selection to the first remaining row.
    if (this.multiQueryEditorState$.getValue().selectedRowRefId === refId) {
      this.selectRow(newRows[0].refId);
    }

    this.queryRows$.next(newRows);
    // Dispose last: until now the row was still listed (and maybe selected).
    deletedRow.dispose();
  }

  loadSavedQueries(queries: QueryState[], editorState?: UrlMultiEditorState): void {
    this.loadQueryRows(
      queries.map((query, index) => [getQueryLabel(index), query]),
      editorState
    );
  }

  loadQueryRows(queries: Array<UrlRowEntry<QueryState>>, editorState?: UrlMultiEditorState): void {
    this.disposeAllRows();
    const seen = new Set<string>();
    const uniqueQueries = queries.filter(([refId]) => {
      if (seen.has(refId)) return false;
      seen.add(refId);
      return true;
    });

    this.refIdCounter = Math.max(
      uniqueQueries.length,
      ...uniqueQueries.map(([refId]) => getQueryLabelIndex(refId) + 1)
    );

    const editorStateByRefId = new Map(editorState?.rows ?? []);
    uniqueQueries.forEach(([refId, savedQueryState]) => {
      this.addRow({ refId, savedQueryState, savedEditorState: editorStateByRefId.get(refId) });
    });

    // restore container state
    this.applyMultiEditorState(editorState);
  }

  // Only an existing row can be selected, so selectedRowRefId always names a row.
  selectRow(refId: string) {
    if (!this.getRow(refId)) {
      return;
    }
    this.updateMultiQueryEditorState({ selectedRowRefId: refId });
  }

  getSelectedRow$(): Observable<QueryBuilder> {
    // ensure a first row exists by the time component uses
    this.ensureRow();
    const selectedRow$ = this.multiQueryEditorState$.pipe(
      map((state) => state.selectedRowRefId),
      distinctUntilChanged()
    );
    return combineLatest([selectedRow$, this.queryRows$]).pipe(
      // Rows and selection are updated in two steps (e.g. removeRow: rows first, then selectRow), so
      // an emission can briefly carry a stale refId; fall back to the first row until selection catches up.
      map(([refId, rows]) => rows.find((row) => row.refId === refId)),
      filter((row): row is QueryBuilder => !!row),
      distinctUntilChanged()
    );
  }

  getSelectedRow(): QueryBuilder {
    this.ensureRow();
    const selectedRow = this.multiQueryEditorState$.getValue().selectedRowRefId;
    return (selectedRow ? this.getRow(selectedRow) : undefined) ?? this.getAllRows()[0];
  }

  getRow(refId: string) {
    return this.getAllRows().find((row) => row.refId === refId);
  }

  getAllRows() {
    return this.queryRows$.value;
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

  /* --- Execution ---
   * executeAll(): runs every visible (non-hidden) row in parallel; one row failing doesn't stop the others. userInitiated: false runs executeQuery directly.
   * cancelAll(): aborts every row's in-flight request and resets its result and status.
   * Each row aborts only its own requests (abort key = refId).
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

  /* --- Variables ---
   * Dashboard variables are shared by every row. Rows read the interpolation service through a
   * getter at execution time, so rows created later get it too.
   */

  setVariableNames(names: string[]) {
    this.variableNames$.next(names);
  }

  setInterpolationService(service: IVariableInterpolationService) {
    this.interpolationService = service;
  }

  getVariableNames(): string[] {
    return this.variableNames$.value;
  }

  /* --- Helpers ---
   */

  // Restores the container-level editor state; a selectedRow that matches no row is ignored.
  private applyMultiEditorState(editorState?: UrlMultiEditorState): void {
    if (editorState?.maxDataPoints !== undefined) {
      this.updateMultiQueryEditorState({ maxDataPoints: editorState.maxDataPoints });
    }
    if (editorState?.selectedRowRefId && this.getRow(editorState.selectedRowRefId)) {
      this.selectRow(editorState.selectedRowRefId);
    }
  }

  updateMultiQueryEditorState(updates: Partial<MultiQueryEditorState>) {
    const currentState = this.multiQueryEditorState$.value;
    this.multiQueryEditorState$.next({
      ...currentState,
      ...updates,
    });
  }

  updateMultiQueryResults(result: PerQueryResult) {
    const newResults = {
      ...this.multiQueryResults$.getValue(),
      [result.refId]: result,
    };
    this.multiQueryResults$.next(newResults);
  }

  private nextRefId(): string {
    return getQueryLabel(this.refIdCounter);
  }

  private disposeAllRows(): void {
    this.queryRows$.getValue().forEach((r) => r.dispose());
    this.queryRows$.next([]);
    // No rows left to point at; the next addRow() selects the first new row.
    this.updateMultiQueryEditorState({ selectedRowRefId: undefined });
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

  dispose(): void {
    // Container-level syncs (timefilter, URL, selected-row query) must stop with the container.
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions = [];
    this.disposeAllRows();
    this.queryRows$.complete();
    this.multiQueryEditorState$.complete();
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
    this.multiQueryResults$ = new BehaviorSubject<MultiQueryResult>({});
    this.variableNames$ = new BehaviorSubject<string[]>([]);
    this.refIdCounter = 0;
    this.setIsInitialized(false);
    this.interpolationService = undefined;
    this.lifecycleId += 1;
  }
}

// // Singleton instance
// let multiQueryBuilderInstance: MultiQueryBuilder | null = null;

// export function getMultiQueryBuilder(): MultiQueryBuilder {
//   if (!multiQueryBuilderInstance) {
//     multiQueryBuilderInstance = new MultiQueryBuilder(() => getExploreServices());
//   }

//   return multiQueryBuilderInstance;
// }
