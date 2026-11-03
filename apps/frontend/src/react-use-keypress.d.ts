declare module 'react-use-keypress' {
  const useKeypress: (
    keys: string | string[],
    handler?: (event: KeyboardEvent) => void
  ) => void;
  export default useKeypress;
}
