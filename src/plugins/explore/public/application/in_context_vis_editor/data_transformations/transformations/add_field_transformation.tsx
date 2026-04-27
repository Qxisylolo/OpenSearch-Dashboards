/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import uuid from 'uuid';
import {
  EuiFormRow,
  EuiFieldText,
  EuiFlexGroup,
  EuiFlexItem,
  EuiSelect,
  EuiButtonIcon,
  EuiButtonGroup,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { get } from 'lodash';
import { TransformationInstance, TransformationDefinition, FieldSchema } from '../types';
import { FieldSelector } from '../field_selector';
import { VisFieldType } from '../../../../components/visualizations/types';

type Mode = 'binary' | 'unary' | 'cumulative';
type BinaryOperator = '+' | '-' | '*' | '/';
type UnaryOperator = 'abs' | 'ceil' | 'floor' | 'round';
type CumulativeOperator = 'total' | 'mean';

const CUSTOM_VALUE_KEY = '__CUSTOM__';

interface AddFieldConfig {
  mode: Mode;
  // binary
  field1: string | undefined;
  field1CustomValue: string;
  binaryOperator: BinaryOperator;
  field2: string | undefined;
  field2CustomValue: string;
  // unary
  unaryOperator: UnaryOperator;
  unaryField: string | undefined;
  // cumulative
  cumulativeOperator: CumulativeOperator;
  cumulativeFields: FieldSchema[];

  alias: string;
  replaceAllFields?: boolean;
}

const isConfigComplete = (config: AddFieldConfig): boolean => {
  if (config.mode === 'binary') {
    const v1ok =
      !!config.field1 && (config.field1 !== CUSTOM_VALUE_KEY || !!config.field1CustomValue);
    const v2ok =
      !!config.field2 && (config.field2 !== CUSTOM_VALUE_KEY || !!config.field2CustomValue);
    return v1ok && v2ok;
  }
  if (config.mode === 'cumulative') {
    return (config.cumulativeFields ?? []).length > 0;
  }
  return !!config.unaryField;
};

const applyBinary = (v1: number, op: BinaryOperator, v2: number): number | null => {
  switch (op) {
    case '+':
      return v1 + v2;
    case '-':
      return v1 - v2;
    case '*':
      return v1 * v2;
    case '/':
      return v2 !== 0 ? v1 / v2 : null;
    default:
      return null;
  }
};

const applyUnary = (v: number, op: UnaryOperator): number | null => {
  switch (op) {
    case 'abs':
      return Math.abs(v);
    case 'ceil':
      return Math.ceil(v);
    case 'floor':
      return Math.floor(v);
    case 'round':
      return Math.round(v);
    default:
      return null;
  }
};

const OPERATOR_WORDS: Record<BinaryOperator, string> = {
  '+': 'plus',
  '-': 'minus',
  '*': 'times',
  '/': 'div',
};

const fieldLabel = (field: string | undefined, custom: string) =>
  field === CUSTOM_VALUE_KEY ? custom : field;

export const generateAlias = (c: Partial<AddFieldConfig>): string => {
  if (c.mode === 'unary') {
    return c.unaryField ? `${c.unaryOperator || 'abs'}(${c.unaryField})` : '';
  }
  if (c.mode === 'cumulative') {
    const fields = (c.cumulativeFields ?? []).map((f) => f.name).join(', ');
    return fields ? `${c.cumulativeOperator || 'total'}(${fields})` : '';
  }
  const f1 = fieldLabel(c.field1, c.field1CustomValue || '');
  const f2 = fieldLabel(c.field2, c.field2CustomValue || '');
  const op = OPERATOR_WORDS[c.binaryOperator || '+'];
  return f1 && f2 ? `${f1}_${op}_${f2}` : '';
};

const FieldPicker = ({
  value,
  customValue,
  availableFields,
  onFieldChange,
  onCustomValueChange,
}: {
  value: string | undefined;
  customValue: string;
  availableFields: FieldSchema[];
  onFieldChange: (field: string | undefined) => void;
  onCustomValueChange: (v: string) => void;
}) => {
  const isCustom = value === CUSTOM_VALUE_KEY;

  const handleFieldSelect = (fieldSchema: FieldSchema | undefined) => {
    onFieldChange(fieldSchema?.name);
  };

  if (isCustom) {
    return (
      <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false}>
        <EuiFlexItem>
          <EuiFieldText
            compressed
            value={customValue}
            onChange={(e) => onCustomValueChange(e.target.value)}
            placeholder={i18n.translate('explore.transformations.addField.enterValuePlaceholder', {
              defaultMessage: 'Enter value',
            })}
          />
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiButtonIcon
            iconType="list"
            size="s"
            color="text"
            onClick={() => onFieldChange(undefined)}
          />
        </EuiFlexItem>
      </EuiFlexGroup>
    );
  }

  return (
    <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false}>
      <EuiFlexItem>
        <FieldSelector
          showLabel={false}
          configField={value}
          availableFields={availableFields}
          updateConfigField={handleFieldSelect}
        />
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <EuiButtonIcon
          iconType="pencil"
          size="s"
          color="text"
          onClick={() => onFieldChange(CUSTOM_VALUE_KEY)}
          title={i18n.translate('explore.transformations.addField.switchToCustom', {
            defaultMessage: 'Enter custom value',
          })}
        />
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};

