/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { isEqual } from 'lodash';
import { toQueriesSnapshot } from './editor_snapshot';

describe('editor snapshot', () => {
  const rows = (dataset: Record<string, unknown>) => ({
    queries: [['A', { query: 'x', language: 'PPL', dataset }]] as any,
    editorState: { rows: [['A', { isHidden: false }]] as any },
  });

  it('compares datasets by what identifies them', () => {
    const saved = toQueriesSnapshot(rows({ id: 'ip', type: 'INDEX_PATTERN', title: 'logs' }));
    const loaded = toQueriesSnapshot(
      rows({ id: 'ip', type: 'INDEX_PATTERN', title: 'logs*', timeFieldName: '@timestamp' })
    );
    expect(isEqual(saved, loaded)).toBe(true);
  });

  it("sees a hidden row and a row's max data points", () => {
    const base = rows({ id: 'ip', type: 'INDEX_PATTERN' });
    const hidden = { ...base, editorState: { rows: [['A', { isHidden: true }]] as any } };
    expect(isEqual(toQueriesSnapshot(base), toQueriesSnapshot(hidden))).toBe(false);
    const [[refId, query]] = base.queries;
    const withMaxDataPoints = {
      ...base,
      queries: [[refId, { ...query, queryOptions: { maxDataPoints: 10 } }]] as any,
    };
    expect(isEqual(toQueriesSnapshot(base), toQueriesSnapshot(withMaxDataPoints))).toBe(false);
  });
});
