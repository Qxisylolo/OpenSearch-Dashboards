/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen } from '@testing-library/react';
import { FieldSelector } from './field_selector';
import { VisFieldType } from '../visualizations/types';

const fields = [
  { name: 'host', visFieldType: VisFieldType.Categorical },
  { name: 'bytes', visFieldType: VisFieldType.Numerical },
];

describe('FieldSelector missing fields', () => {
  it('shows the missing field under a single selection', () => {
    render(<FieldSelector configField="status" availableFields={fields} />);
    expect(screen.getByText('Missing field: status')).toBeInTheDocument();
  });

  it('lists every missing field of a multi selection', () => {
    render(
      <FieldSelector supportMulti configFields={['host', 'a', 'b']} availableFields={fields} />
    );
    expect(screen.getByText('Missing fields: a, b')).toBeInTheDocument();
  });

  it('shows nothing when the selection is available', () => {
    render(<FieldSelector configField="host" availableFields={fields} />);
    expect(screen.queryByText(/Missing field/)).not.toBeInTheDocument();
  });

  it('does not judge before any field is known', () => {
    render(<FieldSelector configField="status" availableFields={[]} />);
    expect(screen.queryByText(/Missing field/)).not.toBeInTheDocument();
  });
});
