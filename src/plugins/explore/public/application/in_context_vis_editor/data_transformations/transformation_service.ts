/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { distinctUntilChanged, debounceTime } from 'rxjs/operators';
import { isEqual } from 'lodash';
import { IOsdUrlStateStorage } from '../../../../../opensearch_dashboards_utils/public';
import {
  TransformationInstance,
  TransformationPipeline,
  TransformationDefinition,
  ITransformationService,
} from './types';
import {
  addTransformation,
  removeTransformation,
  updateTransformationConfig,
  toggleTransformationHide,
} from './registry_utils';
import { OpenSearchSearchHit } from '../../../types/doc_views_types';
import { TRANSFORMATION_STATE_KEY } from '../types';

interface UrlTransformationState {
  definitionId: string; // defination identifier
  instanceId: string; // unique instance identifier
  config: any;
  hide: boolean;
}

export class TransformationService implements ITransformationService {
  // catelog of available transformations
  private definitions = new Map<string, TransformationDefinition>();

  // Active pipeline — list of transformation instances user choice
  public pipeline$ = new BehaviorSubject<TransformationPipeline>([]);

  // URL state manag for persistence
  private urlStateStorage?: IOsdUrlStateStorage;
  private urlSyncSubscription?: Subscription;

  /**
   * transformation catalog management
   */
  registerDefinition(definition: TransformationDefinition): void {
    this.definitions.set(definition.id, definition);
  }

  getDefinitions(): TransformationDefinition[] {
    return Array.from(this.definitions.values());
  }

  getDefinitionsByType(type: string): TransformationDefinition[] {
    return Array.from(this.definitions.values()).filter((d) => d.type === type);
  }

  getDefinition(id: string): TransformationDefinition | undefined {
    return this.definitions.get(id);
  }

  init() {
    this.consolePipe();
  }
  consolePipe() {
    this.pipeline$.subscribe((pipe) => {
      console.log('current pipe', pipe);
    });
  }

  /**
   * Pipeline instances management
   */

  // Pipeline observable that emits the current pipeline whenever it changes.
  getPipeline$(): Observable<TransformationPipeline> {
    return this.pipeline$.pipe(distinctUntilChanged((prev, curr) => isEqual(prev, curr)));
  }

  addInstance(id: string): void {
    const definition = this.definitions.get(id);
    if (!definition) {
      throw new Error(`TransformationService: unknown transformation id "${id}"`);
    }
    this.pipeline$.next(addTransformation(this.pipeline$.getValue(), definition.createInstance()));
  }

  addInstanceDirect(instance: TransformationInstance): void {
    this.pipeline$.next(addTransformation(this.pipeline$.getValue(), instance));
  }

  removeInstance(id: string): void {
    this.pipeline$.next(removeTransformation(this.pipeline$.getValue(), id));
  }

  updateInstanceConfig(id: string, newConfig: any): void {
    this.pipeline$.next(updateTransformationConfig(this.pipeline$.getValue(), id, newConfig));
  }

  toggleInstanceHide(id: string): void {
    this.pipeline$.next(toggleTransformationHide(this.pipeline$.getValue(), id));
  }

  setPipeline(instances: TransformationPipeline): void {
    this.pipeline$.next(instances);
  }

  clearPipeline(): void {
    this.pipeline$.next([]);
  }

