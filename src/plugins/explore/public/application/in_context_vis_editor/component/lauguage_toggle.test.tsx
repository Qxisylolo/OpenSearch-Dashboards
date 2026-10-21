/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BehaviorSubject } from 'rxjs';
import { LanguageToggle } from './lauguage_toggle';
import { EditorMode } from '../../utils/state_management/types';
import { useQueryBuilderState } from '../hooks/use_query_builder_state';
import { useEditorOperations } from '../hooks/use_editor_operations';

jest.mock('../hooks/use_query_builder_state', () => ({ useQueryBuilderState: jest.fn() }));
jest.mock('../hooks/use_editor_operations', () => ({ useEditorOperations: jest.fn() }));
jest.mock('../query_builder/query_builder', () => ({
  SupportLanguageType: { ppl: 'PPL', promQL: 'PROMQL', ai: 'AI', sql: 'SQL' },
}));

// Languages the current dataset's type supports; the toggle only offers these.
const mockSupportedLanguages = jest.fn();
jest.mock('../../../../../opensearch_dashboards_react/public', () => ({
  ...jest.requireActual('../../../../../opensearch_dashboards_react/public'),
  useOpenSearchDashboards: () => ({
    services: {
      data: {
        query: {
          queryString: {
            getDatasetService: () => ({
              getType: () => ({ supportedLanguages: mockSupportedLanguages }),
            }),
          },
        },
      },
    },
  }),
}));

const mockUpdateQueryEditorState = jest.fn();
const mockUpdateQueryState = jest.fn();
const mockSwitchEditorMode = jest.fn();
const mockClearEditor = jest.fn();
const mockFocusEditor = jest.fn();

const buildQueryBuilderState = (options: Record<string, any> = {}) => ({
  queryEditorState: {
    languageType: 'PPL',
    editorMode: EditorMode.Query,
    promptModeIsAvailable: false,
    ...options,
  },
  // languageType mirrors the query's language; the toggle reads the language.
  queryState: {
    query: '',
    language: options.languageType ?? 'PPL',
    dataset: { id: 'ds', type: 'INDEX_PATTERN' },
  },
  queryBuilder: {
    updateQueryEditorState: mockUpdateQueryEditorState,
    updateQueryState: mockUpdateQueryState,
    // The click handler reads the row's dataset at execution time.
    queryState$: new BehaviorSubject({
      query: '',
      language: options.languageType ?? 'PPL',
      dataset: { id: 'ds', type: 'INDEX_PATTERN' },
    }),
  },
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockSupportedLanguages.mockReturnValue(['PPL', 'PROMQL']);
  (useQueryBuilderState as jest.Mock).mockReturnValue(buildQueryBuilderState());
  (useEditorOperations as jest.Mock).mockReturnValue({
    switchEditorMode: mockSwitchEditorMode,
    clearEditor: mockClearEditor,
    focusEditor: mockFocusEditor,
  });
});

afterEach(() => {
  jest.useRealTimers();
});

const openPopover = () => {
  fireEvent.click(screen.getByTestId('queryPanelFooterLanguageToggle'));
};

