/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DatasetSelectWidget } from './dataset_select';
import { useQueryBuilderState } from '../hooks/use_query_builder_state';
import { useEditorOperations } from '../hooks/use_editor_operations';
import { useOpenSearchDashboards } from '../../../../../opensearch_dashboards_react/public';

const mockUpdateQueryState = jest.fn();
const mockUpdateQueryEditorState = jest.fn();
const mockGetInitialQueryByDataset = jest.fn();
const mockClearEditor = jest.fn();
const mockSetEditorText = jest.fn();
const mockResetEditorMode = jest.fn();
const mockGetInitialQueryString = jest.fn();
const mockSetQuery = jest.fn();
const mockGetQuery = jest.fn();
const mockCacheDataset = jest.fn();
const mockToastAddError = jest.fn();
const mockToastAddWarning = jest.fn();

let capturedSupportedTypes: string[];
let capturedSignalType: string | string[];

jest.mock('../hooks/use_query_builder_state', () => ({
  useQueryBuilderState: jest.fn(),
}));
jest.mock('../hooks/use_editor_operations', () => ({
  useEditorOperations: jest.fn(),
}));
jest.mock('../query_builder/query_builder', () => ({
  SupportLanguageType: { ppl: 'PPL', promQL: 'PROMQL', ai: 'AI' },
}));
const mockResolveDatasetLanguage = jest.fn();
jest.mock('../query_builder/utils', () => ({
  getRequiredSignalType: jest.fn((lang) => (lang === 'PROMQL' ? 'metrics' : ['logs', 'traces'])),
  resolveDatasetLanguage: (...args: unknown[]) => mockResolveDatasetLanguage(...args),
  getInitialQueryString: (...args: unknown[]) => mockGetInitialQueryString(...args),
}));
jest.mock('../../../../../opensearch_dashboards_react/public', () => ({
  useOpenSearchDashboards: jest.fn(),
}));
jest.mock('../visualization_editor.scss', () => ({}), { virtual: true });

const buildServices = (overrides: Record<string, any> = {}) => ({
  data: {
    ui: {
      DatasetSelect: ({ onSelect, supportedTypes, signalType }: any) => {
        capturedSupportedTypes = supportedTypes;
        capturedSignalType = signalType;
        return (
          <div data-test-subj="dataset-select">
            <button
              data-test-subj="select-btn"
              onClick={() => onSelect({ id: 'ds1', type: 'INDEX_PATTERN' })}
            >
              Select
            </button>
            <button data-test-subj="clear-btn" onClick={() => onSelect(undefined)}>
              Clear
            </button>
          </div>
        );
      },
    },
    query: {
      queryString: {
        getQuery: mockGetQuery,
        setQuery: mockSetQuery,
        getInitialQueryByDataset: mockGetInitialQueryByDataset,
        getQueryHistory: jest.fn(() => [
          { query: 'source = table1 | head 10', language: 'PPL' },
          { query: 'source = table2 | head 10', language: 'PPL' },
        ]),
        getDatasetService: () => ({
          cacheDataset: mockCacheDataset,
          // Prometheus is a registered dataset type in these tests.
          getType: jest.fn(() => ({ id: 'PROMETHEUS' })),
        }),
      },
    },
  },
  notifications: {
    toasts: {
      addError: mockToastAddError,
      addWarning: mockToastAddWarning,
    },
  },
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetInitialQueryByDataset.mockReturnValue({ query: '', language: 'PPL', dataset: undefined });
  mockResolveDatasetLanguage.mockReturnValue('PPL');
  mockGetInitialQueryString.mockReturnValue('');

  (useOpenSearchDashboards as jest.Mock).mockReturnValue({ services: buildServices() });

  (useQueryBuilderState as jest.Mock).mockReturnValue({
    queryState: { query: '', language: 'PPL', dataset: undefined },
    queryEditorState: {},
    queryBuilder: {
      updateQueryState: mockUpdateQueryState,
      updateQueryEditorState: mockUpdateQueryEditorState,
    },
  });
  (useEditorOperations as jest.Mock).mockReturnValue({
    clearEditor: mockClearEditor,
    setEditorText: mockSetEditorText,
    resetEditorMode: mockResetEditorMode,
  });
});

describe('DatasetSelectWidget', () => {
  it('renders DatasetSelect', () => {
    render(<DatasetSelectWidget />);
    expect(screen.getByTestId('dataset-select')).toBeInTheDocument();
  });

  it('handles dataset selection correctly', async () => {
    render(<DatasetSelectWidget />);

    mockGetInitialQueryString.mockReturnValue('SELECT * FROM ds1');
    fireEvent.click(screen.getByTestId('select-btn'));
    await waitFor(() => {
      expect(mockGetInitialQueryString).toHaveBeenCalledWith(
        expect.anything(),
        { id: 'ds1', type: 'INDEX_PATTERN' },
        'PPL'
      );
      expect(mockUpdateQueryState).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'SELECT * FROM ds1',
          dataset: { id: 'ds1', type: 'INDEX_PATTERN' },
        })
      );
      expect(mockUpdateQueryEditorState).toHaveBeenCalledWith({ isQueryEditorDirty: true });
      // The new query is written into the editor even when the string didn't change.
      expect(mockSetEditorText).toHaveBeenCalledWith('SELECT * FROM ds1');
      expect(mockResetEditorMode).toHaveBeenCalled();
    });
  });

  // The dataset decides the language, so the picker offers every type whatever the language.
  it('passes all dataset types, including PROMETHEUS, for PPL', () => {
    render(<DatasetSelectWidget />);
    expect(capturedSupportedTypes).toEqual(['INDEXES', 'INDEX_PATTERN', 'PROMETHEUS']);
  });

  it('passes the same dataset types for PromQL', () => {
    (useQueryBuilderState as jest.Mock).mockReturnValue({
      queryState: { query: '', language: 'PROMQL', dataset: undefined },
      queryEditorState: {},
      queryBuilder: {
        updateQueryState: mockUpdateQueryState,
        updateQueryEditorState: mockUpdateQueryEditorState,
      },
    });

    render(<DatasetSelectWidget />);
    expect(capturedSupportedTypes).toEqual(['INDEXES', 'INDEX_PATTERN', 'PROMETHEUS']);
  });

  it('passes logs, traces and metrics signal types', () => {
    render(<DatasetSelectWidget />);
    expect(capturedSignalType).toEqual(['logs', 'traces', 'metrics']);
  });

  it('switches to a language the dataset can run when it carries none', async () => {
    // getInitialQueryByDataset kept the current language (PPL) for a dataset without one.
    mockResolveDatasetLanguage.mockReturnValue('PROMQL');
    render(<DatasetSelectWidget />);
    fireEvent.click(screen.getByTestId('select-btn'));
    await waitFor(() => {
      // The current language is no longer preferred: the dataset alone decides.
      expect(mockResolveDatasetLanguage).toHaveBeenCalledWith(expect.anything(), {
        id: 'ds1',
        type: 'INDEX_PATTERN',
      });
      expect(mockUpdateQueryState).toHaveBeenCalledWith(
        expect.objectContaining({ language: 'PROMQL' })
      );
    });
  });

  it('clears the previous language query options on dataset selection', async () => {
    render(<DatasetSelectWidget />);
    fireEvent.click(screen.getByTestId('select-btn'));
    await waitFor(() => {
      expect(mockUpdateQueryState).toHaveBeenCalledWith(
        expect.objectContaining({ queryOptions: undefined })
      );
    });
  });
});
