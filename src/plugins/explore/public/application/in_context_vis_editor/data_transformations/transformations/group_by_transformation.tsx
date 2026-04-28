/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef } from 'react';
import uuid from 'uuid';
import { EuiButtonIcon, EuiFlexGroup, EuiFlexItem, EuiSelect, EuiText } from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { get } from 'lodash';
import { TransformationInstance, TransformationDefinition, FieldSchema } from '../types';
import { FieldSelector } from '../field_selector';
import { VisFieldType } from '../../../../components/visualizations/types';

type AggMethod = 'max' | 'min' | 'sum' | 'mean' | 'count' | 'first' | 'last' | 'unique_count';

interface AggRule {
  field: string;
  method: AggMethod;
}

interface GroupByConfig {
  groupByField: string | undefined;
  aggregations: AggRule[];
}

const NUMERICAL_METHODS: AggMethod[] = ['max', 'min', 'sum', 'mean', 'count', 'first', 'last'];
const STRING_METHODS: AggMethod[] = ['count', 'first', 'last', 'unique_count'];
const DATE_METHODS: AggMethod[] = ['max', 'min', 'count', 'first', 'last'];

const METHOD_LABELS: Record<AggMethod, string> = {
  max: i18n.translate('explore.transformations.groupBy.max', { defaultMessage: 'Max' }),
  min: i18n.translate('explore.transformations.groupBy.min', { defaultMessage: 'Min' }),
  sum: i18n.translate('explore.transformations.groupBy.sum', { defaultMessage: 'Sum' }),
  mean: i18n.translate('explore.transformations.groupBy.mean', { defaultMessage: 'Mean' }),
  count: i18n.translate('explore.transformations.groupBy.count', { defaultMessage: 'Count' }),
  first: i18n.translate('explore.transformations.groupBy.first', { defaultMessage: 'First' }),
  last: i18n.translate('explore.transformations.groupBy.last', { defaultMessage: 'Last' }),
  unique_count: i18n.translate('explore.transformations.groupBy.uniqueCount', {
    defaultMessage: 'Unique count',
  }),
};

const getMethodsForField = (field: FieldSchema): AggMethod[] => {
  switch (field.visFieldType) {
    case VisFieldType.Numerical:
      return NUMERICAL_METHODS;
    case VisFieldType.Date:
      return DATE_METHODS;
    default:
      return STRING_METHODS;
  }
};

const defaultMethodForField = (field: FieldSchema): AggMethod => {
  switch (field.visFieldType) {
    case VisFieldType.Numerical:
      return 'sum';
    case VisFieldType.Date:
      return 'first';
    default:
      return 'count';
  }
};

const applyAgg = (values: unknown[], method: AggMethod): unknown => {
  if (method === 'count') return values.length;
  if (method === 'unique_count') return new Set(values.map(String)).size;
  if (method === 'first') return values[0] ?? null;
  if (method === 'last') return values[values.length - 1] ?? null;

  const nums = values.map(Number).filter((v) => !isNaN(v));
  if (nums.length === 0) return null;
  switch (method) {
    case 'max':
      return Math.max(...nums);
    case 'min':
      return Math.min(...nums);
    case 'sum':
      return nums.reduce((a, b) => a + b, 0);
    case 'mean':
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    default:
      return null;
  }
};

