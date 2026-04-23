/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import uuid from 'uuid';
import { EuiFormRow, EuiSelect, EuiFlexGroup, EuiFlexItem } from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { get } from 'lodash';
import { TransformationInstance, TransformationDefinition } from '../types';

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
  availableFields: string[];
}) => {
  const fieldOptions = [
    {
      value: '',
      text: i18n.translate('explore.transformations.sortBy.selectFieldPlaceholder', {
        defaultMessage: '-- Select field --',
      }),
    },
    ...availableFields.map((field) => ({ value: field, text: field })),
  ];

  const orderOptions = [
    {
      value: 'asc',
      text: i18n.translate('explore.transformations.sortBy.ascending', {
        defaultMessage: 'Ascending',
      }),
    },
    {
      value: 'desc',
      text: i18n.translate('explore.transformations.sortBy.descending', {
        defaultMessage: 'Descending',
      }),
    },
  ];

  return (
    <EuiFlexGroup direction="column" gutterSize="s">
      <EuiFlexItem>
        <EuiFormRow
          label={i18n.translate('explore.transformations.sortBy.fieldLabel', {
            defaultMessage: 'Field',
          })}
          display="columnCompressed"
        >
          <EuiSelect
            compressed
            options={fieldOptions}
            value={config.field || ''}
            onChange={(e) => {
              onChange({ ...config, field: e.target.value || undefined });
            }}
            data-test-subj="sortByFieldSelect"
          />
        </EuiFormRow>
      </EuiFlexItem>
      <EuiFlexItem>
        <EuiFormRow
          label={i18n.translate('explore.transformations.sortBy.orderLabel', {
            defaultMessage: 'Order',
          })}
          display="columnCompressed"
        >
          <EuiSelect
            compressed
            options={orderOptions}
            value={config.order}
            onChange={(e) => {
              onChange({ ...config, order: e.target.value as 'asc' | 'desc' });
            }}
            data-test-subj="sortByOrderSelect"
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

      // Return original data if no field is selected
      if (!field) {
        return data;
      }

      // Create a copy to avoid mutating original array
      const sorted = [...data];

      sorted.sort((a, b) => {
        // Extract values from OpenSearch hit structure (_source.field)
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

        // Apply order direction
        return order === 'asc' ? comparison : -comparison;
      });

      return sorted;
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
