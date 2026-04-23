/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useEffect } from 'react';
import { TransformationService } from '../data_transformations/transformation_service';
import { limitTransformationDefinition } from '../data_transformations/transformations/limit_transformation';
import { sortByTransformationDefinition } from '../data_transformations/transformations/sortby_transformation';
import { filterTransformationDefinition } from '../data_transformations/transformations/filter_transformation';
import { useQueryBuilderState } from './use_query_builder_state';
import { getServices } from '../../../services/services';
import { UrlTransformationState } from '../data_transformations';

/**
 * Hook that creates a standalone TransformationService, registers all built-in transformation
 * definitions, wires it into QueryBuilder, and initializes URL sync.
 */

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
    // Register all built-in transformation definitions
    service.registerDefinition(limitTransformationDefinition);
    service.registerDefinition(sortByTransformationDefinition);
    service.registerDefinition(filterTransformationDefinition);

    globalTransformationService = service;

    return service;
  }, []);

  // Wire service to QueryBuilder and setup dirty state tracking
  useEffect(() => {
    if (!transformationService) return;

    queryBuilder.setTransformationService(transformationService);

    // Subscribe to pipeline changes and mark editor as dirty when pipeline changes
    const subscription = transformationService.pipeline$.subscribe((pipeline) => {
      queryBuilder.updateQueryEditorState({ isQueryEditorDirty: true });
    });

    return () => subscription.unsubscribe();
  }, [queryBuilder, transformationService]);

  // One-time initialization: restore saved pipeline and init URL sync
  useEffect(() => {
    if (!transformationService) return;

    let hasRestored = false;

    // Restore savedTransformationPipeline (only if provided)
    if (savedTransformationPipeline && savedTransformationPipeline.length > 0) {
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
        hasRestored = true;
      }
    }

    // Initialize URL sync (only once, after restoration)
    const { osdUrlStateStorage } = getServices();
    if (osdUrlStateStorage) {
      transformationService.initUrlSync(osdUrlStateStorage);
    }
  }, []);

  // useEffect(() => {
  //   return () => {
  //     console.trace('who');
  //     console.log('destory', transformationService);
  //   };
  // }, []);

  return transformationService;
};

/**
 * Cleanup function to destroy the global transformation service singleton.
 * Should be called when the VisualizationEditorPage unmounts.
 */
export const cleanupGlobalTransformationService = () => {
  if (globalTransformationService) {
    globalTransformationService.destroy();
    globalTransformationService = undefined;
  }
};
