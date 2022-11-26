import { TypedEmitter } from "tiny-typed-emitter"
import { TypeLUT, SchemaRegistry, PatchedSchema } from "../schema"
import { Nil, KeyOf } from "../types";
import { ScatterNodeInfo, objToInfoLUT } from "./ScatterNodeInfo";
import { makeEmptyLike, NodeSelector, normalizeNodeSelector } from "./utils";

export interface AutoScatterEvents<T extends TypeLUT = any> {
  /**
   * fired when a node is created, before filling content
   */
  nodeCreated(storage: ScatterStorage<T>, nodeInfo: ScatterNodeInfo): void

  /** 
   * fired when a node lost last reference from others.
   * 
   * note: maybe someone will make new references laster, therefore, DO NOT DELETE THIS NODE IMMEDIATELY!
   */
  nodeLostLastReferrer(storage: ScatterStorage<T>, nodeInfo: ScatterNodeInfo): void
}

export class ScatterStorage<SchemaTypeLUT extends TypeLUT = any> extends TypedEmitter<AutoScatterEvents> {
  readonly schemaRegistry: SchemaRegistry<SchemaTypeLUT>
  readonly options: ScatterStorageInitOptions<SchemaTypeLUT>

  nodes = new Map<string, ScatterNodeInfo>()
  orphanNodes = new Set<ScatterNodeInfo>()

  constructor(opts: ScatterStorageInitOptions<SchemaTypeLUT>) {
    super();
    this.schemaRegistry = opts.schemaRegistry
    this.options = opts
  }

  get(id: string) { return this.nodes.get(id)?.proxy }

  /**
   * create a node inside this storage, then you can directly read and manipulate it.
   * 
   * all the reading / writing operations are proxied, **ScatterStorage** will automatically separate data and create nodes.
   * 
   * @param fillDataWith - by default, returns an empty object / array.
   * 
   *    you can also fill fields before returning,
   *    meanwhile we will create reference to existing referable nodes, and create some new nodes
   * 
   *    if you don't want to link existing nodes, do a cloneDeep first.
   */
  create<T extends KeyOf<SchemaTypeLUT>>(schema: T, fillDataWith?: SchemaTypeLUT[T]): SchemaTypeLUT[T]
  create<T extends KeyOf<SchemaTypeLUT>>(schema: T, fillDataWith?: any): SchemaTypeLUT[T]
  create<T extends object = any>(schema: PatchedSchema<T>, fillDataWith?: any): T
  create(schema: string | PatchedSchema<any> | Nil, fillDataWith?: any): any {
    if (typeof schema === 'string') schema = this.schemaRegistry.get(schema)

    // note: if no schema, consider the type of fillDataWith
    const container = fillDataWith ? makeEmptyLike(fillDataWith) : (schema?.type === 'array' ? [] : {})
    const nodeInfo = new ScatterNodeInfo<any>(this, container, schema)

    if (schema && (schema.type !== 'object' && schema.type !== 'array')) throw new Error('Schema type must be object or array')

    if (fillDataWith && typeof fillDataWith === 'object') Object.assign(nodeInfo.proxy, fillDataWith)

    return nodeInfo.proxy
  }

  /**
   * recursively dispose orphan nodes -- they are not referred.
   */
  disposeOrphanNodes(opts: {
    /** default is 100 */
    maxIterations?: number

    /** do not dispose these nodes. can be a id list, or a filter function `(id, nodeInfo) => boolean` */
    skips?: NodeSelector
  } = {}) {
    const result = {
      ids: [] as string[]
    }

    const skips = normalizeNodeSelector(opts.skips)
    const skipped = new Set<ScatterNodeInfo>()

    for (let iteration = opts.maxIterations || 100; iteration--;) {
      let killedCount = 0
      for (const node of this.orphanNodes) {
        if (skipped.has(node)) continue
        if (skips(node)) { skipped.add(node); continue }

        result.ids.push(node.id)
        killedCount++
        node.dispose()
      }
      if (!killedCount) break;
    }

    return result
  }

  /**
   * scan nodes from some entries, then dispose all unreferenced nodes
   */
  treeshake(opts: {
    /** can be nodeId, the object, the NodeInfo */
    entries: Array<string | ScatterNodeInfo | any>

    /** during first scan, mark more nodes to retain */
    skips?: NodeSelector

    /** called before disposing nodes. this is the last moment you can read the data */
    beforeDispose?: (nodes: ScatterNodeInfo[]) => void
  }) {
    const scanQueue = Array.from(opts.entries, it => {
      if (!it) return null;
      if (typeof it === 'string') return this.nodes.get(it)
      return this.getNodeInfo(it)
    }).filter(Boolean) as ScatterNodeInfo[];

    const toRemove = new Set(this.nodes.values())

    for (let pass = 1; pass <= 2; pass++) {
      // pass1: use opts.entries, then do `skips` check
      // pass2: keep the "skipped" nodes and related

      while (scanQueue.length) {
        const item = scanQueue.shift()!
        if (!toRemove.has(item)) continue;
        toRemove.delete(item);

        if (item.refsCount) scanQueue.push(...Object.values(item.refs!))
      }

      if (pass === 1) {
        const skips = normalizeNodeSelector(opts.skips)
        for (const node of toRemove) {
          if (skips(node)) scanQueue.push(node)
        }
      }
    }

    const result = { ids: [] as Array<string> }

    opts.beforeDispose?.(Array.from(toRemove))

    for (const node of toRemove) {
      result.ids.push(node.id)
      node.dispose(true)
    }

    return result
  }

  /**
   * check if an object / array is from a node. if is, return the nodeInfo
   */
  getNodeInfo<T extends object = any>(x: any): ScatterNodeInfo<T> | null {
    const o = objToInfoLUT.get(x)
    if (!o || o.bus !== this) return null
    return o
  }

  /**
   * allocate a new id for new node
   */
  allocateId(nodeInfo: ScatterNodeInfo): string {
    let name = this.options.nodeIdGenerator?.(this, nodeInfo.schema || null)  // user custom id generator
    if (!name || typeof name !== 'string') name = (nodeInfo.schema?.$schemaId || '(unknown)') + idPrefix + (idCounter++).toString(16) // default id generator

    // check if name is taken. if so, add a suffix number
    for (let i = 2, namePrefix = name; this.nodes.has(name); name = namePrefix + (i++));

    return name
  }
}

const idPrefix = '#' + Math.random().toString(16).slice(-6)
let idCounter = 0

export interface ScatterStorageInitOptions<SchemaTypeLUT extends TypeLUT> {
  schemaRegistry: SchemaRegistry<SchemaTypeLUT>
  /**
   * generate a node id for new nodes
   */
  nodeIdGenerator?: NodeIdGenerator
  /**
   * Assuming `Admin` schema extends from `User`.
   * 
   * When assign an `Admin` object into `User` field, 
   * by default, we think an `Admin` is also a `User` and directly make a reference.
   * 
   * if you want to treat them as two DIFFERENT TYPES,
   * we will create a new `User` object, copy data into it and use the new object.
   * 
   * beware: object / array inside "Admin", could still be referenced directly, if their schemas is the same one.
   */
  disallowSubTypeAssign?: boolean
}

export type NodeIdGenerator = (storage: ScatterStorage, schema: PatchedSchema<any> | null) => string
