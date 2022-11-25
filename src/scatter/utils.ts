export const makeEmptyLike = (x: any) => {
  if (Array.isArray(x))
    return [];
  return Object.create(Object.getPrototypeOf(x));
};

export const hasOwn = (obj: any, key: any) => Object.prototype.hasOwnProperty.call(obj, key);