describe('LanguageToggle', () => {
  it('renders the toggle button', () => {
    render(<LanguageToggle />);
    expect(screen.getByTestId('queryPanelFooterLanguageToggle')).toBeInTheDocument();
  });

  it('shows PPL label when language is PPL', () => {
    render(<LanguageToggle />);
    expect(screen.getByTestId('queryPanelFooterLanguageToggle')).toHaveTextContent('PPL');
  });

  it('shows PromQL label when language is PROMQL', () => {
    (useQueryBuilderState as jest.Mock).mockReturnValue(
      buildQueryBuilderState({ languageType: 'PROMQL' })
    );
    render(<LanguageToggle />);
    expect(screen.getByTestId('queryPanelFooterLanguageToggle')).toHaveTextContent('PromQL');
  });

  it('shows AI label when in prompt mode', () => {
    (useQueryBuilderState as jest.Mock).mockReturnValue(
      buildQueryBuilderState({ editorMode: EditorMode.Prompt })
    );
    render(<LanguageToggle />);
    expect(screen.getByTestId('queryPanelFooterLanguageToggle')).toHaveTextContent('AI');
  });

  it('opens popover on button click', () => {
    render(<LanguageToggle />);
    expect(screen.queryByTestId('queryPanelFooterLanguageToggle-PPL')).not.toBeInTheDocument();
    openPopover();
    expect(screen.getByTestId('queryPanelFooterLanguageToggle-PPL')).toBeInTheDocument();
    expect(screen.getByTestId('queryPanelFooterLanguageToggle-PromQL')).toBeInTheDocument();
  });

  it('does not show AI option when promptModeIsAvailable is false', () => {
    render(<LanguageToggle />);
    openPopover();
    expect(screen.queryByTestId('queryPanelFooterLanguageToggle-AI')).not.toBeInTheDocument();
  });

  it('shows AI option when promptModeIsAvailable is true', () => {
    (useQueryBuilderState as jest.Mock).mockReturnValue(
      buildQueryBuilderState({ promptModeIsAvailable: true })
    );
    render(<LanguageToggle />);
    openPopover();
    expect(screen.getByTestId('queryPanelFooterLanguageToggle-AI')).toBeInTheDocument();
  });

  it('disables PPL option when already on PPL', () => {
    render(<LanguageToggle />);
    openPopover();
    expect(screen.getByTestId('queryPanelFooterLanguageToggle-PPL')).toBeDisabled();
  });

  it('disables PromQL option when already on PROMQL', () => {
    (useQueryBuilderState as jest.Mock).mockReturnValue(
      buildQueryBuilderState({ languageType: 'PROMQL' })
    );
    render(<LanguageToggle />);
    openPopover();
    expect(screen.getByTestId('queryPanelFooterLanguageToggle-PromQL')).toBeDisabled();
  });

  it('disables AI option when already in prompt mode', () => {
    (useQueryBuilderState as jest.Mock).mockReturnValue(
      buildQueryBuilderState({ editorMode: EditorMode.Prompt, promptModeIsAvailable: true })
    );
    render(<LanguageToggle />);
    openPopover();
    expect(screen.getByTestId('queryPanelFooterLanguageToggle-AI')).toBeDisabled();
  });

  // it('switches to PromQL and updates languageType when PromQL is clicked', () => {
  it('switches the query language, keeping the dataset, when PromQL is clicked', () => {
    render(<LanguageToggle />);
    openPopover();
    fireEvent.click(screen.getByTestId('queryPanelFooterLanguageToggle-PromQL'));
    expect(mockSwitchEditorMode).toHaveBeenCalledWith(EditorMode.Query);
    // expect(mockUpdateQueryEditorState).toHaveBeenCalledWith({ languageType: 'PROMQL' });
    expect(mockUpdateQueryState).toHaveBeenCalledWith({
      language: 'PROMQL',
      query: '',
      queryOptions: undefined,
    });
    expect(mockUpdateQueryEditorState).not.toHaveBeenCalled();
    expect(mockClearEditor).toHaveBeenCalled();
  });

  it("offers only the current dataset's languages", () => {
    mockSupportedLanguages.mockReturnValue(['kuery', 'lucene', 'PPL']);
    render(<LanguageToggle />);
    openPopover();
    expect(screen.getByTestId('queryPanelFooterLanguageToggle-PPL')).toBeInTheDocument();
    expect(screen.queryByTestId('queryPanelFooterLanguageToggle-PromQL')).not.toBeInTheDocument();
  });

  it('offers only the current language when there is no dataset', () => {
    (useQueryBuilderState as jest.Mock).mockReturnValue({
      ...buildQueryBuilderState(),
      queryState: { query: '', language: 'PPL', dataset: undefined },
    });
    render(<LanguageToggle />);
    openPopover();
    expect(screen.getByTestId('queryPanelFooterLanguageToggle-PPL')).toBeInTheDocument();
    expect(screen.queryByTestId('queryPanelFooterLanguageToggle-PromQL')).not.toBeInTheDocument();
    expect(mockSupportedLanguages).not.toHaveBeenCalled();
  });

  it('shows the new language after it changes elsewhere, e.g. on dataset selection', () => {
    const { rerender } = render(<LanguageToggle />);
    expect(screen.getByTestId('queryPanelFooterLanguageToggle')).toHaveTextContent('PPL');

    (useQueryBuilderState as jest.Mock).mockReturnValue(
      buildQueryBuilderState({ languageType: 'PROMQL' })
    );
    rerender(<LanguageToggle />);
    expect(screen.getByTestId('queryPanelFooterLanguageToggle')).toHaveTextContent('PromQL');
  });

  it('switches to prompt mode when AI is clicked', () => {
    (useQueryBuilderState as jest.Mock).mockReturnValue(
      buildQueryBuilderState({ promptModeIsAvailable: true })
    );
    render(<LanguageToggle />);
    openPopover();
    fireEvent.click(screen.getByTestId('queryPanelFooterLanguageToggle-AI'));
    expect(mockSwitchEditorMode).toHaveBeenCalledWith(EditorMode.Prompt);
    expect(mockUpdateQueryEditorState).not.toHaveBeenCalled();
    expect(mockUpdateQueryState).not.toHaveBeenCalled();
  });

  it('focuses editor after language switch', async () => {
    render(<LanguageToggle />);
    openPopover();
    fireEvent.click(screen.getByTestId('queryPanelFooterLanguageToggle-PromQL'));
    await waitFor(() => jest.advanceTimersByTime(100));
    expect(mockFocusEditor).toHaveBeenCalledWith(true);
  });
});
