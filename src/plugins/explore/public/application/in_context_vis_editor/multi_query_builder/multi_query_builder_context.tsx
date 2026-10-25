/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { MultiQueryBuilder } from './multi_query_builder';
import { getServices as getExploreServices } from '../../../services/services';

const MultiQueryBuilderContext = createContext<MultiQueryBuilder | undefined>(undefined);

export const MultiQueryBuilderProvider = ({ children }: { children: ReactNode }) => {
  const [builder, setBuilder] = useState<MultiQueryBuilder | undefined>(undefined);

  // useEffect(() => {
  //   const newBuilder = new MultiQueryBuilder(getExploreServices);
  //   setBuilder(newBuilder);
  //   return () => {
  //     console.log('dispose container');
  //     newBuilder.dispose();
  //   };
  // }, []);

  useEffect(() => {
    const newBuilder = new MultiQueryBuilder(getExploreServices);
    setBuilder(newBuilder);
    // TODO remove: debug handle for verifying seriesResult$ in the console
    (window as any).__mqb = newBuilder;
    return () => {
      newBuilder.dispose();
    };
  }, []);

  if (!builder) return null;

  return (
    <MultiQueryBuilderContext.Provider value={builder}>
      {children}
    </MultiQueryBuilderContext.Provider>
  );
};

export const useMultiQueryBuilder = () => {
  const builder = useContext(MultiQueryBuilderContext);
  if (!builder) {
    throw new Error('useMultiQueryBuilder must be used within a MultiQueryBuilderProvider');
  }
  return builder;
};
