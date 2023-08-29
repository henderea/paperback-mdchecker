declare type Optional<T> = T | null | undefined;
declare type List<T> = ArrayLike<T>;
declare type Many<T> = T | ReadonlyArray<T>;
declare type EmptyObject = Record<string, never>;

declare interface Dictionary<T> {
  [index: string]: T;
}
