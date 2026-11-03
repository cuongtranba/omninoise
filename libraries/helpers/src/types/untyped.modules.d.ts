// Type declarations for package entry points that ship none, or that
// `moduleResolution: node` cannot see. The tsconfig.json of apps/backend,
// apps/orchestrator, apps/commands and apps/frontend lists this file in its
// include, so their type checks pick it up.

declare module 'evp_bytestokey' {
  export default function EVP_BytesToKey(
    password: string | Buffer,
    salt: Buffer | null,
    keyBits: number,
    ivLen: number
  ): { key: Buffer; iv: Buffer };
}

// class-transformer ships types for its storage only under types/, not next
// to the cjs build that class-validator-jsonschema needs to share.
declare module 'class-transformer/cjs/storage' {
  export { defaultMetadataStorage } from 'class-transformer/types/storage';
}

declare module 'react-use-keypress' {
  const useKeypress: (
    keys: string | string[],
    handler?: (event: KeyboardEvent) => void
  ) => void;
  export default useKeypress;
}

// vite-plus/test is only reachable through the package's exports map, which
// `moduleResolution: node` ignores. It re-exports Vitest, which it bundles.
declare module 'vite-plus/test' {
  export * from 'vitest';
}
