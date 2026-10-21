/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useMemo, useState } from 'react';
import { EuiBetaBadge, EuiContextMenuItem, EuiContextMenuPanel, EuiPopover } from '@elastic/eui';
import { i18n } from '@osd/i18n';
import classNames from 'classnames';

import '../../../components/query_panel/query_panel_widgets/language_toggle/language_toggle.scss';
import { EditorMode } from '../../utils/state_management/types';
import { SupportLanguageType } from '../query_builder/query_builder';
import { getInitialQueryString } from '../query_builder/utils';
import { useEditorOperations } from '../hooks/use_editor_operations';
import { useQueryBuilderState } from '../hooks/use_query_builder_state';
import { useOpenSearchDashboards } from '../../../../../opensearch_dashboards_react/public';
import { ExploreServices } from '../../../types';

const promptOptionText = i18n.translate('explore.queryPanelFooter.languageToggle.promptOption', {
  defaultMessage: 'AI',
});

const promQLOptionText = i18n.translate('explore.queryPanelFooter.languageToggle.promQLOption', {
  defaultMessage: 'PromQL',
});

const pplOptionText = i18n.translate('explore.queryPanelFooter.languageToggle.pplOption', {
  defaultMessage: 'PPL',
});

const sqlOptionText = i18n.translate('explore.queryPanelFooter.languageToggle.sqlOption', {
  defaultMessage: 'SQL',
});

const getLanguageDisplayLabel = (languageType: SupportLanguageType): string => {
  switch (languageType) {
    case SupportLanguageType.promQL:
      return promQLOptionText;
    case SupportLanguageType.ppl:
      return pplOptionText;
    case SupportLanguageType.ai:
      return promptOptionText;
    case SupportLanguageType.sql:
      return sqlOptionText;
    default:
      return languageType;
  }
};

export const LanguageToggle = () => {
  const { services } = useOpenSearchDashboards<ExploreServices>();
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const { focusEditor, switchEditorMode } = useEditorOperations();
  const { queryBuilder, queryEditorState, queryState } = useQueryBuilderState();

  const { clearEditor } = useEditorOperations();

  const promptModeIsAvailable = queryEditorState.promptModeIsAvailable;
  const isPromptMode = queryEditorState.editorMode === EditorMode.Prompt;
  const language = queryState.language;

  const languageLabel = getLanguageDisplayLabel(
    (isPromptMode ? SupportLanguageType.ai : language) as SupportLanguageType
  );

  const onButtonClick = () => setIsPopoverOpen(!isPopoverOpen);
  const closePopover = useCallback(() => setIsPopoverOpen(false), []);

  const onLanguageItemClick = useCallback(
    async (option: string) => {
      closePopover();

      if (option === promptOptionText) {
        switchEditorMode(EditorMode.Prompt);
      } else {
        switchEditorMode(EditorMode.Query);

        let languageType: SupportLanguageType;

        if (option === promQLOptionText) {
          languageType = SupportLanguageType.promQL;
        } else if (option === pplOptionText) {
          languageType = SupportLanguageType.ppl;
        } else {
          languageType = SupportLanguageType.sql;
        }

        clearEditor();

        const dataset = queryBuilder.queryState$.getValue().dataset;
        // SQL needs its base query on the current dataset; the others start empty.
        const query = getInitialQueryString(services.data.query.queryString, dataset, languageType);

        // Switching languages triggers a new query preparation in queryBuilder
        queryBuilder.updateQueryState({
          language: languageType,
          query,
          queryOptions: undefined,
        });
      }

      setTimeout(() => focusEditor(true), 100);
    },
    [
      closePopover,
      focusEditor,
      switchEditorMode,
      clearEditor,
      queryBuilder,
      services.data.query.queryString,
    ]
  );

  // Languages the current dataset can run; the dataset decides, the toggle only picks among them.
  const datasetLanguages = useMemo(() => {
    const dataset = queryState.dataset;
    if (!dataset) {
      return [language];
    }
    return (
      services.data?.query?.queryString
        ?.getDatasetService?.()
        ?.getType(dataset.type)
        ?.supportedLanguages(dataset) ?? [language]
    );
  }, [queryState.dataset, language, services.data?.query?.queryString]);

  const items = useMemo(() => {
    const queryLanguages = [
      { language: SupportLanguageType.ppl, label: pplOptionText },
      { language: SupportLanguageType.promQL, label: promQLOptionText },
      ...(services.sqlSupportEnabled
        ? [{ language: SupportLanguageType.sql, label: sqlOptionText }]
        : []),
    ];
    const output = queryLanguages
      .filter((option) => datasetLanguages.includes(option.language))
      .map((option) => (
        <EuiContextMenuItem
          key={option.label}
          onClick={() => onLanguageItemClick(option.label)}
          disabled={!isPromptMode && language === option.language}
          data-test-subj={`queryPanelFooterLanguageToggle-${option.label}`}
        >
          {option.label}
        </EuiContextMenuItem>
      ));

    // whether to display AI needs to check dataset first
    if (promptModeIsAvailable) {
      output.push(
        <EuiContextMenuItem
          key={promptOptionText}
          onClick={() => onLanguageItemClick(promptOptionText)}
          disabled={isPromptMode}
          data-test-subj={`queryPanelFooterLanguageToggle-${promptOptionText}`}
        >
          {promptOptionText}
        </EuiContextMenuItem>
      );
    }

    return output;
  }, [
    onLanguageItemClick,
    isPromptMode,
    language,
    promptModeIsAvailable,
    services.sqlSupportEnabled,
    datasetLanguages,
  ]);

  return (
    // This div is needed to allow for the gradient styling
    <div className="exploreLanguageToggle">
      <EuiPopover
        button={
          <EuiBetaBadge
            onClick={onButtonClick}
            data-test-subj="queryPanelFooterLanguageToggle"
            className={classNames('exploreLanguageToggle__button', {
              ['exploreLanguageToggle__button--aiMode']: isPromptMode,
            })}
            label={languageLabel}
          />
        }
        isOpen={isPopoverOpen}
        closePopover={closePopover}
        anchorPosition="downCenter"
        panelPaddingSize="none"
      >
        <EuiContextMenuPanel size="s" items={items} />
      </EuiPopover>
    </div>
  );
};
