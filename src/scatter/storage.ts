import { EventEmitter } from "../EventEmitter";
import { TypeLUT, SchemaRegistry, PatchedSchema } from "../schema"
import { Nil, KeyOf } from "../types";
import { NodeInfo, objToInfoLUT } from "./NodeInfo";
import { arrayify, makeEmptyLike, NodeSelector, normalizeNodeSelector, OneOrMany, Tail } from "./utils";
import { walk, WalkCallbackResponse, WalkOptions, WalkStepInfo } from "./walk";
import type { NodeContentObserver } from './observe'

export type NodeWriteAccessAction = {
  isDeleted?: boolean;
  oldRef?: NodeInfo;
  newRef?: NodeInfo;
  oldValue?: any;
  newValue?: any;
};

export interface AutoScatterEvents {
  /**
   * fired when a node is created, before filling content
   */
  nodeCreated(nodeInfo: NodeInfo): void

  /** 
   * fired when a node lost last reference from others.
   * 
   * note: maybe someone will make new references laster, therefore, DO NOT DELETE THIS NODE IMMEDIATELY!
   */
  nodeLostLastReferrer(nodeInfo: NodeInfo): void

  /**
   * (internal event) only fires while a `NodeContentObserver` collecting dependencies
   */
  nodeReadAccess(nodeInfo: NodeInfo, key: keyof any): void

  /**
   * fires when a node's content changes
   * 
   * @see {@link NodeContentObserver}
   */
  nodeWriteAccess(nodeInfo: NodeInfo, key: keyof any, action: NodeWriteAccessAction): void
}

/**
 * ScatterStorage is a class that help you creating and manipulating objects and arrays, based on your schemas.
 * 
 * You can use `storage.create(schema)` to create objects and arrays, then read and write values to them, 
 * and ScatterStorage will automatically creates nodes for any nested objects or arrays.
 * 
 * You can use the `getNodeInfo(obj)` method to check if a given object or array is a managed node,
 * and retrieve its associated schema.
 * 
 * Besides, it provides `treeshake(entries, opts?)`, `walk(entries, callback, opts?)` and more methods
 * 
 * @example
 * ```ts
 * const storage = new ScatterStorage({ schemaRegistry: mySchemaRegistry });
 * 
 * // create a object / array based on a schema
 * // then feel free to read / write it
 * 
 * const task = storage.create('task');
 * task.name = 'shopping';
 * task.subTasks = [{ name: 'buy flowers' }];
 * 
 * expect(task).toEqual({
 *   name: 'shopping',
 *   subTasks: [{ name: 'buy flowers' }],
 * });
 * 
 * // ScatterStorage will automatically make 2 nodes: the `subTasks` array and the `buy-flowers` Task
 * // you can use getNodeInfo() to check, if it's a node, it will return node info
 * 
 * const subTask1 = task.subTasks[0];
 * expect(subTask1).toEqual({ name: 'buy flowers' });
 * 
 * const $$subTask1 = storage.getNodeInfo(subTask1);
 * expect($$subTask1.schema).toBe(mySchemaRegistry.get('task'));
 * ```
 */
export class ScatterStorage<SchemaTypeLUT extends TypeLUT = any> extends EventEmitter<AutoScatterEvents> {
  readonly schemaRegistry: SchemaRegistry<SchemaTypeLUT>
  readonly options: ScatterStorageInitOptions<SchemaTypeLUT>

  nodes = new Map<string, NodeInfo>()
  orphanNodes = new Set<NodeInfo>()

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
    const nodeInfo = new NodeInfo<any>(this, container, schema)

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
    const skipped = new Set<NodeInfo>()

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
   * recursively traverse the tree structure and perform operations on each node,
   * such as reading or modifying values.
   * 
   * note: if `callback` is async function, this will return a `Promise`
   * 
   * @param startsFrom - one or many (nodeId / NodeInfo / array or object managed by this storage)
   * @param callback - a callback may return one of this:
   * 
   *   - nothing -- continue scan children nodes
   *   - `'skip-children'` -- skip this node's children
   *   - `'abort-all` -- stop the whole walk process
   *   - `{ only: PropertyNameOrFilterFunction[] }`
   *   - `{ skips: PropertyNameOrFilterFunction[] }`
   * 
   *   Where `PropertyNameOrFilterFunction` could be a *key* such as `"name"`, `4`, 
   *   or a *function* such as `(key, subNodeInfo, parentNodeInfo) => boolean`.
   */
  walk(startsFrom: OneOrMany<string | NodeInfo | any>, callback: (info: WalkStepInfo) => Promise<WalkCallbackResponse>, opts?: WalkOptions): Promise<void>
  walk(startsFrom: OneOrMany<string | NodeInfo | any>, callback: (info: WalkStepInfo) => WalkCallbackResponse, opts?: WalkOptions): void
  walk(...args: any[]): any {
    return walk(this, ...args as Tail<Parameters<typeof walk>>)
  }

  /**
   * scan nodes from some entries, then dispose all unreferenced nodes
   * 
   * @param entries - one or many (nodeId / NodeInfo / array or object managed by this storage) 
   */
  treeshake(entries: OneOrMany<string | NodeInfo | any>, opts: {
    /** during first scan, mark more nodes to retain */
    skips?: NodeSelector

    /** called with `NodeInfo[]` before disposing nodes. this is the last moment you can read the data */
    beforeDispose?: (nodes: NodeInfo[]) => void
  } = {}) {
    const scanQueue = this.getNodeInfos(entries)
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
  getNodeInfo<T extends object = any>(query: any): NodeInfo<T> | null {
    let o: NodeInfo<T> | undefined
    if (typeof query === 'string') o = this.nodes.get(query)
    else if (query instanceof NodeInfo) o = query;
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
  getNodeInfos(queries: OneOrMany<string | NodeInfo | any>): NodeInfo[] {
    return arrayify(queries).map(x => this.getNodeInfo(x)).filter(Boolean) as NodeInfo[];
  }

  /**
   * allocate a new id for new node
   */
  allocateId(nodeInfo: NodeInfo): string {
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
