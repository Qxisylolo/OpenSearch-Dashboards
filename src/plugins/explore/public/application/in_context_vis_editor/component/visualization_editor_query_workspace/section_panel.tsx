/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ReactNode } from 'react';
import { EuiFlexGroup, EuiFlexItem, EuiIcon, EuiPanel, EuiText } from '@elastic/eui';

export interface SectionPanelProps {
  title?: string;
  subtitle?: string;
  iconType?: string;
  children: ReactNode;
}

export const SectionPanel = ({ title, subtitle, iconType, children }: SectionPanelProps) => {
  return (
    <EuiPanel
      paddingSize="none"
      hasBorder={false}
      hasShadow={false}
      borderRadius="none"
      className="queryWorkspaceDetail"
      data-test-subj="sectionPanel"
    >
      {title && (
        <div className="queryWorkspaceDetail__header">
          <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
            {iconType && (
              <EuiFlexItem grow={false}>
                <EuiIcon type={iconType} />
              </EuiFlexItem>
            )}
            <EuiFlexItem grow={false}>
              <EuiText size="s">
                <strong>{title}</strong>
              </EuiText>
            </EuiFlexItem>
            {subtitle && (
              <>
                <EuiFlexItem grow={false}>
                  <div className="queryWorkspaceDetail__divider" />
                </EuiFlexItem>
                <EuiFlexItem>
                  <EuiText size="s" color="subdued">
                    {subtitle}
                  </EuiText>
                </EuiFlexItem>
              </>
            )}
          </EuiFlexGroup>
        </div>
      )}
      <div className="queryWorkspaceDetail__content">{children}</div>
    </EuiPanel>
  );
};
