import { Nil } from "../types";
import type { ScatterNodeInfo } from "./ScatterNodeInfo";

export const makeEmptyLike = (x: any) => {
  if (Array.isArray(x))
    return [];
  return Object.create(Object.getPrototypeOf(x));
};

export const hasOwn = (obj: any, key: any) => Object.prototype.hasOwnProperty.call(obj, key);

export const isPromise = (x: any): x is Promise<any> => !!(x && typeof x === 'object' && typeof x.then === 'function')

export type OneOrMany<T> = Iterable<T> | T | null | undefined
export type Tail<T> = T extends [any, ...infer R] ? R : []

/**
 * - If `input` is null or undefined, an empty array will be returned.
 * - If `input` is a non-array object, a new Array of length 1 will be returned.
 * - If `input` is an array or iterator, an array will be returned.
 */
export function arrayify<T>(input: OneOrMany<T>): T[] {
  // eslint-disable-next-line eqeqeq
  if (input == null) return [];
  if (typeof input === 'object' && (Symbol.iterator in input)) return Array.from(input);
  return [input];
}

export const getValueType = (x: any) => {
  if (x && typeof x === 'object') return Array.isArray(x) ? ValueType.ARRAY : ValueType.OBJECT;
  return ValueType.OTHER
}

export const enum ValueType { OTHER, OBJECT, ARRAY }

export type NodeSelector = Iterable<string> | ((id: string, nodeInfo: ScatterNodeInfo) => boolean)
export const normalizeNodeSelector = (input: NodeSelector | Nil): (nodeInfo: ScatterNodeInfo) => boolean => {
  if (!input) return () => false
  if (typeof input === 'function') return n => input(n.id, n)

  const set = new Set(input)
  return n => set.has(n.id)
}