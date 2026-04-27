/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { i18n } from '@osd/i18n';
import React from 'react';
import { BehaviorSubject, Observable } from 'rxjs';
import { IOsdUrlStateStorage } from '../../../../../opensearch_dashboards_utils/public';
import { VisFieldType } from '../../../components/visualizations/types';

export interface FieldSchema {
  name: string;
  visFieldType: VisFieldType;
}

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
    availableFields: FieldSchema[];
  }>;
  /**
   * Optional: called after reorder to clear any field references that are no
   * longer available at the new pipeline position.
   * Returns a sanitized copy of the config.
   */
  resetConfig?: (config: any, availableFieldNames: Set<string>) => any;
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
  applyPipeline(
    rawRows: any[],
    originalSchema?: Array<{ name?: string; type?: string }>
  ): { rows: any[]; stageSchemas: Array<Array<{ name?: string; type?: string }>> };

  // URL persistence
  initUrlSync(urlStateStorage: IOsdUrlStateStorage): void;

  destroy(): void;
}

export interface FilterConfig {
  field: string | undefined;
  operator:
    | 'equals'
    | 'not_equals'
    | 'contains'
    | 'not_contains'
    | 'greater_than'
    | 'less_than'
    | 'greater_than_or_equal_to'
    | 'less_than_or_equal_to'
    | 'is_earlier'
    | 'is_earlier_or_equal'
    | 'is_later'
    | 'is_later_or_equal';
  value: string;
}

// All operators available for all field types
export const allOperatorOptions = [
  {
    value: 'equals',
    text: i18n.translate('explore.transformations.filter.equals', {
      defaultMessage: 'Equals',
    }),
  },
  {
    value: 'not_equals',
    text: i18n.translate('explore.transformations.filter.notEquals', {
      defaultMessage: 'Not equals',
    }),
  },
  {
    value: 'contains',
    text: i18n.translate('explore.transformations.filter.contains', {
      defaultMessage: 'Contains',
    }),
  },
  {
    value: 'not_contains',
    text: i18n.translate('explore.transformations.filter.notContains', {
      defaultMessage: 'Not contains',
    }),
  },
];

// Additional operators only for numerical fields
export const numericalOperatorOptions = [
  {
    value: 'greater_than',
    text: i18n.translate('explore.transformations.filter.greaterThan', {
      defaultMessage: 'Is greater than',
    }),
  },
  {
    value: 'greater_than_or_equal_to',
    text: i18n.translate('explore.transformations.filter.greaterThanOrEqualTo', {
      defaultMessage: 'Is greater or equal',
    }),
  },
  {
    value: 'less_than',
    text: i18n.translate('explore.transformations.filter.lowerThan', {
      defaultMessage: 'Is lower',
    }),
  },
  {
    value: 'less_than_or_equal_to',
    text: i18n.translate('explore.transformations.filter.lowerThanOrEqualTo', {
      defaultMessage: 'Is lower or equal',
    }),
  },
];

// Additional operators only for date fields
export const dateOperatorOptions = [
  {
    value: 'is_earlier',
    text: i18n.translate('explore.transformations.filter.isEarlier', {
      defaultMessage: 'Is earlier',
    }),
  },
  {
    value: 'is_earlier_or_equal',
    text: i18n.translate('explore.transformations.filter.isEarlierOrEqual', {
      defaultMessage: 'Is earlier or equal',
    }),
  },
  {
    value: 'is_later',
    text: i18n.translate('explore.transformations.filter.isLater', {
      defaultMessage: 'Is later',
    }),
  },
  {
    value: 'is_later_or_equal',
    text: i18n.translate('explore.transformations.filter.isLaterOrEqual', {
      defaultMessage: 'Is later or equal',
    }),
  },
];
