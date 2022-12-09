import { EventEmitter } from "../EventEmitter";
import { TypeLUT, SchemaRegistry, PatchedSchema } from "../schema"
import { Nil, KeyOf } from "../types";
import { ScatterNodeInfo, objToInfoLUT } from "./ScatterNodeInfo";
import { arrayify, makeEmptyLike, NodeSelector, normalizeNodeSelector, OneOrMany, Tail } from "./utils";
import { walk, WalkCallbackResponse, WalkOptions, WalkStepInfo } from "./walk";

export type NodeWriteAccessAction = {
  isDeleted?: boolean;
  oldRef?: ScatterNodeInfo;
  newRef?: ScatterNodeInfo;
  oldValue?: any;
  newValue?: any;
};

export interface AutoScatterEvents<T extends TypeLUT = any> {
  /**
   * fired when a node is created, before filling content
   */
  nodeCreated(nodeInfo: ScatterNodeInfo): void

  /** 
   * fired when a node lost last reference from others.
   * 
   * note: maybe someone will make new references laster, therefore, DO NOT DELETE THIS NODE IMMEDIATELY!
   */
  nodeLostLastReferrer(nodeInfo: ScatterNodeInfo): void

  nodeReadAccess(nodeInfo: ScatterNodeInfo, key: keyof any): void

  nodeWriteAccess(nodeInfo: ScatterNodeInfo, key: keyof any, action: NodeWriteAccessAction): void
}

export class ScatterStorage<SchemaTypeLUT extends TypeLUT = any> extends EventEmitter<AutoScatterEvents<SchemaTypeLUT>> {
  readonly schemaRegistry: SchemaRegistry<SchemaTypeLUT>
  readonly options: ScatterStorageInitOptions<SchemaTypeLUT>

  nodes = new Map<string, ScatterNodeInfo>()
  orphanNodes = new Set<ScatterNodeInfo>()

  constructor(opts: ScatterStorageInitOptions<SchemaTypeLUT>) {
    super();
    this.schemaRegistry = opts.schemaRegistry
    this.options = opts
  }

  /**
   * get a created object / array
   * 
   * @see {@link ScatterStorage#getNodeInfo}
   */
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
   * recursively visit nodes and their children
   * 
   * note: if `callback` is async function, this will return a `Promise`
   * 
   * @param startsFrom - one or many (nodeId / NodeInfo / array or object managed by this storage)
   */
  walk(startsFrom: OneOrMany<string | ScatterNodeInfo | any>, callback: (info: WalkStepInfo) => Promise<WalkCallbackResponse>, opts?: WalkOptions): Promise<void>
  walk(startsFrom: OneOrMany<string | ScatterNodeInfo | any>, callback: (info: WalkStepInfo) => WalkCallbackResponse, opts?: WalkOptions): void
  walk(...args: any[]): any {
    return walk(this, ...args as Tail<Parameters<typeof walk>>)
  }

  /**
   * scan nodes from some entries, then dispose all unreferenced nodes
   */
  treeshake(opts: {
    /** one or many (nodeId / NodeInfo / array or object managed by this storage) */
    entries: OneOrMany<string | ScatterNodeInfo | any>

    /** during first scan, mark more nodes to retain */
    skips?: NodeSelector

    /** called before disposing nodes. this is the last moment you can read the data */
    beforeDispose?: (nodes: ScatterNodeInfo[]) => void
  }) {
    const scanQueue = this.getNodeInfos(opts.entries)
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
   * check if something belongs to this storage. If so, return the nodeInfo
   * 
   * @see {@link ScatterStorage#getNodeInfos} if you want to query mulitple items and keep valid NodeInfos
   * 
   * @param query - could be 
   * 
   * 1. nodeId (string)
   * 2. object / array that created or mananged by this storage
   * 3. NodeInfo that returned from `getNodeInfo`
   */
  getNodeInfo<T extends object = any>(query: any): ScatterNodeInfo<T> | null {
    let o: ScatterNodeInfo<T> | undefined
    if (typeof query === 'string') o = this.nodes.get(query)
    else if (query instanceof ScatterNodeInfo) o = query;
    else o = objToInfoLUT.get(query)

    if (!o || o.bus !== this) return null
    return o
  }

  /**
   * a multiple-to-multiple version of `getNodeInfo`
   * 
   * @see {@link ScatterStorage#getNodeInfo}
   * @param queries - one or many (nodeId / NodeInfo / array or object managed by this storage)
   * @return always an array of NodeInfo. `null` will NOT be included
   */
  getNodeInfos(queries: OneOrMany<string | ScatterNodeInfo | any>): ScatterNodeInfo[] {
    return arrayify(queries).map(x => this.getNodeInfo(x)).filter(Boolean) as ScatterNodeInfo[];
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
