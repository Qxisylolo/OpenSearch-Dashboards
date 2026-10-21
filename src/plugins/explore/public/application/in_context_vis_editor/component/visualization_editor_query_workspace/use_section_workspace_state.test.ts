/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook } from '@testing-library/react';
import { BehaviorSubject } from 'rxjs';
import {
  QueryRowItem,
  UseSectionWorkspaceStateParams,
  useSectionWorkspaceState,
} from './use_section_workspace_state';
import {
  TransformationInstance,
  TransformationService,
} from '../../../../components/data_transformations';

const makeInstance = (id: string, definitionId = 'sort_by'): TransformationInstance =>
  ({
    instance_id: id,
    definition_id: definitionId,
    config: {},
    hide: false,
  }) as unknown as TransformationInstance;

const makeService = (pipeline: TransformationInstance[]) => {
  const pipeline$ = new BehaviorSubject<TransformationInstance[]>(pipeline);
  return {
    pipeline$,
    getDefinition: jest.fn((id: string) => ({ label: `Label ${id}`, iconType: 'sortable' })),
    setPipeline: jest.fn((next: TransformationInstance[]) => pipeline$.next(next)),
  } as unknown as TransformationService & { setPipeline: jest.Mock };
};

const setup = (overrides: Partial<UseSectionWorkspaceStateParams> = {}) => {
  const transformPipeline = overrides.transformPipeline ?? [makeInstance('t1'), makeInstance('t2')];
  const transformationService = overrides.transformationService ?? makeService(transformPipeline);
  const initialProps: UseSectionWorkspaceStateParams = {
    queryRows: [{ refId: 'A' }],
    transformPipeline,
    transformationService,
    ...overrides,
  };
  const hook = renderHook(
    (props: UseSectionWorkspaceStateParams) => useSectionWorkspaceState(props),
    {
      initialProps,
    }
  );
  return { ...hook, initialProps, transformationService };
};

describe('useSectionWorkspaceState', () => {
  it('falls back to the first query when nothing is selected', () => {
    const { result } = setup();
    expect(result.current.active).toEqual({ currentActive: 'query', activeItemId: 'A' });
  });

  it('returns none only when there are no queries and no transformations', () => {
    const { result } = setup({ queryRows: [], transformPipeline: [] });
    expect(result.current.active).toEqual({ currentActive: 'none' });
  });

  it('falls back to the first transformation when there are no query rows', () => {
    const { result } = setup({ queryRows: [] });
    expect(result.current.active).toEqual({ currentActive: 'transformation', activeItemId: 't1' });
  });

  it('selects a transformation and falls back to the first query once it is removed', () => {
    const { result, rerender, initialProps } = setup();

    act(() => result.current.onSelectItem('t2'));
    expect(result.current.active).toEqual({ currentActive: 'transformation', activeItemId: 't2' });

    rerender({ ...initialProps, transformPipeline: [makeInstance('t1')] });
    expect(result.current.active).toEqual({ currentActive: 'query', activeItemId: 'A' });
  });

  it('notifies onSelectQuery only for query rows', () => {
    const onSelectQuery = jest.fn();
    const { result } = setup({ onSelectQuery });

    act(() => result.current.onSelectItem('t1'));
    expect(onSelectQuery).not.toHaveBeenCalled();

    act(() => result.current.onSelectItem('A'));
    expect(onSelectQuery).toHaveBeenCalledWith('A');
  });

  it('reflects isHidden from the passed-in rows', () => {
    const { result, rerender, initialProps } = setup();
    expect(result.current.sections[0].items[0].isHidden).toBe(false);

    const hiddenRows: QueryRowItem[] = [{ refId: 'A', isHidden: true }];
    rerender({ ...initialProps, queryRows: hiddenRows });
    expect(result.current.sections[0].items[0].isHidden).toBe(true);
  });

  it('only makes queries draggable with a reorder handler and more than one row', () => {
    const onReorder = jest.fn();

    expect(setup().result.current.sections[0].draggable).toBe(false);
    expect(setup({ queryHandlers: { onReorder } }).result.current.sections[0].draggable).toBe(
      false
    );
    expect(
      setup({
        queryRows: [{ refId: 'A' }, { refId: 'B' }],
        queryHandlers: { onReorder },
      }).result.current.sections[0].draggable
    ).toBe(true);
  });

  it('reorders transformations from the latest pipeline, not the render-time one', () => {
    const { result, transformationService } = setup();
    // Pipeline changes after render without a rerender.
    const latest = [makeInstance('t1'), makeInstance('t2'), makeInstance('t3')];
    transformationService.pipeline$.next(latest);

    act(() => result.current.sections[1].onReorder?.(2, 0));
    expect(transformationService.setPipeline).toHaveBeenCalledWith([
      latest[2],
      latest[0],
      latest[1],
    ]);
  });

  it('labels transformations from their definitions', () => {
    const { result } = setup();
    expect(result.current.sections[1].items[0]).toMatchObject({
      id: 't1',
      label: 'Label sort_by',
      iconType: 'sortable',
    });
  });

  describe('isValid', () => {
    const step = (status: string, codes: string[] = []) =>
      ({
        instanceId: 'x',
        definitionId: 'sort_by',
        status,
        issues: codes.map((code) => ({ code, message: code })),
      }) as any;

    it('passes query row validity through', () => {
      const { result } = setup({ queryRows: [{ refId: 'A', isValid: false }] });
      expect(result.current.sections[0].items[0].isValid).toBe(false);
    });

    it('flags failed and missing-field steps, but not unconfigured ones', () => {
      const { result } = setup({
        transformPipeline: [makeInstance('t1'), makeInstance('t2'), makeInstance('t3')],
        transformStepResults: new Map([
          ['t1', step('failed', ['execution_error'])],
          ['t2', step('skipped', ['missing_fields'])],
          ['t3', step('skipped', ['invalid_config'])],
        ]),
      });
      expect(result.current.sections[1].items.map((item) => item.isValid)).toEqual([
        false,
        false,
        true,
      ]);
    });

    it('treats steps without a result as valid', () => {
      const { result } = setup();
      expect(result.current.sections[1].items.every((item) => item.isValid)).toBe(true);
    });
  });
});
