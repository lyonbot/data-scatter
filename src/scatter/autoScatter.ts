import { TypedEmitter } from 'tiny-typed-emitter';
import { isPatchedSchema, PatchedSchema, SchemaRegistry, TypeLUT } from '../schema';
import { Nullish } from '../types';

export interface AutoScatterEvents {
  'added': (el: string, wasNew: boolean) => void;
  'deleted': (deletedCount: number) => void;
}

interface NodeInfo {
  id: string;
  value: any;
  schema: PatchedSchema<any> | Nullish
  refCount: number;
  pinCount: number;
}

export class ScatterStorage<SchemaTypeLUT extends TypeLUT> extends TypedEmitter<AutoScatterEvents> {
  readonly schemaRegistry: SchemaRegistry<SchemaTypeLUT>
  readonly extractNodeFrom: Set<PatchedSchema<any>>

  readonly nodeInfos = new Map<string, NodeInfo>()
  readonly objToNodeInfo = new WeakMap<any, NodeInfo>()

  constructor(options: ScatterStorageInitOptions<SchemaTypeLUT>) {
    super()
    this.schemaRegistry = options.schemaRegistry
    this.extractNodeFrom = new Set();

    options.extractNodeFrom.forEach(v => {
      if (typeof v === 'string') v = this.schemaRegistry.get(v);
      if (!isPatchedSchema(v)) throw new Error('Invalid schema found in options.extractNodeFrom')

      this.extractNodeFrom.add(v)
    })
  }

  get(documentId: string) {
  }

  set(documentId: string, value: any) {
  }
}

export interface ScatterStorageInitOptions<SchemaTypeLUT extends TypeLUT> {
  schemaRegistry: SchemaRegistry<SchemaTypeLUT>

  /** 
   * you may specifiy some `schemaId` of objects and arrays
   * 
   * if we meet a object that suits this schema, we extract it as a scattered node
   */
  extractNodeFrom: Array<(keyof SchemaTypeLUT) | PatchedSchema<any>>
}
