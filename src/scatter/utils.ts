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
