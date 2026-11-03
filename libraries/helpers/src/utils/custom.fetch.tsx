'use client';

import {
  createContext,
  FC,
  ReactNode,
  useContext,
  useRef,
  useState,
} from 'react';
import { customFetch, Params } from './custom.fetch.func';
import { useVariables } from '@gitroom/react/helpers/variable.context';

const FetchProvider = createContext(
  customFetch(
    {
      baseUrl: '',
      beforeRequest: async () => undefined,
      afterRequest: async () => {
        return true;
      },
    }
  )
);

export const FetchWrapperComponent: FC<Params & { children: ReactNode }> = (
  props
) => {
  const { children, ...params } = props;
  const { isSecured } = useVariables();
  const fetchData = useRef(
    customFetch(params, undefined, undefined, isSecured)
  );
  return (
    <FetchProvider.Provider value={fetchData.current}>
      {children}
    </FetchProvider.Provider>
  );
};

export const useFetch = () => {
  return useContext(FetchProvider);
};
