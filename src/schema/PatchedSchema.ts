import toPath from "lodash/toPath";
import { Spread } from "../types";
import { CommonSchemaId } from "./commonSchemas";
import { ArraySchema, ObjectSchema, PrimitiveSchema, SchemaBase, } from "./types"

export function isPatchedSchema<T = any>(x: any): x is PatchedSchema<T> {
  return !!x && patchedMark in x
}

export function getPatchedSchemaMeta(x: any): PatchedSchemaMeta | undefined {
  return x && x[patchedMark]
}

const uuidPrefix = Date.now().toString(36);
let uuidCounter = 0;

const patchedMark = Symbol('isPatchedSchema')

export interface PatchedSchemaMeta {
  schemaId: string;
  uuid: string;
  /** @internal */
  notReady?: boolean;
  /** get some common schema like "length" of "Array" */
  getCommonSchema(id: CommonSchemaId): PatchedSchema<any>;
}

export interface PatchedSchema<T> extends SchemaBase {
  [patchedMark]: PatchedSchemaMeta
  extends?: PatchedSchema<any>[]

  isObject(): this is PatchedObjectSchema<T>;
  isArray(): this is PatchedArraySchema<T>;

  getDirectChildSchema<K extends keyof T>(key: K): PatchedSchema<T[K]> | null
  getDirectChildSchema(key: string | number): PatchedSchema<any> | null
  getSchemaAtPath(path: string | number | (string | number)[]): PatchedSchema<any> | null
}

export interface PatchedObjectSchema<T> extends Spread<ObjectSchema, PatchedSchema<T>> {
  type: 'object'
  properties: { [k in keyof T]: PatchedSchema<T[k]> }
}

export interface PatchedArraySchema<T> extends Spread<ArraySchema, PatchedSchema<T>> {
  type: 'array'
  items: PatchedSchema<T extends (infer R)[] ? R : any>
}

/** @internal */
export function createPatchedSchema<T>(
  initCtx: SchemaPatchingContext,
  schema: ObjectSchema | ArraySchema | PrimitiveSchema,
  schemaId: string
) {
  const ans: PatchedSchema<T> = Object.create(patchedSchemaPrototype)
  Object.assign(ans, schema)

  const meta: PatchedSchemaMeta = {
    schemaId,
    uuid: uuidPrefix + (uuidCounter++),
    notReady: true,
    getCommonSchema: initCtx.getCommonSchema
  }

  // ans[patchedMark] = meta
  Object.defineProperty(ans, patchedMark, { enumerable: false, configurable: false, value: meta })

  initCtx.generatorQueue.push((function* initializer() {
    if (Array.isArray(schema.extends) && schema.extends.length) {
      const newExtends = new Array<PatchedSchema<any>>(schema.extends.length)
      for (let index = 0; index < schema.extends.length; index++) {
        const value = schema.extends[index];
        const p1 = initCtx.getPatchedSchema(value, `${schemaId}/extends/${index}`)

        const meta = getPatchedSchemaMeta(p1)!
        if (meta.notReady) {
          yield; // wait until p1 is ready
          if (!meta.notReady) throw new Error(`Cycle-dependencies found when "${schemaId}" extends "${p1[patchedMark].schemaId}"`)
        }

        newExtends[index] = p1
      }

      for (const e of newExtends) Object.assign(ans, e)
      Object.assign(ans, schema)

      ans.extends = newExtends
      // ans[patchedMark] = meta // ensure meta not overwritten
    } else {
      /* istanbul ignore next */
      if ('extends' in ans) delete ans.extends
    }

    // ----------------------------------------------------------------
    // object: properties = { ... extends } + schema.properties?

    if (ans.isObject()) {
      ans.properties = {} as any

      if (ans.extends) {
        for (const e of ans.extends) {
          if (e.isObject()) Object.assign(ans.properties, e.properties)
        }
      }

      const raw = schema.type === 'object' && schema.properties
      if (raw) {
        Object.keys(raw).forEach(key => {
          (ans.properties as any)[key] = initCtx.getPatchedSchema(raw[key], `${schemaId}/properties/${key}`)
        })
      }
    }

    // ----------------------------------------------------------------
    // array: items = schema.items || lastOf(extends.items)

    if (ans.isArray()) {
      const raw = schema.type === 'array' && schema.items
      if (raw) {
        ans.items = initCtx.getPatchedSchema(raw, `${schemaId}/items`)
      }

      /* istanbul ignore if */
      if (!ans.items) throw new Error(`Array must define its items. Found in ${schemaId}`)
    }

    // ----------------------------------------------------------------

    delete meta.notReady
  })())

  return ans
}

const patchedSchemaPrototype: Partial<PatchedSchema<any>> = {
  isObject() { return this.type === 'object' },
  isArray() { return this.type === 'array' },

  getDirectChildSchema(this: PatchedSchema<any>, key: any) {
    if (this.isObject()) {
      return this.properties[key] || null;
    }

    if (this.isArray()) {
      if (key === 'length') return this[patchedMark].getCommonSchema('arrayLength')

      const kIndex = +key
      const isIndex = Number.isInteger(kIndex) && kIndex > -1

      if (isIndex) return this.items
      return null
    }

    return null
  },

  getSchemaAtPath(this: PatchedSchema<any>, path) {
    if (typeof path === 'string' && (path.includes('.') || path.includes('['))) {
      // need splitting
      path = toPath(path)
    }

    if (Array.isArray(path)) {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      let ptr: PatchedSchema<any> | null = this;
      for (const p of path) {
        if (!ptr) return null
        ptr = ptr.getDirectChildSchema(p)
      }
      return ptr
    }

    return this.getDirectChildSchema(path)
  }
}

/** @internal */
export interface SchemaPatchingContext {
  generatorQueue: Array<Generator>
  patchedLUT: Record<string, PatchedSchema<any>>
  getPatchedSchema(x: any, preferredSchemaId: string): PatchedSchema<any>
  getCommonSchema(id: CommonSchemaId): PatchedSchema<any>
}