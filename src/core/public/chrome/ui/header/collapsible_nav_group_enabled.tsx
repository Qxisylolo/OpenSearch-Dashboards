/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import './collapsible_nav_group_enabled.scss';
import { EuiFlyout, EuiPanel, EuiHorizontalRule, EuiSpacer } from '@elastic/eui';
import { i18n } from '@osd/i18n';
import React, { useMemo } from 'react';
import useObservable from 'react-use/lib/useObservable';
import * as Rx from 'rxjs';
import classNames from 'classnames';
import { WorkspacesStart } from 'src/core/public/workspace';
import { ChromeNavControl, ChromeNavLink } from '../..';
import { AppCategory, NavGroupType } from '../../../../types';
import { InternalApplicationStart } from '../../../application/types';
import { HttpStart } from '../../../http';
import { OnIsLockedUpdate } from './';
import { createEuiListItem } from './nav_link';
import type { Logos } from '../../../../common/types';
import {
  ChromeNavGroupServiceStartContract,
  ChromeRegistrationNavLink,
  NavGroupItemInMap,
} from '../../nav_group';
import { fulfillRegistrationLinksToChromeNavLinks, getVisibleUseCases, sortBy } from '../../utils';
import { ALL_USE_CASE_ID, DEFAULT_APP_CATEGORIES } from '../../../../../core/utils';
import { CollapsibleNavTop } from './collapsible_nav_group_enabled_top';
import { HeaderNavControls } from './header_nav_controls';
import { NavGroups } from './collapsible_nav_groups';

export interface CollapsibleNavGroupEnabledProps {
  appId$: InternalApplicationStart['currentAppId$'];
  collapsibleNavHeaderRender?: () => JSX.Element | null;
  basePath: HttpStart['basePath'];
  id: string;
  isLocked: boolean;
  isNavOpen: boolean;
  navLinks$: Rx.Observable<ChromeNavLink[]>;
  storage?: Storage;
  onIsLockedUpdate: OnIsLockedUpdate;
  closeNav: () => void;
  navigateToApp: InternalApplicationStart['navigateToApp'];
  navigateToUrl: InternalApplicationStart['navigateToUrl'];
  customNavLink$: Rx.Observable<ChromeNavLink | undefined>;
  logos: Logos;
  navGroupsMap$: Rx.Observable<Record<string, NavGroupItemInMap>>;
  navControlsLeftBottom$: Rx.Observable<readonly ChromeNavControl[]>;
  currentNavGroup$: Rx.Observable<NavGroupItemInMap | undefined>;
  setCurrentNavGroup: ChromeNavGroupServiceStartContract['setCurrentNavGroup'];
  capabilities: InternalApplicationStart['capabilities'];
  currentWorkspace$: WorkspacesStart['currentWorkspace$'];
}

const titleForSeeAll = i18n.translate('core.ui.primaryNav.seeAllLabel', {
  defaultMessage: 'See all...',
});

// Custom category is used for those features not belong to any of use cases in all use case.
// and the custom category should always sit after manage category
const customCategory: AppCategory = {
  id: 'custom',
  label: i18n.translate('core.ui.customNavList.label', { defaultMessage: 'Custom' }),
  order: (DEFAULT_APP_CATEGORIES.manage.order || 0) + 500,
};

enum NavWidth {
  Expanded = 270,
  Collapsed = 48, // The Collasped width is supposed to be aligned with the hamburger icon on the top left navigation.
}