const GroupByEditor = ({
  config,
  onChange,
  availableFields,
}: {
  config: GroupByConfig;
  onChange: (newConfig: GroupByConfig) => void;
  availableFields: FieldSchema[];
}) => {
  const update = useCallback((patch: Partial<GroupByConfig>) => onChange({ ...config, ...patch }), [
    config,
    onChange,
  ]);

  // Track fields manually removed by the user — don't re-add them on availableFields change
  const manuallyRemovedRef = useRef<Set<string>>(new Set());

  // Auto-populate aggregations when availableFields changes:
  // add rows for new fields, remove rows for gone fields, keep existing methods
  useEffect(() => {
    if (availableFields.length === 0) return;
    const existingMap = new Map((config.aggregations ?? []).map((r) => [r.field, r.method]));
    const newAggs: AggRule[] = availableFields
      .filter((f) => f.name !== config.groupByField && !manuallyRemovedRef.current.has(f.name))
      .map((f) => ({
        field: f.name,
        method: existingMap.get(f.name) ?? defaultMethodForField(f),
      }));

    const changed =
      newAggs.length !== (config.aggregations ?? []).length ||
      newAggs.some((r, i) => {
        const old = (config.aggregations ?? [])[i];
        return !old || old.field !== r.field || old.method !== r.method;
      });

    if (changed) update({ aggregations: newAggs });
  }, [availableFields, config.groupByField]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateRule = (index: number, method: AggMethod) => {
    const updated = (config.aggregations ?? []).map((r, i) => (i === index ? { ...r, method } : r));
    update({ aggregations: updated });
  };

  const removeRule = (index: number) => {
    const rule = (config.aggregations ?? [])[index];
    if (rule) manuallyRemovedRef.current.add(rule.field);
    update({ aggregations: (config.aggregations ?? []).filter((_, i) => i !== index) });
  };

  const fieldMap = new Map(availableFields.map((f) => [f.name, f]));

  return (
    <EuiFlexGroup direction="column" gutterSize="s">
      {/* Group by field */}
      <EuiFlexItem>
        <FieldSelector
          configField={config.groupByField}
          availableFields={availableFields}
          updateConfigField={(f) => update({ groupByField: f?.name })}
          testSubjPrefix="groupByField"
        />
      </EuiFlexItem>

      {config.groupByField &&
        (config.aggregations ?? []).map((rule, index) => {
          const fieldSchema = fieldMap.get(rule.field);
          if (!fieldSchema) return null;
          const methodOptions = getMethodsForField(fieldSchema).map((m) => ({
            value: m,
            text: METHOD_LABELS[m],
          }));

          return (
            <EuiFlexItem key={rule.field}>
              <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
                <EuiFlexItem style={{ minWidth: 120, maxWidth: 120 }}>
                  <EuiText
                    size="s"
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={rule.field}
                  >
                    {rule.field}
                  </EuiText>
                </EuiFlexItem>
                <EuiFlexItem>
                  <EuiSelect
                    compressed
                    options={methodOptions}
                    value={rule.method}
                    onChange={(e) => updateRule(index, e.target.value as AggMethod)}
                    data-test-subj={`groupByMethod${index}`}
                  />
                </EuiFlexItem>
                <EuiFlexItem grow={false}>
                  <EuiButtonIcon
                    iconType="trash"
                    color="danger"
                    size="s"
                    onClick={() => removeRule(index)}
                    aria-label={i18n.translate('explore.transformations.groupBy.removeRule', {
                      defaultMessage: 'Remove field',
                    })}
                    data-test-subj={`groupByRemoveRule${index}`}
                  />
                </EuiFlexItem>
              </EuiFlexGroup>
            </EuiFlexItem>
          );
        })}
    </EuiFlexGroup>
  );
};

export function createGroupByTransformation(): TransformationInstance {
  return {
    instance_id: uuid.v4(),
    label: i18n.translate('explore.transformations.groupBy.label', {
      defaultMessage: 'Group By',
    }),
    config: {
      groupByField: undefined,
      aggregations: [],
    } as GroupByConfig,
    hide: false,
    transformationMethod: (data: any[], config: any) => {
      const c = config as GroupByConfig;
      if (!c.groupByField || (c.aggregations ?? []).length === 0) return data;

      // Group rows by the groupByField value
      const groups = new Map<string, any[]>();
      for (const row of data) {
        const key = String(get(row, `_source.${c.groupByField}`) ?? '');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(row);
      }

      // Build one output row per group
      return Array.from(groups.entries()).map(([groupKey, rows]) => {
        const source: Record<string, unknown> = {
          [c.groupByField!]: groupKey,
        };

        for (const rule of c.aggregations) {
          const values = rows.map((row) => get(row, `_source.${rule.field}`));
          source[`${rule.method}_${rule.field}`] = applyAgg(values, rule.method);
        }

        return { _source: source };
      });
    },
    resetConfig: (config: GroupByConfig, availableFieldNames: Set<string>) => {
      const c = { ...config };
      return {
        ...c,
        groupByField:
          c.groupByField && availableFieldNames.has(c.groupByField) ? c.groupByField : undefined,
        aggregations: (c.aggregations ?? []).filter((r) => availableFieldNames.has(r.field)),
      };
    },
    Editor: GroupByEditor,
  };
}

export const groupByTransformationDefinition: TransformationDefinition = {
  id: 'group_by',
  type: 'aggregate',
  label: i18n.translate('explore.transformations.groupBy.label', {
    defaultMessage: 'Group By',
  }),
  description: i18n.translate('explore.transformations.groupBy.description', {
    defaultMessage: 'Group rows by a field value and aggregate other fields per group',
  }),
  iconType: 'aggregate',
  createInstance: createGroupByTransformation,
};
