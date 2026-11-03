import { useEffect } from 'react';
export const useClickOutside = (callback: () => Promise<void>) => {
  const handleClick = (event: MouseEvent) => {
    const selector = document.querySelector('#add-edit-modal');
    const copilotkit = document.querySelector('.copilotKitPopup');
    const emoji = document.querySelector('.EmojiPickerReact');
    if (
      !selector?.contains(event.target as HTMLElement) &&
      !copilotkit?.contains(event.target as HTMLElement) &&
      !emoji
    ) {
      callback();
    }
  };
  useEffect(() => {
    document
      .querySelector<HTMLElement>('.mantine-Modal-root')
      ?.addEventListener('click', handleClick);
    return () => {
      document
        .querySelector<HTMLElement>('.mantine-Modal-root')
        ?.removeEventListener('click', handleClick);
    };
  });
};
