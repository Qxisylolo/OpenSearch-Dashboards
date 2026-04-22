/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useEffect } from 'react';
import { TransformationService } from '../data_transformations/transformation_service';
import { limitTransformationDefinition } from '../data_transformations/transformations/limit_transformation';
import { sortByTransformationDefinition } from '../data_transformations/transformations/sortBy_transformation';
import { useQueryBuilderState } from './use_query_builder_state';
import { getServices } from '../../../services/services';

/**
 * Hook that creates a standalone TransformationService, registers all built-in transformation
 * definitions, wires it into QueryBuilder, and initializes URL sync.
 */

export const useTransformationService = (): TransformationService => {
  const { queryBuilder } = useQueryBuilderState();

  const transformationService = useMemo(() => {
    const service = new TransformationService();
    service.init();
    // Register all built-in transformation definitions
    service.registerDefinition(limitTransformationDefinition);
    service.registerDefinition(sortByTransformationDefinition);
    return service;
  }, []);

  useEffect(() => {
    // Wire service into QueryBuilder
    queryBuilder.setTransformationService(transformationService);

    // Initialize URL sync
    const { osdUrlStateStorage } = getServices();
    if (osdUrlStateStorage) {
      transformationService.initUrlSync(osdUrlStateStorage);
    }
  }, [queryBuilder, transformationService]);

  useEffect(() => {
    return () => transformationService.destroy();
  }, [transformationService]);

  return transformationService;
};
