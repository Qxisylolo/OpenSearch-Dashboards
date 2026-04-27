/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useObservable } from 'react-use';
import {
  EuiAccordion,
  EuiButtonIcon,
  EuiDragDropContext,
  EuiDraggable,
  EuiDroppable,
  EuiFlexGroup,
  EuiFlexItem,
  EuiIcon,
  EuiPanel,
  EuiSpacer,
  EuiText,
  EuiTitle,
  euiDragDropReorder,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { TransformSelectorButton } from './transform_selector_overlay';
import {
  TransformationInstance,
  TransformationService,
  FieldSchema,
} from '../data_transformations';
import { useQueryBuilderState } from '../hooks/use_query_builder_state';
import { FIELD_TYPE_MAP } from '../../../components/visualizations/constants';
import { VisFieldType } from '../../../components/visualizations/types';

const DROPPABLE_ID = 'transformationPipelineDroppable';

export const TransformPanel = ({
  transformationService,
}: {
  transformationService: TransformationService;
}) => {
  const pipeline = useObservable(
    transformationService.pipeline$,
    transformationService.pipeline$.getValue()
  );

  const { queryBuilder } = useQueryBuilderState();
  const stageSchemas = useObservable(
    queryBuilder.stageSchemas$,
    queryBuilder.stageSchemas$.getValue()
  );

  console.log('stageSchemas', stageSchemas);

  const getAvailableFieldsForIndex = (index: number): FieldSchema[] => {
    const raw = stageSchemas[index] ?? [];
    return raw.map((field) => ({
      name: field.name || '',
      visFieldType: FIELD_TYPE_MAP[field.type || ''] || VisFieldType.Unknown,
    }));
  };

  const onSelectTransformation = (id: string) => {
    transformationService.addInstance(id);
  };

  const onRemove = (instanceId: string) => {
    transformationService.removeInstance(instanceId);
  };

  const onConfigChange = (instanceId: string, newConfig: any) => {
    transformationService.updateInstanceConfig(instanceId, newConfig);
  };

  const onToggleHide = (instanceId: string) => {
    transformationService.toggleInstanceHide(instanceId);
  };

  const onDragEnd = ({ source, destination }: any) => {
    if (!source || !destination) return;
    const reordered = euiDragDropReorder(pipeline, source.index, destination.index);
    const rawRows = queryBuilder.resultState$.getValue()?.hits?.hits ?? [];
    const originalSchema = queryBuilder.resultState$.getValue()?.fieldSchema ?? [];
    transformationService.reorderPipeline(reordered, rawRows, originalSchema);
  };

  return (
    <EuiPanel
      paddingSize="m"
      className="visualizationEditorTabPanel"
      style={{ height: '100%', overflowY: 'auto' }}
    >
      {pipeline.length === 0 && (
        <>
          <EuiTitle size="xs">
            <h2>
              {i18n.translate('explore.transformPanel.emptyTitle', {
                defaultMessage: 'Add a Transformation',
              })}
            </h2>
          </EuiTitle>
          <EuiSpacer size="s" />
          <EuiText size="s" color="subdued">
            {i18n.translate('explore.transformPanel.emptyDescription', {
              defaultMessage:
                'Transformations allow data to be changed in various ways before your visualization is shown.',
            })}
          </EuiText>
          <EuiSpacer size="m" />
        </>
      )}

      {pipeline.length > 0 && (
        <>
          <EuiDragDropContext onDragEnd={onDragEnd}>
            <EuiDroppable droppableId={DROPPABLE_ID}>
              {pipeline.map((instance: TransformationInstance, index: number) => (
                <EuiDraggable
                  spacing="m"
                  key={instance.instance_id}
                  index={index}
                  draggableId={instance.instance_id}
                >
                  {(provided) => (
                    <TransformationCard
                      index={index}
                      instance={instance}
                      onRemove={onRemove}
                      onConfigChange={onConfigChange}
                      onToggleHide={onToggleHide}
                      dragHandleProps={provided.dragHandleProps}
                      availableFields={getAvailableFieldsForIndex(index)}
                    />
                  )}
                </EuiDraggable>
              ))}
            </EuiDroppable>
          </EuiDragDropContext>
          <EuiSpacer size="m" />
        </>
      )}

      <TransformSelectorButton
        transformationService={transformationService}
        onSelectTransformation={onSelectTransformation}
      />
    </EuiPanel>
  );
};

interface TransformationCardProps {
  index: number;
  instance: TransformationInstance;
  onRemove: (id: string) => void;
  onConfigChange: (id: string, newConfig: any) => void;
  onToggleHide: (id: string) => void;
  dragHandleProps: Record<string, any> | null | undefined;
  availableFields: FieldSchema[];
}

const TransformationCard = ({
  index,
  instance,
  onRemove,
  onConfigChange,
  onToggleHide,
  dragHandleProps,
  availableFields,
}: TransformationCardProps) => {
  const { Editor } = instance;

  return (
    <EuiPanel paddingSize="s" hasBorder hasShadow={false}>
      <EuiAccordion
        id={`transformation-accordion-${instance.instance_id}`}
        initialIsOpen={true}
        buttonContent={
          <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
            <EuiFlexItem>
              <EuiText size="s" color={instance.hide ? 'subdued' : 'default'}>
                <strong>{`${index + 1} - ${instance.label}`}</strong>
              </EuiText>
            </EuiFlexItem>
          </EuiFlexGroup>
        }
        extraAction={
          <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false}>
            <EuiFlexItem grow={false}>
              {/* hide button */}
              <EuiButtonIcon
                iconType={instance.hide ? 'eyeClosed' : 'eye'}
                color="text"
                onClick={() => {
                  onToggleHide(instance.instance_id);
                }}
                data-test-subj={`transformHideButton-${instance.instance_id}`}
              />
            </EuiFlexItem>
            {/* Remove button*/}
            <EuiFlexItem grow={false}>
              <EuiButtonIcon
                iconType="trash"
                color="text"
                onClick={() => {
                  onRemove(instance.instance_id);
                }}
                data-test-subj={`transformRemoveButton-${instance.instance_id}`}
              />
            </EuiFlexItem>
            {/* drag button */}
            <EuiFlexItem grow={false}>
              <span
                {...dragHandleProps}
                style={{
                  cursor: 'grab',
                  display: 'flex',
                  alignItems: 'center',
                  marginLeft: '10px',
                }}
              >
                {/* dragVertical can not be displayed, use app as substitute */}
                <EuiIcon type="apps" />
              </span>
            </EuiFlexItem>
          </EuiFlexGroup>
        }
      >
        <EuiSpacer size="s" />
        <Editor
          config={instance.config}
          onChange={(newConfig) => onConfigChange(instance.instance_id, newConfig)}
          availableFields={availableFields}
        />
      </EuiAccordion>
    </EuiPanel>
  );
};
