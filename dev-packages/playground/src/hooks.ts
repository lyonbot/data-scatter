import { useMemo, useReducer, useRef } from "react";

/**
 * Get a proxy to a chaging object / function and the proxy's ref is always the same one.
 * 
 * @param updateWhenSet do a forceUpdate when assigning value to the proxy. default is false
 */
// eslint-disable-next-line @typescript-eslint/ban-types
export function useLast<T extends Function | Object>(value: T, updateWhenSet?: boolean): T {
  const lastRef = useRef(value);
  const updateFlag = useRef(false)
  const forceUpdate = useForceUpdate()

  const h = useMemo(() => {
    if (typeof value === 'function') {
      return function (this: any, ...args: any[]) { return (lastRef.current as any).apply(this, args); }
    }

    const mayCall = () => updateFlag.current && forceUpdate()

    return new Proxy(Object.create(Object.getPrototypeOf(value)), {
      get(_, p) { return Reflect.get(lastRef.current, p) },
      set(_, p, v) { mayCall(); return Reflect.set(lastRef.current, p, v) },
      deleteProperty(_, p) { mayCall(); return Reflect.deleteProperty(lastRef.current, p) },
      ownKeys() { return Reflect.ownKeys(lastRef.current) },
      has(p) { return Reflect.has(lastRef.current, p) },
    })
  }, [typeof value, Array.isArray(value)])

  lastRef.current = value
  updateFlag.current = !!updateWhenSet

  return h as T
}

export function useForceUpdate() {
  const [, r] = useReducer((x) => (x + 1) % 0xffffff, 0)
  return r as () => void
}
