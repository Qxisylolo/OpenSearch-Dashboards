/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useEffect } from 'react';
import { TransformationService } from '../data_transformations/transformation_service';
import { limitTransformationDefinition } from '../data_transformations/transformations/limit_transformation';
import { sortByTransformationDefinition } from '../data_transformations/transformations/sortby_transformation';
import { filterTransformationDefinition } from '../data_transformations/transformations/filter_transformation';
import { addFieldTransformationDefinition } from '../data_transformations/transformations/add_field_transformation';
import { filterFieldsTransformationDefinition } from '../data_transformations/transformations/filter_fields_transformation';
import { convertFieldTypeTransformationDefinition } from '../data_transformations/transformations/convert_field_type_transformation';
import { reduceTransformationDefinition } from '../data_transformations/transformations/reduce_transformation';
import { groupByTransformationDefinition } from '../data_transformations/transformations/group_by_transformation';
import { extractFieldsTransformationDefinition } from '../data_transformations/transformations/extract_fields_transformation';
import { useQueryBuilderState } from './use_query_builder_state';
import { getServices } from '../../../services/services';
import { UrlTransformationState } from '../data_transformations';

let globalTransformationService: TransformationService | undefined;

export const useTransformationService = (
  savedTransformationPipeline?: UrlTransformationState[]
): TransformationService => {
  const { queryBuilder } = useQueryBuilderState();

  const transformationService = useMemo(() => {
    if (globalTransformationService) {
      return globalTransformationService;
    }

    const service = new TransformationService();
    service.init();
    service.registerDefinition(limitTransformationDefinition);
    service.registerDefinition(sortByTransformationDefinition);
    service.registerDefinition(filterTransformationDefinition);
    service.registerDefinition(addFieldTransformationDefinition);
    service.registerDefinition(filterFieldsTransformationDefinition);
    service.registerDefinition(convertFieldTypeTransformationDefinition);
    service.registerDefinition(reduceTransformationDefinition);
    service.registerDefinition(groupByTransformationDefinition);
    service.registerDefinition(extractFieldsTransformationDefinition);

    globalTransformationService = service;
    return service;
  }, []);

  // set service to QueryBuilder
  useEffect(() => {
    if (!transformationService) return;
    queryBuilder.setTransformationService(transformationService);
    const subscription = transformationService.pipeline$.subscribe(() => {
      queryBuilder.updateQueryEditorState({ isQueryEditorDirty: true });
    });
    return () => subscription.unsubscribe();
  }, [queryBuilder, transformationService]);

  // init URL sync once on mount — before any restore so URL state is available
  useEffect(() => {
    const { osdUrlStateStorage } = getServices();
    if (osdUrlStateStorage) {
      transformationService.initUrlSync(osdUrlStateStorage);
    }
  }, [transformationService]);

  // Restore saved pipeline when it arrives
  useEffect(() => {
    if (!savedTransformationPipeline || savedTransformationPipeline.length === 0) return;

    const restoredPipeline: any[] = [];
    for (const item of savedTransformationPipeline) {
      const definition = transformationService.getDefinition(item.definitionId);
      if (definition) {
        const instance = definition.createInstance();
        restoredPipeline.push({
          ...instance,
          instance_id: item.instanceId,
          config: item.config,
          hide: item.hide,
        });
      }
    }
    if (restoredPipeline.length > 0) {
      transformationService.setPipeline(restoredPipeline);
    }
  }, [savedTransformationPipeline, transformationService]);

  return transformationService;
};

export const cleanupGlobalTransformationService = () => {
  if (globalTransformationService) {
    globalTransformationService.destroy();
    globalTransformationService = undefined;
  }
};
