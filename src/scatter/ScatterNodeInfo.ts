import isObject from 'lodash/isObject';
import { PatchedSchema } from "../schema";
import { Nil } from "../types";
import { hasOwn, makeEmptyLike } from "./utils";
import { ScatterStorage } from "./storage";

export const objToInfoLUT = new WeakMap<any, ScatterNodeInfo>()

const proxyHandler: ProxyHandler<any> = {
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

      // setting array.length, something will be discarded!
      if (self?.isArray && key === 'length' && self.refs) {
        Object.keys(self.refs).forEach(k => {
          if (+k >= value) self._setRef(k, null);
        })
      }

      return Reflect.set(target, key, value)
    }

    // this property is type defined
    // if the `value` is
    //
    // 1. a proxy
    //    - if is from same ScatterStorage, and have same schema? just use it
    //    - otherwise, fallback to case 2
    // 2. a object / array: make a node for it, then make a ref
    // 3. other: normally set
    //
    // note: in any case, the old ref on this property key, must be removed, if presents.

    let valueInfo: ScatterNodeInfo<any> | undefined

    // case 1 checking
    if (
      (valueInfo = objToInfoLUT.get(value)) &&
      valueInfo.bus === self.bus &&
      valueInfo.schema === propSchema
    ) {
      // case 1, pass
    } else if (isObject(value)) {
      // case 2, make a new node and clone data into it
      valueInfo = new ScatterNodeInfo(self.bus, makeEmptyLike(value), propSchema)
      Object.assign(valueInfo.proxy, value)
    } else {
      // case 3, no new node
      valueInfo = void 0;
    }

    self._setRef(key, valueInfo)
    return Reflect.set(target, key, valueInfo ? valueInfo.proxy : value)
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

    this.proxy = new Proxy(container, proxyHandler)

    objToInfoLUT.set(container, this)
    objToInfoLUT.set(this.proxy, this)
    objToInfoLUT.set(this, this)

    this.id = bus?.allocateId(this) || ''

    if (bus) {
      bus.nodesHaveNoReferrer.add(this)
      bus.emit('nodeCreated', bus, this)
    }
  }

  private _id!: string
  get id() {
    return this._id
  }
  set id(id: string) {
    const lastId = this._id
    if (lastId === id) return

    const bus = this.bus
    if (bus) {
      if (id) {
        if (bus.nodes.has(id)) throw new Error(`Node id already exists: ${id}`)
        bus.nodes.set(id, this)
      }
      if (lastId && bus.nodes.get(lastId) === this) {
        bus.nodes.delete(lastId)
      }
    }

    this._id = id
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
      to._addReferredCount()
    }
  }

  _addReferredCount() {
    if (!this.referredCount) {
      this.bus?.nodesHaveNoReferrer.delete(this)
    }

    this.referredCount++;
  }

  /** when other is unreferring this node, they shall call this */
  _minusReferredCount() {
    /* istanbul ignore if */
    if (!this.referredCount) return
    if (--this.referredCount) return

    // this node is no more referenced. tell bus and bus will clean up later.
    const bus = this.bus
    if (bus) {
      bus.nodesHaveNoReferrer.add(this)
      bus.emit('nodeLostLastReferrer', bus, this)
    }
  }

  /** clear this node's content and refs. will not affect id */
  clear() {
    if (this.refs) {
      Object.values(this.refs).forEach((r) => (r as ScatterNodeInfo)._minusReferredCount())
      this.refs = void 0
      this.refsCount = 0
    }

    if (this.isArray) (this.container as any[]).length = 0
    else Object.keys(this.container).forEach(key => { delete (this.container as any)[key] })
  }

  /** discard all data and detach from storage */
  dispose() {
    if (this.referredCount) throw new Error('Node is referred, cannot be disposed')

    this.clear()

    this.id = ''
    this.bus?.nodesHaveNoReferrer.delete(this)
    this.bus = null
    this.schema = null
  }
}
