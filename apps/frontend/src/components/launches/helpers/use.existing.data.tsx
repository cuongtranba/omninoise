import { createContext, FC, ReactNode, useContext } from 'react';
import { Post } from '@prisma/client';
// a post as the group endpoint returns it: the stored media is already parsed
// and the tags come with it
export type ExistingPost = Omit<Post, 'image'> & {
  image: { id: string; path: string }[];
  tags?: { tag: { name: string } }[];
};
const ExistingDataContext = createContext({
  integration: '',
  group: undefined as undefined | string,
  posts: [] as ExistingPost[],
  settings: {} as any,
  // the other channels the post was created with
  siblings: undefined as
    | undefined
    | {
        integration: string;
        group: string;
        posts: ExistingPost[];
        settings: any;
      }[],
});
export const ExistingDataContextProvider: FC<{
  children: ReactNode;
  value: any;
}> = ({ children, value }) => {
  return (
    <ExistingDataContext.Provider value={value}>
      {children}
    </ExistingDataContext.Provider>
  );
};
export const useExistingData = () => useContext(ExistingDataContext);
