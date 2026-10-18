/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useMemo } from 'react';
import { useObservable } from 'react-use';
import { EuiEmptyPrompt, EuiResizableContainer, EuiSpacer } from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { SectionList } from './section_list';
import { SectionPanel } from './section_panel';
import {
  QueryRowHandlers,
  QueryRowItem,
  useSectionWorkspaceState,
} from './use_section_workspace_state';
import { QueryAddButton, QueryItemActions, TransformItemActions } from './section_item_actions';
import { SectionItem } from './utils';
import { useQueryBuilderState } from '../../hooks/use_query_builder_state';
import { QueryPanel } from '../visualization_editor_query_panel';
import { TransformationService } from '../../../../components/data_transformations';
import { TransformationAddButton } from './add_transformation_button';
import './query_workspace.scss';

export interface QueryWorkspaceProps {
  transformServices: TransformationService;
}

export const QueryWorkspace = ({ transformServices }: QueryWorkspaceProps) => {
  const { queryBuilder, queryEditorState } = useQueryBuilderState();
  const transformPipeline = useObservable(
    transformServices.pipeline$,
    transformServices.pipeline$.getValue()
  );
  const stageFieldsMap = useObservable(
    transformServices.stageFields$,
    transformServices.stageFields$.getValue()
  );

  const queryRows: QueryRowItem[] = useMemo(
    () => [{ refId: queryBuilder.refId, isHidden: queryEditorState.isHidden }],
    [queryBuilder.refId, queryEditorState.isHidden]
  );
  // TODO Single builder for now; the multi builder will resolve this from its rows.
  const getQueryRowBuilder = useCallback(
    (refId?: string) => (refId === queryBuilder.refId ? queryBuilder : undefined),
    [queryBuilder]
  );
  // TODO No add/remove/reorder for queries until the multi query builder is wired in.
  const queryHandlers = useMemo<QueryRowHandlers>(() => ({}), []);

  const { sections, active, onSelectItem } = useSectionWorkspaceState({
    queryRows,
    queryHandlers,
    transformPipeline,
    transformationService: transformServices,
  });
  const activeItemId = active.activeItemId;

  const onAddTransformation = useCallback(
    (definitionId: string) => {
      const currentIds = new Set(transformServices.pipeline$.getValue().map((t) => t.instance_id));
      transformServices.addInstance(definitionId);

      const created = transformServices.pipeline$
        .getValue()
        .find((instance) => !currentIds.has(instance.instance_id));
      if (created) {
        onSelectItem(created.instance_id);
      }
    },
    [onSelectItem, transformServices]
  );

  const sectionsWithActions = useMemo(
    () =>
      sections.map((section) => {
        if (section.id === 'queries') {
          return {
            ...section,
            renderAddAction: <QueryAddButton onAdd={queryHandlers.onAdd} />,
            renderItemActions: (item: SectionItem) => (
              <QueryItemActions
                item={item}
                canRemove={!!queryHandlers.onRemove && queryRows.length > 1}
                onRemove={queryHandlers.onRemove}
              />
            ),
          };
        }
        if (section.id === 'transformations') {
          return {
            ...section,
            renderAddAction: (
              <TransformationAddButton
                definitions={transformServices.getDefinitions()}
                onSelectTransformation={onAddTransformation}
              />
            ),
            renderItemActions: (item: SectionItem) => (
              <TransformItemActions
                item={item}
                onToggleHide={(id) => transformServices.toggleInstanceHide(id)}
                onRemove={(id) => transformServices.removeInstance(id)}
              />
            ),
          };
        }
        return section;
      }),
    [onAddTransformation, queryHandlers, queryRows.length, sections, transformServices]
  );

  const activeMetadata = useMemo(() => {
    if (active.currentActive === 'query') {
      return {
        title: i18n.translate('explore.queryWorkspace.queryDetailTitle', {
          defaultMessage: 'Query',
        }),
        subtitle: active.activeItemId,
        iconType: 'search',
      };
    }

    if (active.currentActive === 'transformation') {
      const instance = transformPipeline.find((t) => t.instance_id === active.activeItemId);
      const definition = instance
        ? transformServices.getDefinition(instance.definition_id)
        : undefined;

      return {
        title: i18n.translate('explore.queryWorkspace.transformationDetailTitle', {
          defaultMessage: 'Transformation',
        }),
        subtitle: definition?.label ?? instance?.definition_id,
        iconType: definition?.iconType ?? 'function',
      };
    }

    return undefined;
  }, [active, transformPipeline, transformServices]);

  const renderDetail = () => {
    if (active.currentActive === 'query') {
      const row = getQueryRowBuilder(active.activeItemId);
      if (!row) return null;
      return <QueryPanel queryEditorState$={row.queryEditorState$} />;
    }

    if (active.currentActive === 'transformation') {
      const instance = transformPipeline.find((t) => t.instance_id === active.activeItemId);
      if (!instance) return null;
      const { Editor } = instance;
      return (
        <Editor
          config={instance.config}
          onChange={(newConfig) =>
            transformServices.updateInstanceConfig(instance.instance_id, newConfig)
          }
          availableFields={stageFieldsMap.get(instance.instance_id) ?? []}
        />
      );
    }

    return renderEmpty();
  };

  return (
    <div className="queryWorkspace">
      <EuiResizableContainer className="queryWorkspace__body">
        {(EuiResizablePanel, EuiResizableButton) => (
          <>
            <EuiResizablePanel
              initialSize={30}
              minSize="20%"
              paddingSize="s"
              // OUI strips borders unless color is plain.
              color="plain"
              hasBorder
              borderRadius="m"
              className="queryWorkspace__card"
            >
              {sectionsWithActions.map((section) => (
                <React.Fragment key={section.id}>
                  <SectionList
                    section={section}
                    activeItemId={activeItemId}
                    onSelectItem={onSelectItem}
                  />
                  <EuiSpacer size="m" />
                </React.Fragment>
              ))}
            </EuiResizablePanel>

            <EuiResizableButton />

            <EuiResizablePanel
              initialSize={70}
              minSize="50%"
              paddingSize="none"
              color="plain"
              hasBorder
              borderRadius="m"
              className="queryWorkspace__card"
            >
              <SectionPanel
                title={activeMetadata?.title}
                subtitle={activeMetadata?.subtitle}
                iconType={activeMetadata?.iconType}
              >
                {renderDetail()}
              </SectionPanel>
            </EuiResizablePanel>
          </>
        )}
      </EuiResizableContainer>
    </div>
  );
};

const renderEmpty = () => (
  <EuiEmptyPrompt
    iconType="inspect"
    title={
      <h3>
        {i18n.translate('explore.queryWorkspace.emptyDetailTitle', {
          defaultMessage: 'No queries or transformations',
        })}
      </h3>
    }
    body={
      <p>
        {i18n.translate('explore.queryWorkspace.emptyDetailBody', {
          defaultMessage: 'Add a query or transformation to get started.',
        })}
      </p>
    }
  />
);