const AddFieldEditor = ({
  config,
  onChange,
  availableFields,
}: {
  config: AddFieldConfig;
  onChange: (newConfig: AddFieldConfig) => void;
  availableFields: FieldSchema[];
}) => {
  const update = useCallback(
    (partial: Partial<AddFieldConfig>) => {
      onChange({ ...config, ...partial });
    },
    [config, onChange]
  );

  // add field transformation only consider numerical field
  const numericalFields = availableFields.filter((f) => f.visFieldType === VisFieldType.Numerical);

  const binaryOperatorOptions = [
    { value: '+', text: '+' },
    { value: '-', text: '-' },
    { value: '*', text: '*' },
    { value: '/', text: '/' },
  ];

  const unaryOperatorOptions = [
    {
      value: 'abs',
      text: i18n.translate('explore.transformations.addField.abs', {
        defaultMessage: 'Absolute value',
      }),
    },
    {
      value: 'ceil',
      text: i18n.translate('explore.transformations.addField.ceil', { defaultMessage: 'Ceiling' }),
    },
    {
      value: 'floor',
      text: i18n.translate('explore.transformations.addField.floor', { defaultMessage: 'Floor' }),
    },
    {
      value: 'round',
      text: i18n.translate('explore.transformations.addField.round', { defaultMessage: 'Round' }),
    },
  ];

  const modeToggleOptions = [
    {
      id: 'binary',
      label: i18n.translate('explore.transformations.addField.binaryMode', {
        defaultMessage: 'Binary',
      }),
    },
    {
      id: 'unary',
      label: i18n.translate('explore.transformations.addField.unaryMode', {
        defaultMessage: 'Unary',
      }),
    },
    {
      id: 'cumulative',
      label: i18n.translate('explore.transformations.addField.cumulativeMode', {
        defaultMessage: 'Cumulative',
      }),
    },
  ];

  return (
    <EuiFlexGroup direction="column" gutterSize="s">
      <EuiFlexItem>
        <EuiFormRow
          label={i18n.translate('explore.transformations.addField.modeLabel', {
            defaultMessage: 'Mode',
          })}
          display="columnCompressed"
        >
          <EuiButtonGroup
            legend={i18n.translate('explore.transformations.addField.modeLegend', {
              defaultMessage: 'Calculation mode',
            })}
            options={modeToggleOptions}
            idSelected={config.mode}
            onChange={(id) => update({ mode: id as Mode })}
            buttonSize="compressed"
            data-test-subj="addFieldModeToggle"
          />
        </EuiFormRow>
      </EuiFlexItem>

      {config.mode === 'binary' ? (
        <>
          <EuiFlexItem>
            <EuiFormRow
              label={i18n.translate('explore.transformations.addField.field1Label', {
                defaultMessage: 'Field 1',
              })}
              display="columnCompressed"
            >
              <FieldPicker
                value={config.field1}
                customValue={config.field1CustomValue}
                availableFields={numericalFields}
                onFieldChange={(f) => update({ field1: f })}
                onCustomValueChange={(v) => update({ field1CustomValue: v })}
              />
            </EuiFormRow>
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiFormRow
              label={i18n.translate('explore.transformations.addField.operatorLabel', {
                defaultMessage: 'Operator',
              })}
              display="columnCompressed"
            >
              <EuiSelect
                compressed
                options={binaryOperatorOptions}
                value={config.binaryOperator}
                onChange={(e) => update({ binaryOperator: e.target.value as BinaryOperator })}
                data-test-subj="addFieldBinaryOperatorSelect"
              />
            </EuiFormRow>
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiFormRow
              label={i18n.translate('explore.transformations.addField.field2Label', {
                defaultMessage: 'Field 2',
              })}
              display="columnCompressed"
            >
              <FieldPicker
                value={config.field2}
                customValue={config.field2CustomValue}
                availableFields={numericalFields}
                onFieldChange={(f) => update({ field2: f })}
                onCustomValueChange={(v) => update({ field2CustomValue: v })}
              />
            </EuiFormRow>
          </EuiFlexItem>
        </>
      ) : config.mode === 'unary' ? (
        <>
          <EuiFlexItem>
            <EuiFormRow
              label={i18n.translate('explore.transformations.addField.unaryOperatorLabel', {
                defaultMessage: 'Function',
              })}
              display="columnCompressed"
            >
              <EuiSelect
                compressed
                options={unaryOperatorOptions}
                value={config.unaryOperator}
                onChange={(e) => update({ unaryOperator: e.target.value as UnaryOperator })}
              />
            </EuiFormRow>
          </EuiFlexItem>
          <EuiFlexItem>
            <FieldSelector
              configField={config.unaryField}
              availableFields={numericalFields}
              updateConfigField={(fieldSchema) => update({ unaryField: fieldSchema?.name })}
            />
          </EuiFlexItem>
        </>
      ) : (
        <>
          <EuiFlexItem>
            <EuiFormRow
              label={i18n.translate('explore.transformations.addField.cumulativeOperatorLabel', {
                defaultMessage: 'Function',
              })}
              display="columnCompressed"
            >
              <EuiSelect
                compressed
                options={[
                  {
                    value: 'total',
                    text: i18n.translate('explore.transformations.addField.total', {
                      defaultMessage: 'Total',
                    }),
                  },
                  {
                    value: 'mean',
                    text: i18n.translate('explore.transformations.addField.mean', {
                      defaultMessage: 'Mean',
                    }),
                  },
                ]}
                value={config.cumulativeOperator}
                onChange={(e) =>
                  update({ cumulativeOperator: e.target.value as CumulativeOperator })
                }
                data-test-subj="addFieldCumulativeOperatorSelect"
              />
            </EuiFormRow>
          </EuiFlexItem>
          <EuiFlexItem>
            <FieldSelector
              configFields={(config.cumulativeFields ?? []).map((f) => f.name)}
              availableFields={numericalFields}
              updateConfigFields={(fields) => update({ cumulativeFields: fields })}
              supportMulti
              testSubjPrefix="addFieldCumulative"
            />
          </EuiFlexItem>
        </>
      )}

      {/* Alias */}
      <EuiFlexItem>
        <EuiFormRow
          label={i18n.translate('explore.transformations.addField.aliasLabel', {
            defaultMessage: 'Alias',
          })}
          display="columnCompressed"
        >
          <EuiFieldText
            compressed
            value={config.alias}
            onChange={(e) => update({ alias: e.target.value })}
            placeholder={
              generateAlias(config) ||
              i18n.translate('explore.transformations.addField.aliasPlaceholder', {
                defaultMessage: 'Enter field name...',
              })
            }
            data-test-subj="addFieldAliasInput"
          />
        </EuiFormRow>
      </EuiFlexItem>

      {/* Replace all fields */}
      {/* <EuiFlexItem>
        <EuiFormRow display="columnCompressed">
          <EuiSwitch
            label={i18n.translate('explore.transformations.addField.replaceAllFieldsLabel', {
              defaultMessage: 'Replace all fields',
            })}
            checked={config.replaceAllFields}
            onChange={(e: { target: { checked: boolean } }) =>
              update({ replaceAllFields: e.target.checked })
            }
            compressed
            data-test-subj="addFieldReplaceAllFieldsSwitch"
          />
        </EuiFormRow>
      </EuiFlexItem> */}
    </EuiFlexGroup>
  );
};

