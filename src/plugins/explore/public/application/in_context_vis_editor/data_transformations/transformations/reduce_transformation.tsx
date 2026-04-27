/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import uuid from 'uuid';
import { EuiCheckboxGroup, EuiFlexGroup, EuiFlexItem, EuiFormRow } from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { get } from 'lodash';
import { TransformationInstance, TransformationDefinition, FieldSchema } from '../types';
import { FieldSelector } from '../field_selector';
import { VisFieldType } from '../../../../components/visualizations/types';

// ─── Types ───────────────────────────────────────────────────────────────────

type AggMethod = 'max' | 'min' | 'sum' | 'mean' | 'count';

interface ReduceConfig {
  fields: FieldSchema[];
  methods: AggMethod[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const isConfigComplete = (config: ReduceConfig): boolean =>
  (config.fields ?? []).length > 0 && (config.methods ?? []).length > 0;

const AGG_METHOD_OPTIONS: Array<{ id: AggMethod; label: string }> = [
  {
    id: 'max',
    label: i18n.translate('explore.transformations.reduce.max', { defaultMessage: 'Max' }),
  },
  {
    id: 'min',
    label: i18n.translate('explore.transformations.reduce.min', { defaultMessage: 'Min' }),
  },
  {
    id: 'sum',
    label: i18n.translate('explore.transformations.reduce.sum', { defaultMessage: 'Sum' }),
  },
  {
    id: 'mean',
    label: i18n.translate('explore.transformations.reduce.mean', { defaultMessage: 'Mean' }),
  },
  {
    id: 'count',
    label: i18n.translate('explore.transformations.reduce.count', { defaultMessage: 'Count' }),
  },
];

const computeAgg = (values: number[], method: AggMethod): number | null => {
  if (method === 'count') return values.length;
  if (values.length === 0) return null;
  switch (method) {
    case 'max':
      return Math.max(...values);
    case 'min':
      return Math.min(...values);
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'mean':
      return values.reduce((a, b) => a + b, 0) / values.length;
    default:
      return null;
  }
};

// ─── Editor ──────────────────────────────────────────────────────────────────

const ReduceEditor = ({
  config,
  onChange,
  availableFields,
}: {
  config: ReduceConfig;
  onChange: (newConfig: ReduceConfig) => void;
  availableFields: FieldSchema[];
}) => {
  const update = useCallback((patch: Partial<ReduceConfig>) => onChange({ ...config, ...patch }), [
    config,
    onChange,
  ]);

  const numericalFields = availableFields.filter((f) => f.visFieldType === VisFieldType.Numerical);

  const selectedMethods = Object.fromEntries((config.methods ?? []).map((m) => [m, true]));

  return (
    <EuiFlexGroup direction="column" gutterSize="s">
      <EuiFlexItem>
        <FieldSelector
          configFields={(config.fields ?? []).map((f) => f.name)}
          availableFields={numericalFields}
          updateConfigFields={(fields) => update({ fields })}
          supportMulti
          testSubjPrefix="reduceFields"
        />
      </EuiFlexItem>
      <EuiFlexItem>
        <EuiFormRow
          label={i18n.translate('explore.transformations.reduce.methodsLabel', {
            defaultMessage: 'Methods',
          })}
          display="columnCompressed"
        >
          <EuiCheckboxGroup
            options={AGG_METHOD_OPTIONS}
            idToSelectedMap={selectedMethods}
            onChange={(id) => {
              const method = id as AggMethod;
              const current = config.methods ?? [];
              const updated = current.includes(method)
                ? current.filter((m) => m !== method)
                : [...current, method];
              update({ methods: updated });
            }}
            compressed
            data-test-subj="reduceMethodsCheckboxGroup"
          />
        </EuiFormRow>
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createReduceTransformation(): TransformationInstance {
  return {
    instance_id: uuid.v4(),
    label: i18n.translate('explore.transformations.reduce.label', {
      defaultMessage: 'Reduce',
    }),
    config: {
      fields: [],
      methods: ['max', 'min'],
    } as ReduceConfig,
    hide: false,
    transformationMethod: (data: any[], config: any) => {
      const c = config as ReduceConfig;
      if (!isConfigComplete(c)) return data;

      const fields = c.fields ?? [];
      const methods = c.methods ?? [];

      // Collect numeric values per field across all rows
      const valuesByField: Record<string, number[]> = {};
      for (const field of fields) {
        valuesByField[field.name] = data
          .map((row) => Number(get(row, `_source.${field.name}`)))
          .filter((v) => !isNaN(v));
      }

      // Build single aggregated row: { max_bytes: 200, min_bytes: 100, ... }
      const aggregated: Record<string, number | null> = {};
      for (const method of methods) {
        for (const field of fields) {
          aggregated[`${method}_${field.name}`] = computeAgg(valuesByField[field.name], method);
        }
      }

      return [{ _source: aggregated }];
    },
    resetConfig: (config: any, availableFieldNames: Set<string>) => {
      const c = config as ReduceConfig;
      return {
        ...c,
        fields: (c.fields ?? []).filter((f) => availableFieldNames.has(f.name)),
      };
    },
    Editor: ReduceEditor,
  };
}

export const reduceTransformationDefinition: TransformationDefinition = {
  id: 'reduce',
  type: 'aggregate',
  label: i18n.translate('explore.transformations.reduce.label', {
    defaultMessage: 'Reduce',
  }),
  description: i18n.translate('explore.transformations.reduce.description', {
    defaultMessage:
      'Aggregate all rows into a single row using max, min, sum, mean, or count per field',
  }),
  iconType: 'aggregate',
  createInstance: createReduceTransformation,
};
