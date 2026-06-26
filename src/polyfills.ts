// web_pen_sdk is a webpack CommonJS bundle that references the Node `global`
// identifier at runtime. Define it as a property of the global object before the
// SDK is evaluated. Imported first in main.ts (ES module imports are evaluated in
// source order), so this runs before web_pen_sdk is pulled in transitively.
const g = globalThis as unknown as { global?: unknown };
if (g.global === undefined) {
  g.global = globalThis;
}

export {};
