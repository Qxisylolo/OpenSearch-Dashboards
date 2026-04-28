/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import uuid from 'uuid';
import { EuiFormRow, EuiButtonGroup, EuiFlexGroup, EuiFlexItem } from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { get } from 'lodash';
import { TransformationInstance, TransformationDefinition, FieldSchema } from '../types';
import { FieldSelector } from '../field_selector';

interface SortByConfig {
  field: string | undefined;
  order: 'asc' | 'desc';
}

const SortByEditor = ({
  config,
  onChange,
  availableFields,
}: {
  config: SortByConfig;
  onChange: (newConfig: SortByConfig) => void;
  availableFields: FieldSchema[];
}) => {
  const handleFieldChange = (fieldSchema: FieldSchema | undefined) => {
    onChange({ ...config, field: fieldSchema?.name || undefined });
  };

  useEffect(() => {
    if (availableFields.length === 0) return;
    if (config.field && !availableFields.find((f) => f.name === config.field)) {
      onChange({ ...config, field: undefined });
    }
  });

  const orderOptions = [
    {
      id: 'asc',
      label: i18n.translate('explore.transformations.sortBy.ascending', {
        defaultMessage: 'Ascending',
      }),
    },
    {
      id: 'desc',
      label: i18n.translate('explore.transformations.sortBy.descending', {
        defaultMessage: 'Descending',
      }),
    },
  ];

  return (
    <EuiFlexGroup direction="column" gutterSize="s">
      <EuiFlexItem>
        <FieldSelector
          configField={config.field}
          availableFields={availableFields}
          updateConfigField={handleFieldChange}
          testSubjPrefix="sortBy"
        />
      </EuiFlexItem>
      <EuiFlexItem>
        <EuiFormRow
          label={i18n.translate('explore.transformations.sortBy.orderLabel', {
            defaultMessage: 'Order',
          })}
          display="columnCompressed"
        >
          <EuiButtonGroup
            legend={i18n.translate('explore.transformations.sortBy.orderLegend', {
              defaultMessage: 'Sort order',
            })}
            options={orderOptions}
            idSelected={config.order}
            onChange={(id) => {
              onChange({ ...config, order: id as 'asc' | 'desc' });
            }}
            buttonSize="compressed"
            isFullWidth
            data-test-subj="sortByOrderButtonGroup"
          />
        </EuiFormRow>
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};

export function createSortByTransformation(): TransformationInstance {
  return {
    instance_id: uuid.v4(),
    label: i18n.translate('explore.transformations.sortBy.label', { defaultMessage: 'Sort By' }),
    config: {
      field: undefined,
      order: 'asc',
    } as SortByConfig,
    hide: false,
    transformationMethod: (data: any[], config: any) => {
      const { field, order } = config as SortByConfig;

      if (!field) {
        return data;
      }

      const sorted = [...data];

      sorted.sort((a, b) => {
        // extract values from OpenSearch hit (_source.field)
        const valueA = get(a, `_source.${field}`);
        const valueB = get(b, `_source.${field}`);

        // Handle null/undefined values - push to end
        if (valueA == null && valueB == null) return 0;
        if (valueA == null) return 1;
        if (valueB == null) return -1;

        // Compare values
        let comparison = 0;
        if (typeof valueA === 'string' && typeof valueB === 'string') {
          comparison = valueA.localeCompare(valueB);
        } else if (typeof valueA === 'number' && typeof valueB === 'number') {
          comparison = valueA - valueB;
        } else {
          // Fallback: convert to string and compare
          comparison = String(valueA).localeCompare(String(valueB));
        }

        return order === 'asc' ? comparison : -comparison;
      });

      return sorted;
    },
    resetConfig: (config: SortByConfig, availableFieldNames: Set<string>) => {
      const c = { ...config };
      if (c.field && !availableFieldNames.has(c.field)) {
        return { ...c, field: undefined, value: '' };
      }
      return c;
    },
    Editor: SortByEditor,
  };
}

export const sortByTransformationDefinition: TransformationDefinition = {
  id: 'sort_by',
  type: 'sort',
  label: i18n.translate('explore.transformations.sortBy.label', { defaultMessage: 'Sort By' }),
  description: i18n.translate('explore.transformations.sortBy.description', {
    defaultMessage: 'Sort rows by a field in ascending or descending order',
  }),
  iconType: 'sortable',
  createInstance: createSortByTransformation,
};
