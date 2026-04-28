/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import uuid from 'uuid';
import { EuiButtonIcon, EuiFlexGroup, EuiFlexItem, EuiFormRow, EuiSelect } from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { get } from 'lodash';
import { TransformationInstance, TransformationDefinition, FieldSchema } from '../types';
import { FieldSelector } from '../field_selector';

type TargetType = 'string' | 'number' | 'boolean' | 'date';

interface ConvertRule {
  field: string | undefined;
  targetType: TargetType;
}

interface ConvertFieldTypeConfig {
  rules: ConvertRule[];
}

const isConfigComplete = (config: ConvertFieldTypeConfig): boolean =>
  (config.rules ?? []).some((r) => !!r.field);

const convertValue = (value: unknown, targetType: TargetType): unknown => {
  if (value == null) return value;
  switch (targetType) {
    case 'string':
      return String(value);
    case 'number': {
      const n = Number(value);
      return isNaN(n) ? null : n;
    }
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === '1' || value === 1) return true;
      if (value === 'false' || value === '0' || value === 0) return false;
      return null;
    case 'date':
      try {
        const d = new Date(value as string);
        return isNaN(d.getTime()) ? null : d.toISOString();
      } catch {
        return null;
      }
    default:
      return value;
  }
};

const TARGET_TYPE_OPTIONS: Array<{ value: TargetType; text: string }> = [
  {
    value: 'string',
    text: i18n.translate('explore.transformations.convertFieldType.string', {
      defaultMessage: 'String',
    }),
  },
  {
    value: 'number',
    text: i18n.translate('explore.transformations.convertFieldType.number', {
      defaultMessage: 'Number',
    }),
  },
  {
    value: 'boolean',
    text: i18n.translate('explore.transformations.convertFieldType.boolean', {
      defaultMessage: 'Boolean',
    }),
  },
  {
    value: 'date',
    text: i18n.translate('explore.transformations.convertFieldType.date', {
      defaultMessage: 'Date',
    }),
  },
];

const ConvertFieldTypeEditor = ({
  config,
  onChange,
  availableFields,
}: {
  config: ConvertFieldTypeConfig;
  onChange: (newConfig: ConvertFieldTypeConfig) => void;
  availableFields: FieldSchema[];
}) => {
  const rules: ConvertRule[] = config.rules ?? [];

  const update = useCallback(
    (newRules: ConvertRule[]) => onChange({ ...config, rules: newRules }),
    [config, onChange]
  );

  const updateRule = (index: number, patch: Partial<ConvertRule>) => {
    const updated = rules.map((r, i) => (i === index ? { ...r, ...patch } : r));
    update(updated);
  };

  const addRule = () => {
    update([...rules, { field: undefined, targetType: 'string' }]);
  };

  const removeRule = (index: number) => {
    update(rules.filter((_, i) => i !== index));
  };

  return (
    <EuiFlexGroup direction="column" gutterSize="s">
      {rules.map((rule, index) => (
        <EuiFlexItem key={index}>
          <EuiFlexGroup gutterSize="none" alignItems="center" justifyContent="flexStart">
            <EuiFlexItem>
              <FieldSelector
                configField={rule.field}
                availableFields={availableFields}
                updateConfigField={(fieldSchema) => updateRule(index, { field: fieldSchema?.name })}
                testSubjPrefix={`convertField${index}`}
              />
            </EuiFlexItem>

            <EuiFlexItem>As</EuiFlexItem>
            <EuiFlexItem>
              <EuiFormRow display="columnCompressed">
                <EuiSelect
                  compressed
                  options={TARGET_TYPE_OPTIONS}
                  value={rule.targetType}
                  onChange={(e) => updateRule(index, { targetType: e.target.value as TargetType })}
                  data-test-subj={`convertFieldTypeSelect${index}`}
                />
              </EuiFormRow>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiButtonIcon
                iconType="trash"
                color="danger"
                size="s"
                onClick={() => removeRule(index)}
                aria-label={i18n.translate('explore.transformations.convertFieldType.removeRule', {
                  defaultMessage: 'Remove rule',
                })}
                data-test-subj={`convertFieldRemoveRule${index}`}
              />
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiFlexItem>
      ))}
      <EuiFlexItem>
        <EuiButtonIcon
          iconType="plusInCircle"
          color="primary"
          size="s"
          onClick={addRule}
          aria-label={i18n.translate('explore.transformations.convertFieldType.addRule', {
            defaultMessage: 'Add conversion rule',
          })}
          data-test-subj="convertFieldAddRule"
        />
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};

export function createConvertFieldTypeTransformation(): TransformationInstance {
  return {
    instance_id: uuid.v4(),
    label: i18n.translate('explore.transformations.convertFieldType.label', {
      defaultMessage: 'Convert Field Type',
    }),
    config: { rules: [] } as ConvertFieldTypeConfig,
    hide: false,
    transformationMethod: (data: any[], config: any) => {
      const c = config as ConvertFieldTypeConfig;
      const rules = (c.rules ?? []).filter((r) => !!r.field);
      if (rules.length === 0) return data;

      return data.map((row) => {
        const source = { ...(row._source as Record<string, unknown>) };
        for (const rule of rules) {
          const raw = get(row, `_source.${rule.field}`);
          source[rule.field!] = convertValue(raw, rule.targetType);
        }
        return { ...row, _source: source };
      });
    },
    Editor: ConvertFieldTypeEditor,
  };
}

export const convertFieldTypeTransformationDefinition: TransformationDefinition = {
  id: 'convert_field_type',
  type: 'transform',
  label: i18n.translate('explore.transformations.convertFieldType.label', {
    defaultMessage: 'Convert Field Type',
  }),
  description: i18n.translate('explore.transformations.convertFieldType.description', {
    defaultMessage: 'Convert field values to a different type (string, number, boolean, date)',
  }),
  iconType: 'inputOutput',
  createInstance: createConvertFieldTypeTransformation,
};
