declare type Optional<T> = T | null | undefined;
declare type List<T> = ArrayLike<T>;
declare type Many<T> = T | readonly T[];
declare type EmptyObject = Record<string, never>;

declare interface Dictionary<T> {
  [index: string]: T;
}

declare interface NumericDictionary<T> {
  [index: number]: T;
}

declare type AnyDictionary<T> = Dictionary<T> | NumericDictionary<T>;

// declare module 'got' {
//   import * as got from 'got/dist/source';
//   export = got;
// }

declare module '*.scss' {}
