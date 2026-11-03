// Type declarations for package entry points that ship none. tsconfig.base.json
// lists this file, so every app's type check includes it.

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
