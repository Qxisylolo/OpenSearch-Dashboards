/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect } from 'react';
import uuid from 'uuid';
import { EuiButtonGroup, EuiFieldText, EuiFlexGroup, EuiFlexItem, EuiFormRow } from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { get } from 'lodash';
import { TransformationInstance, TransformationDefinition, FieldSchema } from '../types';
import { FieldSelector } from '../field_selector';
import { VisFieldType } from '../../../../components/visualizations/types';

type ParseFormat = 'json' | 'object';

interface ExtractFieldsConfig {
  field: string | undefined;
  format: ParseFormat;
  prefix: string;
}

const isConfigComplete = (config: ExtractFieldsConfig): boolean => !!config.field;

const applyPrefix = (obj: Record<string, unknown>, prefix: string): Record<string, unknown> => {
  if (!prefix) return obj;
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [prefix + k, v]));
};

const extractFromJSON = (raw: string, prefix: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return applyPrefix(parsed as Record<string, unknown>, prefix);
    }
  } catch {
    // not valid JSON
  }
  return {};
};

const extractFromObject = (raw: unknown, prefix: string): Record<string, unknown> => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return applyPrefix(raw as Record<string, unknown>, prefix);
  }
  return {};
};

const ExtractFieldsEditor = ({
  config,
  onChange,
  availableFields,
}: {
  config: ExtractFieldsConfig;
  onChange: (newConfig: ExtractFieldsConfig) => void;
  availableFields: FieldSchema[];
}) => {
  const update = useCallback(
    (patch: Partial<ExtractFieldsConfig>) => onChange({ ...config, ...patch }),
    [config, onChange]
  );

  const possibleFields = availableFields.filter(
    (f) =>
      f.visFieldType !== VisFieldType.Numerical &&
      f.visFieldType !== VisFieldType.Date &&
      f.visFieldType !== VisFieldType.Categorical
  );

  useEffect(() => {
    if (possibleFields.length === 0) return;
    if (config.field && !possibleFields.find((f) => f.name === config.field)) {
      onChange({ ...config, field: undefined });
    }
  }, [possibleFields]); // eslint-disable-line react-hooks/exhaustive-deps

  const formatOptions = [
    {
      id: 'object',
      label: i18n.translate('explore.transformations.extractFields.objectFormat', {
        defaultMessage: 'Object',
      }),
    },
    {
      id: 'json',
      label: i18n.translate('explore.transformations.extractFields.jsonFormat', {
        defaultMessage: 'JSON string',
      }),
    },
  ];

  return (
    <EuiFlexGroup direction="column" gutterSize="s">
      <EuiFlexItem>
        <FieldSelector
          configField={config.field}
          availableFields={possibleFields}
          updateConfigField={(f) => update({ field: f?.name })}
          testSubjPrefix="extractFieldsSource"
        />
      </EuiFlexItem>
      <EuiFlexItem>
        <EuiFormRow
          label={i18n.translate('explore.transformations.extractFields.formatLabel', {
            defaultMessage: 'Format',
          })}
          display="columnCompressed"
        >
          <EuiButtonGroup
            legend={i18n.translate('explore.transformations.extractFields.formatLegend', {
              defaultMessage: 'Parse format',
            })}
            options={formatOptions}
            idSelected={config.format}
            onChange={(id) => update({ format: id as ParseFormat })}
            buttonSize="compressed"
            data-test-subj="extractFieldsFormatToggle"
          />
        </EuiFormRow>
      </EuiFlexItem>
      <EuiFlexItem>
        <EuiFormRow
          label={i18n.translate('explore.transformations.extractFields.prefixLabel', {
            defaultMessage: 'Column prefix',
          })}
          display="columnCompressed"
        >
          <EuiFieldText
            compressed
            value={config.prefix}
            onChange={(e) => update({ prefix: e.target.value })}
            placeholder={i18n.translate('explore.transformations.extractFields.prefixPlaceholder', {
              defaultMessage: 'Optional prefix...',
            })}
          />
        </EuiFormRow>
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};

export function createExtractFieldsTransformation(): TransformationInstance {
  return {
    instance_id: uuid.v4(),
    label: i18n.translate('explore.transformations.extractFields.label', {
      defaultMessage: 'Extract Fields',
    }),
    config: {
      field: undefined,
      format: 'object',
      prefix: '',
    } as ExtractFieldsConfig,
    hide: false,
    transformationMethod: (data: any[], config: ExtractFieldsConfig) => {
      const c = { ...config };
      if (!isConfigComplete(c)) return data;

      return data.map((row) => {
        const raw = get(row, `_source.${c.field}`);
        if (raw == null) return row;

        const extracted =
          c.format === 'json'
            ? extractFromJSON(String(raw), c.prefix)
            : extractFromObject(raw, c.prefix);

        return {
          ...row,
          _source: { ...(row._source as Record<string, unknown>), ...extracted },
        };
      });
    },
    Editor: ExtractFieldsEditor,
  };
}

export const extractFieldsTransformationDefinition: TransformationDefinition = {
  id: 'extract_fields',
  type: 'transform',
  label: i18n.translate('explore.transformations.extractFields.label', {
    defaultMessage: 'Extract Fields',
  }),
  description: i18n.translate('explore.transformations.extractFields.description', {
    defaultMessage: 'Flatten a nested object or JSON string field into top-level columns',
  }),
  iconType: 'unlink',
  createInstance: createExtractFieldsTransformation,
};
