/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { TransformationInstance, TransformationPipeline } from './types';

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
