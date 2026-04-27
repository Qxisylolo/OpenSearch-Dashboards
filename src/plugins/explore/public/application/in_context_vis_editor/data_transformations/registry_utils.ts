/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { TransformationInstance, TransformationPipeline } from './types';
import { OpenSearchSearchHit } from '../../../types/doc_views_types';

export function addTransformation(
  currentPipe: TransformationPipeline,
  instance: TransformationInstance
): TransformationPipeline {
  return [...currentPipe, instance];
}

export function removeTransformation(
  registry: TransformationPipeline,
  instanceId: string
): TransformationPipeline {
  return registry.filter((instance) => instance.instance_id !== instanceId);
}

export function updateTransformationConfig(
  registry: TransformationPipeline,
  instanceId: string,
  newConfig: any
): TransformationPipeline {
  return registry.map((instance) =>
    instance.instance_id === instanceId
      ? { ...instance, config: { ...instance.config, ...newConfig } }
      : instance
  );
}

export function toggleTransformationHide(
  registry: TransformationPipeline,
  instanceId: string
): TransformationPipeline {
  return registry.map((instance) =>
    instance.instance_id === instanceId ? { ...instance, hide: !instance.hide } : instance
  );
}

// Derive schema from current rows, preserving original types and inferring new ones.
export function deriveSchemaFromRows(
  rows: OpenSearchSearchHit[],
  originalSchema: Array<{ name?: string; type?: string }>
): Array<{ name?: string; type?: string }> {
  if (rows.length === 0) return originalSchema;
  const firstSource = (rows[0]._source as Record<string, unknown>) ?? {};
  const sourceKeys = new Set(Object.keys(firstSource));
  const existingNames = new Set(originalSchema.map((f) => f.name));

  const filtered = originalSchema.filter((f) => sourceKeys.has(f.name ?? ''));
  const extras: Array<{ name: string; type: string }> = [];
  for (const key of sourceKeys) {
    if (!existingNames.has(key)) {
      const val = firstSource[key];
      extras.push({
        name: key,
        // currentlty, add fields transform only support numerical fields
        type: typeof val === 'number' && Number.isInteger(val) ? 'integer' : 'double',
      });
    }
  }
  return extras.length > 0 ? [...filtered, ...extras] : filtered;
}