export function CollapsibleNavGroupEnabled({
  basePath,
  id,
  isLocked,
  isNavOpen,
  storage = window.localStorage,
  onIsLockedUpdate,
  closeNav,
  navigateToApp,
  navigateToUrl,
  logos,
  setCurrentNavGroup,
  capabilities,
  collapsibleNavHeaderRender,
  ...observables
}: CollapsibleNavGroupEnabledProps) {
  const allNavLinks = useObservable(observables.navLinks$, []);
  const navLinks = allNavLinks.filter((link) => !link.hidden);
  const homeLink = useMemo(() => allNavLinks.find((item) => item.id === 'home'), [allNavLinks]);
  const appId = useObservable(observables.appId$, '');
  const navGroupsMap = useObservable(observables.navGroupsMap$, {});
  const currentNavGroup = useObservable(observables.currentNavGroup$, undefined);
  const firstVisibleNavLinkOfAllUseCase = useMemo(
    () =>
      fulfillRegistrationLinksToChromeNavLinks(
        navGroupsMap[ALL_USE_CASE_ID]?.navLinks || [],
        navLinks
      )[0],
    [navGroupsMap, navLinks]
  );

  const visibleUseCases = useMemo(() => getVisibleUseCases(navGroupsMap), [navGroupsMap]);

  const currentNavGroupId = useMemo(() => {
    if (!currentNavGroup) {
      if (visibleUseCases.length === 1) {
        return visibleUseCases[0].id;
      }

      if (!capabilities.workspaces.enabled) {
        return ALL_USE_CASE_ID;
      }
    }

    return currentNavGroup?.id;
  }, [capabilities, currentNavGroup, visibleUseCases]);

  const shouldAppendManageCategory = capabilities.workspaces.enabled
    ? !currentNavGroupId
    : currentNavGroupId === ALL_USE_CASE_ID;

  const shouldShowCollapsedNavHeaderContent = useMemo(
    () => isNavOpen && collapsibleNavHeaderRender && !currentNavGroupId,
    [collapsibleNavHeaderRender, isNavOpen, currentNavGroupId]
  );

  const navLinksForRender: ChromeNavLink[] = useMemo(() => {
    const getSystemNavGroups = () => {
      const result: ChromeNavLink[] = [];
      Object.values(navGroupsMap)
        .sort(sortBy('order'))
        .filter((navGroup) => navGroup.type === NavGroupType.SYSTEM)
        .forEach((navGroup) => {
          const visibleNavLinksWithinNavGroup = fulfillRegistrationLinksToChromeNavLinks(
            navGroup.navLinks,
            navLinks
          );
          if (visibleNavLinksWithinNavGroup[0]) {
            result.push({
              ...visibleNavLinksWithinNavGroup[0],
              title: navGroup.title,
              category: DEFAULT_APP_CATEGORIES.manage,
            });
          }
        });

      return result;
    };

    const navLinksResult: ChromeRegistrationNavLink[] = [];

    if (currentNavGroupId && currentNavGroupId !== ALL_USE_CASE_ID) {
      navLinksResult.push(...(navGroupsMap[currentNavGroupId].navLinks || []));
    }

    if (currentNavGroupId === ALL_USE_CASE_ID) {
      // Append all the links that do not have use case info to keep backward compatible
      const linkIdsWithUseGroupInfo = Object.values(navGroupsMap).reduce((total, navGroup) => {
        return [...total, ...navGroup.navLinks.map((navLink) => navLink.id)];
      }, [] as string[]);
      navLinks
        .filter((link) => !linkIdsWithUseGroupInfo.includes(link.id))
        .forEach((navLink) => {
          navLinksResult.push({
            ...navLink,
            category: customCategory,
          });
        });

      // Append all the links registered to all use case
      navGroupsMap[ALL_USE_CASE_ID]?.navLinks.forEach((navLink) => {
        navLinksResult.push(navLink);
      });

      // Append use case section into left navigation
      Object.values(navGroupsMap)
        .filter((group) => !group.type)
        .forEach((group) => {
          const categoryInfo = {
            id: group.id,
            label: group.title,
            order: group.order,
          };

          const fulfilledLinksOfNavGroup = fulfillRegistrationLinksToChromeNavLinks(
            group.navLinks,
            navLinks
          );

          const linksForAllUseCaseWithinNavGroup = fulfilledLinksOfNavGroup
            .filter((navLink) => navLink.showInAllNavGroup)
            .map((navLink) => ({
              ...navLink,
              category: categoryInfo,
            }));

          navLinksResult.push(...linksForAllUseCaseWithinNavGroup);

          if (linksForAllUseCaseWithinNavGroup.length) {
            navLinksResult.push({
              id: fulfilledLinksOfNavGroup[0].id,
              title: titleForSeeAll,
              order: Number.MAX_SAFE_INTEGER,
              category: categoryInfo,
            });
          } else {
            /**
             * Find if there are any links inside a use case but without a `see all` entry.
             * If so, append these features into custom category as a fallback
             */
            fulfillRegistrationLinksToChromeNavLinks(group.navLinks, navLinks)
              // Filter out links that already exists in all use case
              .filter(
                (navLink) => !navLinksResult.find((navLinkInAll) => navLinkInAll.id === navLink.id)
              )
              .forEach((navLink) => {
                navLinksResult.push({
                  ...navLink,
                  category: customCategory,
                });
              });
          }
        });
    }

    if (shouldAppendManageCategory) {
      navLinksResult.push(...getSystemNavGroups());
    }

    return fulfillRegistrationLinksToChromeNavLinks(navLinksResult, navLinks);
  }, [
    navLinks,
    navGroupsMap,
    currentNavGroupId,
    shouldAppendManageCategory,
  ]);

  const width = useMemo(() => {
    if (!isNavOpen) {
      return NavWidth.Collapsed;
    }

    return NavWidth.Expanded;
  }, [isNavOpen]);

  const onGroupClick = (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>,
    group: NavGroupItemInMap
  ) => {
    const fulfilledLinks = fulfillRegistrationLinksToChromeNavLinks(
      navGroupsMap[group.id]?.navLinks,
      navLinks
    );
    setCurrentNavGroup(group.id);

    // the `navGroupsMap[group.id]?.navLinks` has already been sorted
    const firstLink = fulfilledLinks[0];
    if (firstLink) {
      const propsForEui = createEuiListItem({
        link: firstLink,
        appId,
        dataTestSubj: 'collapsibleNavAppLink',
        navigateToApp,
      });
      propsForEui.onClick(e);
    }
  };

  return (
    <EuiFlyout
      data-test-subj="collapsibleNav"
      id={id}
      side="left"
      aria-label={i18n.translate('core.ui.primaryNav.screenReaderLabel', {
        defaultMessage: 'Primary',
      })}
      type="push"
      onClose={closeNav}
      outsideClickCloses={false}
      className="context-nav-wrapper"
      size={width}
      closeButtonPosition="outside"
      hideCloseButton
      paddingSize="none"
      ownFocus={false}
    >
      <div className="eui-fullHeight left-navigation-wrapper">
        {!isNavOpen ? null : (
          <EuiPanel
            hasBorder={false}
            borderRadius="none"
            paddingSize={!isNavOpen ? 's' : 'l'}
            hasShadow={false}
            style={{ flexGrow: 0, paddingBottom: 0 }}
          >
            <CollapsibleNavTop
              homeLink={homeLink}
              firstVisibleNavLinkOfAllUseCase={firstVisibleNavLinkOfAllUseCase}
              navigateToApp={navigateToApp}
              logos={logos}
              setCurrentNavGroup={setCurrentNavGroup}
              currentNavGroup={currentNavGroupId ? navGroupsMap[currentNavGroupId] : undefined}
              shouldShrinkNavigation={!isNavOpen}
              onClickShrink={closeNav}
              visibleUseCases={visibleUseCases}
              currentWorkspace$={observables.currentWorkspace$}
            />
          </EuiPanel>
        )}
        {!isNavOpen ? null : (
          <EuiPanel
            hasBorder={false}
            borderRadius="none"
            paddingSize={!isNavOpen ? 's' : 'l'}
            hasShadow={false}
            className="eui-yScroll flex-1-container"
          >
            {shouldShowCollapsedNavHeaderContent && collapsibleNavHeaderRender ? (
              <>
                {collapsibleNavHeaderRender()}
                <EuiSpacer size="l" />
              </>
            ) : null}
            <NavGroups
              navLinks={navLinksForRender}
              navigateToApp={navigateToApp}
              onNavItemClick={(event, navItem) => {
                if (navItem.title === titleForSeeAll && navItem.category?.id) {
                  const navGroup = navGroupsMap[navItem.category.id];
                  onGroupClick(event, navGroup);
                }
              }}
              appId={appId}
            />
          </EuiPanel>
        )}
        {
          // This element is used to push icons to the bottom of left navigation when collapsed
          !isNavOpen ? <div className="flex-1-container" /> : null
        }
        <EuiHorizontalRule margin="none" />
        <div
          className={classNames({
            'bottom-container': true,
            'bottom-container-collapsed': !isNavOpen,
            'bottom-container-expanded': isNavOpen,
          })}
        >
          <HeaderNavControls
            navControls$={observables.navControlsLeftBottom$}
            className={classNames({ 'nav-controls-padding': isNavOpen })}
          />
        </div>
      </div>
    </EuiFlyout>
  );
}
