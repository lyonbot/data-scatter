type Fn = (...args: any[]) => any
type FnEx = Fn & { raw: Fn }

type Params<T> = T extends (...args: infer R) => any ? R : any[]

// if there is only few listeners, invoking inside a for-loop is slow
const makeInvokerForSome = (f1: Fn, f2: Fn, f3: Fn | undefined, f4: Fn | undefined, f5: Fn | undefined): Fn => (...args: any[]) => {
  f1(...args)
  f2(...args)
  if (!f3) return; f3(...args)
  if (!f4) return; f4(...args)
  if (!f5) return; f5(...args)
}

const makeInvokerForMany = (arr: Fn[], len: number): Fn => (...args: any[]) => {
  for (let i = 0; i < len; i++) arr[i](...args)
}

export const combineFunctions = (arr: Fn[]): Fn => {
  const arrLen = arr.length
  if (arrLen === 0) return () => void 0
  if (arrLen === 1) return arr[0]
  if (arrLen <= 5) return makeInvokerForSome(...arr as Parameters<typeof makeInvokerForSome>)
  return makeInvokerForMany(arr, arrLen)
}

/**
 * a speed-optimized and fully-typed event emitter
 * 
 * One of the benefits is that the `on(...)` and `once(...)` methods return a function that can be used to remove the listener, 
 * which is very convenient for use with React's `useEffect` hook.
 * This eliminates the need to store a reference to the event emitter in order to remove the listener later.
 * 
 * Another benefit is that the implementation is optimized for speed. The invoker functions are optimized
 * based on the number of listeners for the event, so that the `emit(...)` can be as efficient as possible.
 */
export class EventEmitter<T>{
  private _listeners = Object.create(null) as Record<keyof T, Array<FnEx>>
  private _listenerInvokers = Object.create(null) as Record<keyof T, Fn>

  /**
   * attach a event listener
   *
   * @param event - The name of the event to listen to.
   * @param listener - The listener function to attach.
   * @param once - Whether the listener should be removed after being called once.
   * @returns A function to remove this listener, which is equivalent to calling `off(event, listener)`.
   */
  on<K extends keyof T>(event: K, listener: T[K], once?: boolean) {
    let list = this._listeners[event];

    const bounded = (listener as Fn).bind(this)
    const fnEx = (once ? (...args: any[]) => { this.off(event, listener); bounded(...args) } : bounded) as FnEx
    fnEx.raw = listener as Fn;

    if (!list) list = this._listeners[event] = [fnEx];
    else list.push(fnEx);

    this._listenerInvokers[event] = combineFunctions(list)
    return () => this.off(event, listener)
  }

  /**
   * remove a event listener
   */
  off<K extends keyof T>(event: K, listener: T[K]) {
    const prev = this._listeners[event];
    if (!prev) return;

    const newArr = prev.filter((x) => x.raw !== listener);

    if (newArr.length) {
      this._listeners[event] = newArr
      this._listenerInvokers[event] = combineFunctions(newArr)
    } else {
      delete this._listeners[event]
      delete this._listenerInvokers[event]
    }
  }

  /**
   * attach a event listener, which only fire once
   *
   * @param event - The name of the event to listen to.
   * @param listener - The listener function to attach.
   * @returns A function to remove this listener, which is equivalent to calling `off(event, listener)`.
   */
  once<K extends keyof T>(event: K, listener: T[K]) {
    return this.on(event, listener, true)
  }

  /**
   * emit a event
   */
  emit<K extends keyof T>(event: K, ...args: Params<T[K]>) {
    const invoke = this._listenerInvokers[event];
    if (invoke) invoke(...args)
  }

  hasListeners<K extends keyof T>(event: K) {
    return !!this._listenerInvokers[event]
  }
}
