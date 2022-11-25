import { PatchedSchema } from "../schema";
import { Nil } from "../types";
import { hasOwn, makeEmptyLike } from "./utils";
import { ScatterStorage } from "./storage";

export const objToInfoLUT = new WeakMap<any, ScatterNodeInfo>()

const _proxyHandler: ProxyHandler<any> = {
  get(target, key, recv) {
    let self = objToInfoLUT.get(target)
    if (!hasOwn(target, key)) self = void 0
    if (self && self.isArray && key === 'length') self = void 0   // for array, the "refs" container also has "length"

    if (!self || !self.refsCount || typeof key === 'symbol') return Reflect.get(target, key, recv)

    const rTo = self.refs![key]
    return rTo ? rTo.proxy : Reflect.get(target, key, recv)
  },
  set(target, key, value) {
    const self = objToInfoLUT.get(target)

    const propSchema = self?.schema?.getDirectChildSchema(key)
    if (!self || !propSchema || (propSchema.type !== 'object' && propSchema.type !== 'array')) {
      // the property is not defined as object/array
      // no need to do special process
      return Reflect.set(target, key, value)
    }

    // this property is type defined
    // we must make a node for it
    // then make a ref

    let valueInfo = objToInfoLUT.get(value)
    if (valueInfo && valueInfo.bus !== self.bus) {
      valueInfo = void 0;   // not same context
    }

    if (valueInfo) {
      // already a node
      if (valueInfo.schema !== propSchema) throw new Error('Schema mismatch!') // TODO: make a clone?
    } else {
      // not a node, make a data clone
      valueInfo = new ScatterNodeInfo(self.bus, makeEmptyLike(value), propSchema)
      Object.assign(valueInfo.proxy, value)
    }

    self._setRef(key, valueInfo)
    return Reflect.set(target, key, valueInfo.proxy)
  },
  deleteProperty(target, key) {
    const self = objToInfoLUT.get(target)

    if (self) self._setRef(key, null)
    return Reflect.deleteProperty(target, key)
  },
}

export class ScatterNodeInfo<T extends object = any> {
  bus: ScatterStorage<any> | null

  referredCount = 0
  id: string
  schema: PatchedSchema<T> | Nil
  container: T
  proxy: T

  isArray?: boolean
  refs?: Record<any, ScatterNodeInfo>
  refsCount = 0;

  constructor(bus: ScatterStorage<any> | null, container: T, schema: PatchedSchema<T> | Nil) {
    this.bus = bus;
    this.container = container
    this.schema = schema
    if (Array.isArray(container)) this.isArray = true

    this.proxy = new Proxy(container, _proxyHandler)
    
    objToInfoLUT.set(container, this)
    objToInfoLUT.set(this.proxy, this)
    objToInfoLUT.set(this, this)

    this.id = bus?.allocateId(this) || ''

    bus?.emit('nodeCreated', bus, this)
  }

  /** add / replace / delete a ref to other node */
  _setRef(k: keyof T, to: ScatterNodeInfo | Nil) {
    const lastRef = this.refsCount && this.refs?.[k]
    if (lastRef) {
      delete this.refs![k]
      lastRef._minusReferredCount()
    }

    if (!to) {
      // if refsCount decreases to zero, remove this.refs
      if (lastRef && !--this.refsCount) this.refs = void 0
    } else {
      // making first ref? make a container as this.refs
      if (!lastRef && !this.refsCount++) this.refs = makeEmptyLike(this.container)
      this.refs![k] = to
      to.referredCount++;
    }
  }

  /** when other is unreferring this node, they shall call this */
  _minusReferredCount() {
    if (!this.referredCount) return
    if (--this.referredCount) return

    // this node is no more referenced. tell bus and bus will clean up later.
    this.bus?.emit('nodeLostLastRef', this.bus, this)
  }

  /** reset this node's content and refs */
  reset() {
    if (this.refs) {
      Object.values(this.refs).forEach((r) => (r as ScatterNodeInfo)._minusReferredCount())
      this.refs = void 0
      this.refsCount = 0
    }

    this.container = makeEmptyLike(this.container)
  }

  /** discard data and detach from storage */
  dispose() {
    this.reset()
    this.bus = null
    this.schema = null
  }
}
