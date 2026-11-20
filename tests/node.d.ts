declare module "node:test" {
  const test: (name: string, fn: () => void | Promise<void>) => void;
  export default test;
}

declare module "node:assert/strict" {
  const assert: {
    equal: (a: unknown, b: unknown, message?: string) => void;
    deepEqual: (a: unknown, b: unknown, message?: string) => void;
    ok: (value: unknown, message?: string) => void;
  };
  export default assert;
}
