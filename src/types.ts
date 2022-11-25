export type Nullish = null | undefined;

/** 
 * return the type of `Object.assign(T, U)`
 * 
 * @example 
 *   Spread<{ a: 123, c: number }, { a: boolean, b: string }>
 *    == { a: boolean; c: number; b: string }
 */
export type Spread<T, U> =
  T extends Nullish ? U :
  U extends Nullish ? T :
  { [k in (keyof T | keyof U)]: k extends keyof U ? U[k] : k extends keyof T ? T[k] : never }

// type SpreadTest = Spread<{ a: 123, c: number }, { a: boolean, b: string }>

// export type PartiallyRequired<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>
