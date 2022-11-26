export type Nil = null | undefined;

export type KeyOf<T> = string & keyof T

/** 
 * return the type of `Object.assign(T, U)`
 * 
 * @example 
 *   Spread<{ a: 123, c: number }, { a: boolean, b: string }>
 *    == { a: boolean; c: number; b: string }
 */
export type Spread<T, U> = (Omit<T, keyof U> & U)
  // { [k in (keyof T | keyof U)]: k extends keyof U ? U[k] : k extends keyof T ? T[k] : never }

// type SpreadTest = Spread<{ a: 123, c: number }, { a: boolean, b: string }>

// export type PartiallyRequired<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>
