import { isObject } from 'lodash';
import { PatchedSchema } from "../schema";
import { Nil } from "../types";
import { isCollectingDep, hasOwn, makeEmptyLike, specialAccessKey } from "./utils";
import { NodeWriteAccessAction, ScatterStorage } from "./storage";

export const objToInfoLUT = new WeakMap<any, NodeInfo>()

const proxyHandler: ProxyHandler<any> = {
  get(target, key, recv) {
    let self = objToInfoLUT.get(target)
    if (!hasOwn(target, key)) self = void 0
    if (self && self.isArray && key === 'length') self = void 0   // for array, the "refs" container also has "length"

    // read access hook
    if (isCollectingDep() && self && self.bus) self.bus.emit('nodeReadAccess', self, key)

    if (!self || !self.refsCount || typeof key === 'symbol') return Reflect.get(target, key, recv)

    const rTo = self.refs![key]
    return rTo ? rTo.proxy : Reflect.get(target, key, recv)
  },
  set(target, key, value) {
    const self = objToInfoLUT.get(target)!

    const hasWriteAccessHook = self.bus?.hasListeners('nodeWriteAccess')
    const oldValue = hasWriteAccessHook && self.container[key]

    // setting array.length, something will be discarded!
    if (self.isArray && key === 'length') {
      // write access hook
      let writeAccessHookQueue: [key: keyof any, action: NodeWriteAccessAction][]
      if (hasWriteAccessHook) {
        writeAccessHookQueue = []

        // (for deleted array items)
        for (let i = Math.max(value, 0); i < oldValue; i++) {
          writeAccessHookQueue.push([i, {
            isDeleted: true,
            oldRef: self.refs?.[i],
            oldValue: self.container[i]
          }])
        }

        // (for length)
        writeAccessHookQueue.push([key, { oldValue, newValue: value }])
      }

      if (self.refs) {
        Object.keys(self.refs).forEach(k => {
          if (+k >= value) self._setRef(k, null);
        })
      }

      const finalResp = Reflect.set(target, key, value)
      if (hasWriteAccessHook) for (const args of writeAccessHookQueue!) self.bus!.emit('nodeWriteAccess', self, ...args)
      return finalResp
    }

    const propSchema = self?.schema?.getDirectChildSchema(key)

    // if the `value` is
    //
    // 1. a proxy
    //    - check if is from same ScatterStorage, and 
    //       - have same schema? just use it
    //       - current property is not defined? just use it too!
    //    - otherwise, fallback to case 2
    // 2. a object / array
    //    - make a node for it, then make a ref
    //    - always make node even if `propSchema` is not undefined
    // 3. other: normally set
    //
    // note: in any case, the old ref on this property key, must be removed, if presents.

    let newRef: NodeInfo<any> | undefined

    // case 1 checking
    if (
      (newRef = objToInfoLUT.get(value)) &&
      newRef.bus === self.bus &&
      (!propSchema /* current property not defined */ || (
        /* or the incoming node's schema suits this property */
        !self.bus?.options.disallowSubTypeAssign
          ? newRef.schema?.isExtendedFrom(propSchema) // Dog can be stored in Animal field
          : newRef.schema === propSchema // treat as different types (default)
      ))
    ) {
      // case 1, pass
    } else if (isObject(value)) {
      // case 2, make a new node and clone data into it
      newRef = new NodeInfo(self.bus, makeEmptyLike(value), propSchema)
      Object.assign(newRef.proxy, value)
    } else {
      // case 3, no new node
      newRef = void 0;
    }

    const newValue = newRef ? newRef.proxy : value
    const oldRef = self._setRef(key, newRef)

    const finalResp = Reflect.set(target, key, newValue)

    if (hasWriteAccessHook) {
      self.bus!.emit('nodeWriteAccess', self, key, {
        oldRef,
        newRef,
        oldValue,
        newValue,
      })
    }

    return finalResp
  },
  deleteProperty(target, key) {
    const self = objToInfoLUT.get(target)

    let emitWriteAction: NodeWriteAccessAction | undefined
    if (self) {
      const hasWriteAccessHook = self.bus?.hasListeners('nodeWriteAccess')
      const oldValue = hasWriteAccessHook && self.container[key]
      const oldRef = self._setRef(key, null)

      if (hasWriteAccessHook) {
        emitWriteAction = {
          isDeleted: true,
          oldValue,
          oldRef,
        }
      }
    }

    const finalResp = Reflect.deleteProperty(target, key)
    if (emitWriteAction) self!.bus!.emit('nodeWriteAccess', self!, key, emitWriteAction);
    return finalResp
  },
  has(target, key) {
    // read access hook
    const self = isCollectingDep() && objToInfoLUT.get(target)
    if (self && self.bus) self.bus.emit('nodeReadAccess', self, key)

    return Reflect.has(target, key)
  },
  ownKeys(target) {
    // read access hook
    const self = isCollectingDep() && objToInfoLUT.get(target)
    if (self && self.bus) self.bus.emit('nodeReadAccess', self, specialAccessKey.ownKeys)

    return Reflect.ownKeys(target)
  },
}

export class NodeInfo<T extends object = any> {
  bus: ScatterStorage<any> | null

  referredCount = 0
  schema: PatchedSchema<T> | Nil
  container: T
  proxy: T

  isArray?: boolean
  refs?: Record<any, NodeInfo>
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
      bus.orphanNodes.add(this)
      bus.emit('nodeCreated', this)
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

  /** 
   * add / replace / delete a ref to other node
   * 
   * @returns oldRef
   */
  _setRef(k: keyof T, to: NodeInfo | Nil): NodeInfo | undefined {
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

    return lastRef || void 0
  }

  _addReferredCount() {
    if (!this.referredCount) {
      this.bus?.orphanNodes.delete(this)
    }

    this.referredCount++;
  }

  /** when other nodes are about to unreference this node, they shall call this */
  _minusReferredCount() {
    /* istanbul ignore if */
    if (!this.referredCount) return
    if (--this.referredCount) return

    // this node is no more referenced. tell bus and bus will clean up later.
    const bus = this.bus
    if (bus) {
      bus.orphanNodes.add(this)
      bus.emit('nodeLostLastReferrer', this)
    }
  }

  /** clear this node's content and refs. will not affect id */
  clear() {
    if (this.refs) {
      Object.values(this.refs).forEach((r) => (r as NodeInfo)._minusReferredCount())
      this.refs = void 0
      this.refsCount = 0
    }

    if (this.isArray) (this.container as any[]).length = 0
    else Object.keys(this.container).forEach(key => { delete (this.container as any)[key] })
  }

  /** discard all data and detach from storage */
  dispose(dangerouslyForce?: boolean) {
    if (!dangerouslyForce && this.referredCount) throw new Error('Node is referred, cannot be disposed')

    this.clear()

    this.id = ''
    this.bus?.orphanNodes.delete(this)
    this.bus = null
    this.schema = null
  }
}
