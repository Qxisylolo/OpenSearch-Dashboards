/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ReactNode } from 'react';

export interface SectionItem {
  id: string;
  label: string;
  iconType?: string;
  isHidden?: boolean;
  isValid?: boolean;
  showStepWarning?: boolean;
}

/**
 * One section (group) in the rail. The rail can render N of these stacked.
 * `queries` and `transformations` are two instances of this same shape.
 */
export interface Section {
  id: string;
  title: string;
  items: SectionItem[];
  /** Custom add affordance, used when adding needs its own chooser UI. */
  renderAddAction?: ReactNode;
  /** Renders the section's `+` add affordance when provided. */
  onAdd?: () => void;
  // /** Opt-in drag reorder (transforms: true, queries: false). */
  /** Opt-in drag reorder (transforms: always; queries: only with a reorder handler and >1 row). */
  draggable?: boolean;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  /** Per-row trailing actions (hide / remove). Kept generic so the rail
   *  never needs to know what a query or a transform is. */
  renderItemActions?: (item: SectionItem) => ReactNode;
}