  /**
   * Apply the current pipeline to a response hits
   * - Returns rawRows unchanged when pipeline is empty (identity).
   * - Returns [] when rawRows is null/undefined.
   * - Skips (and logs) any step whose transformationMethod throws.
   */
  applyPipeline(rawRows: OpenSearchSearchHit[]): any[] {
    if (!rawRows) return [];

    const registry = this.pipeline$.getValue();
    if (registry.length === 0) return rawRows;

    let rows = [...rawRows];
    for (const instance of registry) {
      if (instance.hide) continue;
      try {
        const result = instance.transformationMethod(rows, instance.config);
        if (result == null) {
          // eslint-disable-next-line no-console
          console.warn(
            `TransformationService: step "(${instance.instance_id}) returned null/undefined — skipping`
          );
          continue;
        }
        rows = result;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          `TransformationService: step "(${instance.instance_id}) threw — skipping`,
          err
        );
      }
    }
    return rows;
  }

  /**
   * Url storage sync
   * restore pipeline from URL and subscribe to changes
   */

  initUrlSync(urlStateStorage: IOsdUrlStateStorage): void {
    this.urlStateStorage = urlStateStorage;

    // 1. Restore pipeline from URL (if exists)
    this.restoreFromUrl();

    // 2. Subscribe to pipeline changes and persist to URL
    this.urlSyncSubscription = this.pipeline$
      .pipe(
        debounceTime(500),
        distinctUntilChanged((prev, curr) => isEqual(prev, curr))
      )
      .subscribe((pipeline) => {
        this.persistToUrl(pipeline);
      });
  }

  private restoreFromUrl(): void {
    if (!this.urlStateStorage) return;

    try {
      const states = this.urlStateStorage.get<UrlTransformationState[]>(TRANSFORMATION_STATE_KEY);
      if (!states || !Array.isArray(states)) return;

      const restoredPipeline: TransformationPipeline = [];

      for (const item of states) {
        const definition = this.definitions.get(item.definitionId);
        if (!definition) {
          // eslint-disable-next-line no-console
          console.warn(
            `TransformationService: definition "${item.instanceId}" not found, skipping from URL restore`
          );
          continue;
        }

        // Create fresh instance from definition
        const instance = definition.createInstance();
        // Override with stored values
        restoredPipeline.push({
          ...instance,
          instance_id: item.instanceId,
          config: item.config,
          hide: item.hide,
        });
      }

      if (restoredPipeline.length > 0) {
        console.log('restoredPipeline', restoredPipeline);
        this.pipeline$.next(restoredPipeline);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('TransformationService: failed to restore from URL', err);
    }
  }

  /**
   * Persist pipeline to URL state
   */
  private persistToUrl(pipeline: TransformationPipeline): void {
    if (!this.urlStateStorage) return;

    try {
      const states: UrlTransformationState[] = pipeline.map((instance) => {
        // Find which definition created this instance
        const definitionId = this.findDefinitionIdForInstance(instance);
        return {
          definitionId,
          instanceId: instance.instance_id,
          config: instance.config,
          hide: instance.hide,
        };
      });

      this.urlStateStorage.set(TRANSFORMATION_STATE_KEY, states, { replace: true });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('TransformationService: failed to persist to URL', err);
    }
  }

  private findDefinitionIdForInstance(instance: TransformationInstance): string {
    for (const [id, definition] of this.definitions.entries()) {
      if (definition.label === instance.label) {
        return id;
      }
    }
    // Fallback: use label as id
    return instance.label.toLowerCase().replace(/\s+/g, '_');
  }

  destroy(): void {
    if (this.urlSyncSubscription) {
      this.urlSyncSubscription.unsubscribe();
    }
    this.pipeline$.complete();
    this.definitions.clear();
  }
}

export const createNoOpTransformationService = (): ITransformationService => ({
  registerDefinition: () => {},
  getDefinitions: () => [],
  getDefinitionsByType: () => [],
  getDefinition: () => undefined,
  pipeline$: new BehaviorSubject<TransformationPipeline>([]),
  getPipeline$: () => new BehaviorSubject<TransformationPipeline>([]).asObservable(),
  addInstance: () => {},
  addInstanceDirect: () => {},
  removeInstance: () => {},
  updateInstanceConfig: () => {},
  toggleInstanceHide: () => {},
  setPipeline: () => {},
  clearPipeline: () => {},
  applyPipeline: (rawRows: any[]) => rawRows ?? [],
  initUrlSync: () => {},
  destroy: () => {},
});
