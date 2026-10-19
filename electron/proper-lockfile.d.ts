declare module 'proper-lockfile' {
  export function lock(
    file: string,
    options: {
      realpath: boolean;
      retries: { retries: number; minTimeout: number; maxTimeout: number };
    },
  ): Promise<() => Promise<void>>;
}
