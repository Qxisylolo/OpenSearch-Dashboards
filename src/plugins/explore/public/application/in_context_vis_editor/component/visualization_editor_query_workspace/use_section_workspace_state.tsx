/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useMemo, useState } from 'react';
import { i18n } from '@osd/i18n';
import { Section } from './utils';
import {
  TransformationInstance,
  TransformationService,
} from '../../../../components/data_transformations';

/**
 * Plain, already-reactive data for one query row. The hook never reads a query
 * builder directly, so the same shape works for the single and the multi builder.
 */
export interface QueryRowItem {
  refId: string;
  label?: string;
  isHidden?: boolean;
  isValid?: boolean;
}

export interface QueryRowHandlers {
  onAdd?: () => void;
  onRemove?: (refId: string) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
}

export interface ActiveSelection {
  currentActive: 'query' | 'transformation' | 'none'; // current active section
  activeItemId?: string; // current active section item
}

export interface UseSectionWorkspaceStateParams {
  queryRows: QueryRowItem[];
  queryHandlers?: QueryRowHandlers;
  transformPipeline: TransformationInstance[];
  transformationService: TransformationService;
  /** Notified when a query row is selected (e.g. to sync a multi builder's selectRow). */
  onSelectQuery?: (refId: string) => void;
}

export interface UseSectionWorkspaceStateResult {
  sections: Section[];
  active: ActiveSelection;
  onSelectItem: (id: string) => void;
}

/**
 * Data + selection for the workspace rail. Renders nothing: row actions and add
 * buttons are composed by the caller.
 */
export const useSectionWorkspaceState = ({
  queryRows,
  queryHandlers = {},
  transformPipeline,
  transformationService,
  onSelectQuery,
}: UseSectionWorkspaceStateParams): UseSectionWorkspaceStateResult => {
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const { onReorder: onReorderQueries } = queryHandlers;

  const querySection: Section = useMemo(
    () => ({
      id: 'queries',
      title: i18n.translate('explore.queryWorkspace.queriesSectionTitle', {
        defaultMessage: 'Queries',
      }),
      items: queryRows.map((row) => ({
        id: row.refId,
        label: row.label ?? row.refId,
        iconType: 'visBarVertical',
        isHidden: row.isHidden ?? false,
        isValid: row.isValid,
      })),
      // Only offer drag when it can actually reorder something.
      draggable: !!onReorderQueries && queryRows.length > 1,
      onReorder: onReorderQueries,
    }),
    [queryRows, onReorderQueries]
  );

  const transformSection: Section = useMemo(
    () => ({
      id: 'transformations',
      title: i18n.translate('explore.queryWorkspace.transformationsSectionTitle', {
        defaultMessage: 'Transformations',
      }),
      items: transformPipeline.map((instance) => {
        const definition = transformationService.getDefinition(instance.definition_id);
        return {
          id: instance.instance_id,
          label: definition?.label ?? instance.definition_id,
          iconType: definition?.iconType ?? 'filter',
          isHidden: instance.hide,
        };
      }),
      draggable: true,
      onReorder: (fromIndex: number, toIndex: number) => {
        // Read the pipeline at call time rather than the render-time closure.
        const next = [...transformationService.pipeline$.getValue()];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        transformationService.setPipeline(next);
      },
    }),
    [transformPipeline, transformationService]
  );

  const sections = useMemo(
    () => [querySection, transformSection],
    [querySection, transformSection]
  );

  const active: ActiveSelection = useMemo(() => {
    if (selectedId) {
      if (querySection.items.some((i) => i.id === selectedId)) {
        return { currentActive: 'query', activeItemId: selectedId };
      }
      if (transformSection.items.some((i) => i.id === selectedId)) {
        return { currentActive: 'transformation', activeItemId: selectedId };
      }
    }

    const firstQuery = querySection.items[0];
    if (firstQuery) {
      return { currentActive: 'query', activeItemId: firstQuery.id };
    }
    const firstTransformation = transformSection.items[0];
    if (firstTransformation) {
      return { currentActive: 'transformation', activeItemId: firstTransformation.id };
    }
    return { currentActive: 'none' };
  }, [selectedId, querySection, transformSection]);

  const onSelectItem = useCallback(
    (id: string) => {
      setSelectedId(id);
      if (queryRows.some((row) => row.refId === id)) {
        onSelectQuery?.(id);
      }
    },
    [queryRows, onSelectQuery]
  );

  return { sections, active, onSelectItem };
};
