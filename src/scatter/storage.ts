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
   * note: maybe later this node will be referred again, therefore, DO NOT DELETE NODE IMMEDIATELY!
   */
  nodeLostLastRef(storage: ScatterStorage<T>, nodeInfo: ScatterNodeInfo): void
}

export class ScatterStorage<SchemaTypeLUT extends TypeLUT = any> extends TypedEmitter<AutoScatterEvents> {
  readonly schemaRegistry: SchemaRegistry<SchemaTypeLUT>

  constructor(opts: ScatterStorageInitOptions<SchemaTypeLUT>) {
    super();
    this.schemaRegistry = opts.schemaRegistry
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
  getNodeInfo<T extends object = any>(x: any): ScatterNodeInfo<T> | null {
    const o = objToInfoLUT.get(x)
    if (!o || o.bus !== this) return null
    return o
  }

  /**
   * allocate a new id for new node
   * this can be rewritten by you
   */
  allocateId(nodeInfo: ScatterNodeInfo): string {
    return (nodeInfo.schema?.$schemaId || '(unknown)') + idPrefix + (idCounter++).toString(16)
  }
}

const idPrefix = '#' + Math.random().toString(16).slice(-6)
let idCounter = 0

export interface ScatterStorageInitOptions<SchemaTypeLUT extends TypeLUT> {
  schemaRegistry: SchemaRegistry<SchemaTypeLUT>
}
