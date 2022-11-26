import { TypedEmitter } from "tiny-typed-emitter"
import { TypeLUT, SchemaRegistry, PatchedSchema } from "../schema"
import { Nil, KeyOf } from "../types";
import { ScatterNodeInfo, objToInfoLUT } from "./ScatterNodeInfo";

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
   * @param copyDataFrom - by default, returns an empty object / array. you can also fill some data before returning, and some nodes might be created.
   */
  create<T extends KeyOf<SchemaTypeLUT>>(schema: T, copyDataFrom?: SchemaTypeLUT[T]): SchemaTypeLUT[T]
  create<T extends KeyOf<SchemaTypeLUT>>(schema: T, copyDataFrom?: any): SchemaTypeLUT[T]
  create<T extends object = any>(schema: PatchedSchema<T>, copyDataFrom?: any): T
  create(schema: string | PatchedSchema<any> | Nil, copyDataFrom?: any): any {
    if (typeof schema === 'string') schema = this.schemaRegistry.get(schema)
    if (!schema) throw new Error('schema is required'); //schema = null

    const container = schema?.type === 'array' ? [] : {}
    const nodeInfo = new ScatterNodeInfo<any>(this, container, schema)

    if (schema && (schema.type !== 'object' && schema.type !== 'array')) throw new Error('Schema type must be object or array')

    if (copyDataFrom && typeof copyDataFrom === 'object') Object.assign(nodeInfo.proxy, copyDataFrom)

    return nodeInfo.proxy
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
