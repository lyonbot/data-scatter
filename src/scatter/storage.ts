import { TypedEmitter } from "tiny-typed-emitter"
import { TypeLUT, SchemaRegistry, PatchedSchema, isPatchedSchema, } from "../schema"
import { Nil } from "../types";

export interface AutoScatterEvents<T extends TypeLUT = any> {
  /**
   * fired when a node is created, before filling content
   */
  nodeCreated(storage: ScatterStorage<T>, nodeInfo: ScatterNodeInfo): void

  /** 
   * fired when a node lost last reference from others.
   * 
   * note: maybe later this node will be referred again, therefore, DO NOT DELETE NODE IMMEDIATELY!
   */
  nodeLostLastRef(storage: ScatterStorage<T>, nodeInfo: ScatterNodeInfo): void
}

export class ScatterStorage<SchemaTypeLUT extends TypeLUT = any> extends TypedEmitter<AutoScatterEvents> {
  readonly schemaRegistry: SchemaRegistry<SchemaTypeLUT>
  readonly extractNodeFrom: Set<PatchedSchema<any>>

  constructor(opts: ScatterStorageInitOptions<SchemaTypeLUT>) {
    super();
    this.schemaRegistry = opts.schemaRegistry
    this.extractNodeFrom = new Set();

    opts.extractNodeFrom.forEach((v, i) => {
      if (typeof v === 'string') v = this.schemaRegistry.get(v);
      if (!isPatchedSchema(v)) throw new Error(`Invalid schema found in options.extractNodeFrom #${i}`)
      // if (!v.isArray() || !v.isObject()) throw new Error(`The #${i} of extractNodeFrom is not object nor array, can't be extracted as nodes`)

      this.extractNodeFrom.add(v)
    })
  }

  /**
   * create a object inside this storage, then you can directly write it.
   * 
   * all the reading / writing operations are proxied, **ScatterStorage** will automatically separate data and create nodes.
   * 
   * @param copyDataFrom - by default, returns an empty object / array. you can also fill some data before returning, and some nodes might be created.
   */
  create<T extends KeyOf<SchemaTypeLUT>>(schema: T, copyDataFrom?: any): SchemaTypeLUT[T]
  create(schema: string | PatchedSchema<any> | Nil, copyDataFrom?: any): any {
    if (typeof schema === 'string') schema = this.schemaRegistry.get(schema)
    if (!schema) schema = null

    const container = schema?.type === 'array' ? [] : {}
    const nodeInfo = new ScatterNodeInfo<any>(this, container, schema)

    if (schema && (schema.type !== 'object' && schema.type !== 'array')) throw new Error('Schema type must be object or array')

    if (copyDataFrom && typeof copyDataFrom === 'object') Object.assign(nodeInfo, copyDataFrom)

    return nodeInfo.proxy
  }

  /**
   * check if an object / array is a proxy. if is, return the nodeInfo
   */
  getNodeInfo<T = any>(x: any): ScatterNodeInfo<T> | null {
    const o = obj2info.get(x)
    if (!o || o.bus !== this) return null
    return o
  }
}

type KeyOf<T> = string & keyof T

export interface ScatterStorageInitOptions<SchemaTypeLUT extends TypeLUT> {
  schemaRegistry: SchemaRegistry<SchemaTypeLUT>
  extractNodeFrom: Array<PatchedSchema<any> | KeyOf<SchemaTypeLUT>>
}


////////////////////////////////

const obj2info = new WeakMap<any, ScatterNodeInfo>()
const _proxyHandler: ProxyHandler<any> = {
  get(target, key, recv) {
    let self = obj2info.get(target)
    if (!hasOwn(target, key)) self = void 0
    if (self && self.isArray && key === 'length') self = void 0   // for array, the "refs" container also has "length"

    if (!self || !self.refsCount || typeof key === 'symbol') return Reflect.get(target, key, recv)

    const rTo = self.refs![key]
    return rTo ? rTo.proxy : Reflect.get(target, key, recv)
  },
  set(target, key, value) {
    const self = obj2info.get(target)

    const propSchema = self?.schema?.getDirectChildSchema(key)
    if (!self || !propSchema || (propSchema.type !== 'object' && propSchema.type !== 'array')) {
      // the property is not defined as object/array
      // no need to do special process
      return Reflect.set(target, key, value)
    }

    // this property is type defined
    // we must make a node for it
    // then make a ref

    let valueInfo = obj2info.get(value)
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
    const self = obj2info.get(target)

    if (self) self._setRef(key, null)
    return Reflect.deleteProperty(target, key)
  },
}

const makeEmptyLike = (x: any) => {
  if (Array.isArray(x)) return [];
  return Object.create(Object.getPrototypeOf(x))
}

const hasOwn = (obj: any, key: any) => Object.prototype.hasOwnProperty.call(obj, key)

class ScatterNodeInfo<T extends object = any> {
  bus: ScatterStorage<any>

  referredCount = 0
  schema: PatchedSchema<T> | Nil
  container: T
  proxy: T

  isArray?: boolean
  refs?: Record<any, ScatterNodeInfo>
  refsCount = 0;

  constructor(bus: ScatterStorage<any>, container: T, schema: PatchedSchema<T> | Nil) {
    this.bus = bus;
    this.container = container
    this.schema = schema
    if (Array.isArray(container)) this.isArray = true

    this.proxy = new Proxy(container, _proxyHandler)
    this.bus.emit('nodeCreated', this.bus, this)

    obj2info.set(container, this)
    obj2info.set(this.proxy, this)
    obj2info.set(this, this)
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
    this.bus.emit('nodeLostLastRef', this.bus, this)
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
}

export type { ScatterNodeInfo }