import { Nil } from "../types";
import type { ScatterNodeInfo } from "./ScatterNodeInfo";

export const makeEmptyLike = (x: any) => {
  if (Array.isArray(x))
    return [];
  return Object.create(Object.getPrototypeOf(x));
};

export const hasOwn = (obj: any, key: any) => Object.prototype.hasOwnProperty.call(obj, key);

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