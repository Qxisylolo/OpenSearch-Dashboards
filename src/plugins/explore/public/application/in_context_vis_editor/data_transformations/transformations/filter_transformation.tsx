/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import uuid from 'uuid';
import { EuiFormRow, EuiSelect, EuiFieldText, EuiFlexGroup, EuiFlexItem } from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { get } from 'lodash';
import {
  TransformationInstance,
  TransformationDefinition,
  FieldSchema,
  dateOperatorOptions,
  FilterConfig,
  numericalOperatorOptions,
  allOperatorOptions,
} from '../types';
import { VisFieldType } from '../../../../components/visualizations/types';
import { FieldSelector } from '../field_selector';

const isConfigComplete = (config: FilterConfig): boolean => {
  return !!config.field && !!config.operator && config.value.trim() !== '';
};

const FilterEditor = ({
  config,
  onChange,
  availableFields,
}: {
  config: FilterConfig;
  onChange: (newConfig: FilterConfig) => void;
  availableFields: FieldSchema[];
}) => {
  // Find the selected field's type
  const selectedField = availableFields.find((field) => field.name === config.field);
  const fieldType = selectedField?.visFieldType;

  const updateConfig = useCallback(
    (newConfig: FilterConfig) => {
      onChange(newConfig);
    },
    [onChange]
  );

  const handleFieldChange = (fieldSchema: FieldSchema | undefined) => {
    const newConfig = { ...config, field: fieldSchema?.name || undefined };
    const newFieldType = fieldSchema?.visFieldType;

    const numericalOnlyOperators = [
      'greater_than',
      'less_than',
      'greater_than_or_equal_to',
      'less_than_or_equal_to',
    ];
    const dateOnlyOperators = [
      'is_earlier',
      'is_earlier_or_equal',
      'is_later',
      'is_later_or_equal',
    ];

    // Reset operator if switching field types and current operator is not valid for new type
    if (newFieldType === VisFieldType.Numerical) {
      // Switching to numerical - reset if current operator is date-only
      if (dateOnlyOperators.includes(newConfig.operator)) {
        newConfig.operator = 'equals';
      }
    } else if (newFieldType === VisFieldType.Date) {
      // Switching to date - reset if current operator is numerical-only
      if (numericalOnlyOperators.includes(newConfig.operator)) {
        newConfig.operator = 'equals';
      }
    } else {
      // Switching to categorical - reset if current operator is numerical-only or date-only
      if (
        numericalOnlyOperators.includes(newConfig.operator) ||
        dateOnlyOperators.includes(newConfig.operator)
      ) {
        newConfig.operator = 'equals';
      }
    }

    updateConfig(newConfig);
  };

  // Filter operators based on field type
  let operatorOptions = allOperatorOptions;
  if (fieldType === VisFieldType.Numerical) {
    operatorOptions = [...allOperatorOptions, ...numericalOperatorOptions];
  } else if (fieldType === VisFieldType.Date) {
    // For date fields: show all categorical operators + date-specific operators
    operatorOptions = [...allOperatorOptions, ...dateOperatorOptions];
  }

  return (
    <EuiFlexGroup direction="column" gutterSize="s">
      <EuiFlexItem>
        <FieldSelector
          configField={config.field}
          availableFields={availableFields}
          updateConfigField={handleFieldChange}
          testSubjPrefix="filter"
        />
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
              updateConfig({
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
              updateConfig({ ...config, value: e.target.value });
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

      // Return original data if config is incomplete
      if (!isConfigComplete({ field, operator, value })) {
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
          case 'greater_than_or_equal_to':
            if (typeof fieldValue === 'number') {
              const numValue = parseFloat(value);
              return !isNaN(numValue) && fieldValue >= numValue;
            }
            return fieldValueStr >= compareValue;
          case 'less_than':
            if (typeof fieldValue === 'number') {
              const numValue = parseFloat(value);
              return !isNaN(numValue) && fieldValue < numValue;
            }
            return fieldValueStr < compareValue;
          case 'less_than_or_equal_to':
            if (typeof fieldValue === 'number') {
              const numValue = parseFloat(value);
              return !isNaN(numValue) && fieldValue <= numValue;
            }
            return fieldValueStr <= compareValue;
          case 'is_earlier':
            // Date comparison - convert both to Date objects
            try {
              const fieldDate = new Date(fieldValue);
              const compareDate = new Date(value);
              return (
                !isNaN(fieldDate.getTime()) &&
                !isNaN(compareDate.getTime()) &&
                fieldDate < compareDate
              );
            } catch {
              return false;
            }
          case 'is_earlier_or_equal':
            try {
              const fieldDate = new Date(fieldValue);
              const compareDate = new Date(value);
              return (
                !isNaN(fieldDate.getTime()) &&
                !isNaN(compareDate.getTime()) &&
                fieldDate <= compareDate
              );
            } catch {
              return false;
            }
          case 'is_later':
            try {
              const fieldDate = new Date(fieldValue);
              const compareDate = new Date(value);
              return (
                !isNaN(fieldDate.getTime()) &&
                !isNaN(compareDate.getTime()) &&
                fieldDate > compareDate
              );
            } catch {
              return false;
            }
          case 'is_later_or_equal':
            try {
              const fieldDate = new Date(fieldValue);
              const compareDate = new Date(value);
              return (
                !isNaN(fieldDate.getTime()) &&
                !isNaN(compareDate.getTime()) &&
                fieldDate >= compareDate
              );
            } catch {
              return false;
            }
          default:
            return true;
        }
      });
    },
    resetConfig: (config: FilterConfig, availableFieldNames: Set<string>) => {
      const c = { ...config };
      if (c.field && !availableFieldNames.has(c.field)) {
        return { ...c, field: undefined, value: '' };
      }
      return c;
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
