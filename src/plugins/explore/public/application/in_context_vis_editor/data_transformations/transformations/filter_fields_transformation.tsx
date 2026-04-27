/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import uuid from 'uuid';
import { EuiButtonGroup, EuiFlexGroup, EuiFlexItem, EuiFormRow } from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { TransformationInstance, TransformationDefinition, FieldSchema } from '../types';
import { FieldSelector } from '../field_selector';

type FilterFieldsMode = 'include' | 'exclude';

interface FilterFieldsConfig {
  mode: FilterFieldsMode;
  fieldOptions: FieldSchema[];
}

const isConfigComplete = (config: FilterFieldsConfig): boolean => config.fieldOptions.length > 0;

const FilterFieldsEditor = ({
  config,
  onChange,
  availableFields,
}: {
  config: FilterFieldsConfig;
  onChange: (newConfig: FilterFieldsConfig) => void;
  availableFields: FieldSchema[];
}) => {
  const update = useCallback(
    (partial: Partial<FilterFieldsConfig>) => onChange({ ...config, ...partial }),
    [config, onChange]
  );

  const modeOptions = [
    {
      id: 'include',
      label: i18n.translate('explore.transformations.filterFields.include', {
        defaultMessage: 'Include',
      }),
    },
    {
      id: 'exclude',
      label: i18n.translate('explore.transformations.filterFields.exclude', {
        defaultMessage: 'Exclude',
      }),
    },
  ];

  return (
    <EuiFlexGroup direction="column" gutterSize="s">
      <EuiFlexItem>
        <EuiFormRow
          label={i18n.translate('explore.transformations.filterFields.modeLabel', {
            defaultMessage: 'Mode',
          })}
          display="columnCompressed"
        >
          <EuiButtonGroup
            legend={i18n.translate('explore.transformations.filterFields.modeLegend', {
              defaultMessage: 'Filter mode',
            })}
            options={modeOptions}
            idSelected={config.mode}
            onChange={(id) => update({ mode: id as FilterFieldsMode })}
            buttonSize="compressed"
          />
        </EuiFormRow>
      </EuiFlexItem>
      <EuiFlexItem>
        <FieldSelector
          configFields={config.fieldOptions.map((f) => f.name)}
          availableFields={availableFields}
          updateConfigFields={(fields) => update({ fieldOptions: fields })}
          supportMulti={true}
        />
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};

export function createFilterFieldsTransformation(): TransformationInstance {
  return {
    instance_id: uuid.v4(),
    label: i18n.translate('explore.transformations.filterFields.label', {
      defaultMessage: 'Filter Fields',
    }),
    config: {
      mode: 'exclude',
      fieldOptions: [],
    } as FilterFieldsConfig,
    hide: false,
    transformationMethod: (data: any[], config: any) => {
      const c = config as FilterFieldsConfig;

      if (!isConfigComplete(c)) return data;

      const fieldNames = new Set(c.fieldOptions.map((f) => f.name));

      return data.map((row) => {
        const source = row._source as Record<string, unknown>;
        const newSource =
          c.mode === 'include'
            ? Object.fromEntries(Object.entries(source).filter(([key]) => fieldNames.has(key)))
            : Object.fromEntries(Object.entries(source).filter(([key]) => !fieldNames.has(key)));

        return { ...row, _source: newSource };
      });
    },
    resetConfig: (config: FilterFieldsConfig, availableFieldNames: Set<string>) => {
      const c = { ...config };
      const validFields = c.fieldOptions.filter((f) => availableFieldNames.has(f.name));
      return { ...c, fieldOptions: validFields };
    },
    Editor: FilterFieldsEditor,
  };
}

export const filterFieldsTransformationDefinition: TransformationDefinition = {
  id: 'filter_fields',
  type: 'filter',
  label: i18n.translate('explore.transformations.filterFields.label', {
    defaultMessage: 'Filter Fields',
  }),
  description: i18n.translate('explore.transformations.filterFields.description', {
    defaultMessage: 'Include or exclude fields by name',
  }),
  iconType: 'tableOfContents',
  createInstance: createFilterFieldsTransformation,
};
