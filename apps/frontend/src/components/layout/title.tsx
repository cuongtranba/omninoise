'use client';

import { useLocation } from 'react-router';
import { useMenuItem } from '@gitroom/frontend/components/layout/top.menu';
export const Title = () => {
  const path = useLocation().pathname;
  const { all: menuItems } = useMenuItem();
  // Read on every render: the menu names are translated, so a memo keyed on
  // the path alone kept the old language after a language switch.
  const currentTitle = menuItems.find(
    (item) => path.indexOf(item.path) > -1
  )?.name;

  return <h1 className="truncate">{currentTitle}</h1>;
};
