/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import uuid from 'uuid';
import { EuiFormRow, EuiSelect, EuiFieldText, EuiFlexGroup, EuiFlexItem } from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { get } from 'lodash';
import { TransformationInstance, TransformationDefinition } from '../types';

interface FilterConfig {
  field: string | undefined;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'greater_than' | 'less_than';
  value: string;
}

const FilterEditor = ({
  config,
  onChange,
  availableFields,
}: {
  config: FilterConfig;
  onChange: (newConfig: FilterConfig) => void;
  availableFields: string[];
}) => {
  const fieldOptions = [
    {
      value: '',
      text: i18n.translate('explore.transformations.filter.selectFieldPlaceholder', {
        defaultMessage: '-- Select field --',
      }),
    },
    ...availableFields.map((field) => ({ value: field, text: field })),
  ];

  const operatorOptions = [
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
    {
      value: 'greater_than',
      text: i18n.translate('explore.transformations.filter.greaterThan', {
        defaultMessage: 'Greater than',
      }),
    },
    {
      value: 'less_than',
      text: i18n.translate('explore.transformations.filter.lessThan', {
        defaultMessage: 'Less than',
      }),
    },
  ];

  return (
    <EuiFlexGroup direction="column" gutterSize="s">
      <EuiFlexItem>
        <EuiFormRow
          label={i18n.translate('explore.transformations.filter.fieldLabel', {
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
            data-test-subj="filterFieldSelect"
          />
        </EuiFormRow>
      </EuiFlexItem>
      <EuiFlexItem>
        <EuiFormRow
          label={i18n.translate('explore.transformations.filter.operatorLabel', {
            defaultMessage: 'Operator',
          })}
          display="columnCompressed"
        >
          <EuiSelect
            compressed
            options={operatorOptions}
            value={config.operator}
            onChange={(e) => {
              onChange({
                ...config,
                operator: e.target.value as FilterConfig['operator'],
              });
            }}
            data-test-subj="filterOperatorSelect"
          />
        </EuiFormRow>
      </EuiFlexItem>
      <EuiFlexItem>
        <EuiFormRow
          label={i18n.translate('explore.transformations.filter.valueLabel', {
            defaultMessage: 'Value',
          })}
          display="columnCompressed"
        >
          <EuiFieldText
            compressed
            value={config.value}
            onChange={(e) => {
              onChange({ ...config, value: e.target.value });
            }}
            placeholder={i18n.translate('explore.transformations.filter.valuePlaceholder', {
              defaultMessage: 'Enter value...',
            })}
            data-test-subj="filterValueInput"
          />
        </EuiFormRow>
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};

export function createFilterTransformation(): TransformationInstance {
  return {
    instance_id: uuid.v4(),
    label: i18n.translate('explore.transformations.filter.label', { defaultMessage: 'Filter' }),
    config: {
      field: undefined,
      operator: 'equals',
      value: '',
    } as FilterConfig,
    hide: false,
    transformationMethod: (data: any[], config: any) => {
      const { field, operator, value } = config as FilterConfig;

      // Return original data if field is not selected
      if (!field) {
        return data;
      }

      return data.filter((row) => {
        // Extract value from OpenSearch hit structure (_source.field)
        const fieldValue = get(row, `_source.${field}`);

        // Handle null/undefined field values
        if (fieldValue == null) {
          return false;
        }

        const fieldValueStr = String(fieldValue).toLowerCase();
        const compareValue = value.toLowerCase();

        switch (operator) {
          case 'equals':
            return fieldValueStr === compareValue;
          case 'not_equals':
            return fieldValueStr !== compareValue;
          case 'contains':
            return fieldValueStr.includes(compareValue);
          case 'not_contains':
            return !fieldValueStr.includes(compareValue);
          case 'greater_than':
            // Try numeric comparison first, fall back to string comparison
            if (typeof fieldValue === 'number') {
              const numValue = parseFloat(value);
              return !isNaN(numValue) && fieldValue > numValue;
            }
            return fieldValueStr > compareValue;
          case 'less_than':
            // Try numeric comparison first, fall back to string comparison
            if (typeof fieldValue === 'number') {
              const numValue = parseFloat(value);
              return !isNaN(numValue) && fieldValue < numValue;
            }
            return fieldValueStr < compareValue;
          default:
            return true;
        }
      });
    },
    Editor: FilterEditor,
  };
}

export const filterTransformationDefinition: TransformationDefinition = {
  id: 'filter',
  type: 'filter',
  label: i18n.translate('explore.transformations.filter.label', { defaultMessage: 'Filter' }),
  description: i18n.translate('explore.transformations.filter.description', {
    defaultMessage: 'Filter rows by field value using various comparison operators',
  }),
  iconType: 'filter',
  createInstance: createFilterTransformation,
};
