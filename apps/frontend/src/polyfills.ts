// Globals the app relied on Next.js to provide. Imported first by main.tsx so
// they exist before any other module, lazy route chunks included, evaluates.

// Decorated DTOs and provider classes call Reflect.getMetadata as soon as
// their module loads.
import 'reflect-metadata';
import { Buffer } from 'buffer';

// Code here and in the wallet libraries calls Buffer like in Node.
globalThis.Buffer = globalThis.Buffer ?? Buffer;
