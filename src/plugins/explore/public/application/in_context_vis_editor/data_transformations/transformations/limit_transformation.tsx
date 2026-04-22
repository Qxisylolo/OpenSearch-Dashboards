/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import uuid from 'uuid';
import { EuiFieldNumber, EuiFormRow } from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { TransformationInstance, TransformationDefinition } from '../types';

interface LimitConfig {
  limit: number;
}

const LimitEditor = ({
  config,
  onChange,
}: {
  config: LimitConfig;
  onChange: (newConfig: LimitConfig) => void;
  // availableFields: string[];
}) => (
  <EuiFormRow
    label={i18n.translate('explore.transformations.limit.rowsLabel', {
      defaultMessage: 'Number of rows',
    })}
    display="columnCompressed"
  >
    <EuiFieldNumber
      compressed
      value={config.limit}
      min={0}
      onChange={(e) => {
        const int = parseInt(e.target.value, 10);
        if (!isNaN(int) && int >= 0) {
          onChange({ limit: int });
        }
      }}
      data-test-subj="limitTransformationInput"
    />
  </EuiFormRow>
);

export function createLimitTransformation(): TransformationInstance {
  return {
    instance_id: uuid.v4(),
    label: i18n.translate('explore.transformations.limit.label', { defaultMessage: 'Limit' }),
    config: { limit: 10 } as LimitConfig,
    hide: false,
    transformationMethod: (data: any[], config: any) =>
      data.slice(0, (config as LimitConfig).limit),
    Editor: LimitEditor,
  };
}

export const limitTransformationDefinition: TransformationDefinition = {
  id: 'limit',
  type: 'filter',
  label: i18n.translate('explore.transformations.limit.label', { defaultMessage: 'Limit' }),
  description: i18n.translate('explore.transformations.limit.description', {
    defaultMessage: 'Keep only the first N rows of the result.',
  }),
  iconType: 'filter',
  createInstance: createLimitTransformation,
};
