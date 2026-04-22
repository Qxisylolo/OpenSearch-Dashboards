/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { IOsdUrlStateStorage } from '../../../../../opensearch_dashboards_utils/public';

export interface TransformationInstance {
  // Unique runtime UUID — allows multiple instances of the same definition in the pipeline
  instance_id: string;
  //  Display label copied from the definition (e.g. 'Limit') — shown on the card header */
  label: string;
  // User settings (e.g. { limit: 5 })
  config: any;
  // if skip transformation during pipeline execution
  hide: boolean;
  // Core transformation method
  transformationMethod: (data: any[], config: any) => any[];
  // Config editor rendered inside TransformPanel
  Editor: React.ComponentType<{
    config: any;
    onChange: (newConfig: any) => void;
    availableFields: string[];
  }>;
}

export type TransformationPipeline = TransformationInstance[];

export interface TransformationDefinition {
  // name of this transformation
  id: string;
  // sub-group (e.g. 'filter', 'format', 'aggregate')
  type: string;
  label: string;
  description: string;
  iconType: string;
  createInstance: () => TransformationInstance;
}

export interface ITransformationService {
  // Catalog of definition registry
  registerDefinition(definition: TransformationDefinition): void;
  getDefinitions(): TransformationDefinition[];
  getDefinitionsByType(type: string): TransformationDefinition[];
  getDefinition(id: string): TransformationDefinition | undefined;

  //  Pipeline instance management --
  readonly pipeline$: BehaviorSubject<TransformationPipeline>;
  getPipeline$(): Observable<TransformationPipeline>;
  addInstance(id: string): void;
  addInstanceDirect(instance: TransformationInstance): void;
  removeInstance(id: string): void;
  updateInstanceConfig(id: string, newConfig: Record<string, any>): void;
  toggleInstanceHide(id: string): void;
  setPipeline(instances: TransformationPipeline): void;
  clearPipeline(): void;

  // execution
  applyPipeline(rawRows: any[]): any[];

  // URL persistence
  initUrlSync(urlStateStorage: IOsdUrlStateStorage): void;

  destroy(): void;
}