export function createAddFieldTransformation(): TransformationInstance {
  return {
    instance_id: uuid.v4(),
    label: i18n.translate('explore.transformations.addField.label', {
      defaultMessage: 'Add Field',
    }),
    config: {
      mode: 'binary',
      field1: undefined,
      field1CustomValue: '',
      binaryOperator: '+',
      field2: undefined,
      field2CustomValue: '',
      unaryOperator: 'abs',
      unaryField: undefined,
      cumulativeOperator: 'total',
      cumulativeFields: [],
      alias: '',
    } as AddFieldConfig,
    hide: false,
    transformationMethod: (data: any[], config: any) => {
      const c = config as AddFieldConfig;

      if (!isConfigComplete(c)) return data;

      const alias = c.alias || generateAlias(c);

      return data.map((row) => {
        let result: number | null = null;

        if (c.mode === 'binary') {
          const getRaw = (field: string | undefined, custom: string) =>
            field === CUSTOM_VALUE_KEY ? Number(custom) : Number(get(row, `_source.${field}`));

          const v1 = getRaw(c.field1, c.field1CustomValue);
          const v2 = getRaw(c.field2, c.field2CustomValue);

          if (!isNaN(v1) && !isNaN(v2)) {
            result = applyBinary(v1, c.binaryOperator, v2);
          }
        } else if (c.mode === 'unary') {
          const raw = Number(get(row, `_source.${c.unaryField}`));
          if (!isNaN(raw)) {
            result = applyUnary(raw, c.unaryOperator);
          }
        } else {
          // cumulative — row-wise across selected fields
          const values = (c.cumulativeFields ?? [])
            .map((f) => Number(get(row, `_source.${f.name}`)))
            .filter((v) => !isNaN(v));
          if (values.length > 0) {
            const sum = values.reduce((a, b) => a + b, 0);
            result = c.cumulativeOperator === 'total' ? sum : sum / values.length;
          }
        }
        const newSource = { ...row._source, [alias]: result };

        return { ...row, _source: newSource };
      });
    },
    resetConfig: (config: any, availableFieldNames: Set<string>) => {
      const c = { ...config };
      if (c.mode === 'binary') {
        if (c.field1 && c.field1 !== '__CUSTOM__' && !availableFieldNames.has(c.field1)) {
          c.field1 = undefined;
          c.field1CustomValue = '';
        }
        if (c.field2 && c.field2 !== '__CUSTOM__' && !availableFieldNames.has(c.field2)) {
          c.field2 = undefined;
          c.field2CustomValue = '';
        }
      } else if (c.mode === 'unary') {
        if (c.unaryField && !availableFieldNames.has(c.unaryField)) {
          c.unaryField = undefined;
        }
      } else {
        c.cumulativeFields = ((c.cumulativeFields as FieldSchema[]) ?? []).filter((f) =>
          availableFieldNames.has(f.name)
        );
      }
      return c;
    },
    Editor: AddFieldEditor,
  };
}

export const addFieldTransformationDefinition: TransformationDefinition = {
  id: 'add_field',
  type: 'transform',
  label: i18n.translate('explore.transformations.addField.label', { defaultMessage: 'Add Field' }),
  description: i18n.translate('explore.transformations.addField.description', {
    defaultMessage:
      'Create a new field using binary or unary calculations on existing numerical fields',
  }),
  iconType: 'plusInCircle',
  createInstance: createAddFieldTransformation,
};
