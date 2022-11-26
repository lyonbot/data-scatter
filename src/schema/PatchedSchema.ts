import isNil from "lodash/isNil";
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
  /** the shortest schema name, like `task`, or `task/items` if is anonymous schema */
  schemaId: string;
  uuid: string;
  /** @internal */
  notReady?: boolean;
  /** get some common schema like "length" of "Array" */
  getCommonSchema(id: CommonSchemaId): PatchedSchema<any>;
  /** resolve patternProperties */
  resolvePatternProperty?(key: string): PatchedSchema<any> | null;
}

export interface PatchedSchema<T> extends SchemaBase {
  /** internal marker */
  readonly [patchedMark]: PatchedSchemaMeta

  /** the shortest schema name, like `task`, or `task/items` if is anonymous schema */
  readonly $schemaId: string;

  extends?: PatchedSchema<any>[]

  isObject(): this is PatchedObjectSchema<T>;
  isArray(): this is PatchedArraySchema<T>;

  getDirectChildSchema<K extends keyof T>(key: K): PatchedSchema<T[K]> | null
  getDirectChildSchema(key: string | number): PatchedSchema<any> | null

  /** query another schema via data path */
  getSchemaAtPath(path: string | number | (string | number)[]): PatchedSchema<any> | null
}

export interface PatchedObjectSchema<T> extends Spread<ObjectSchema, PatchedSchema<T>> {
  type: 'object'
  properties: { [k in keyof T]: PatchedSchema<T[k]> }
  patternProperties?: { [k: string]: PatchedSchema<any> }
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
  Object.defineProperty(ans, '$schemaId', { enumerable: false, configurable: false, value: schemaId })

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
      const mergePropertyMap = (key: 'properties' | 'patternProperties') => {
        const writeTo = {} as any

        if (ans.extends) {
          for (const e of ans.extends) {
            if (e.isObject()) Object.assign(writeTo, e[key])
          }
        }

        const raw = schema.type === 'object' && schema[key]
        if (raw) {
          Object.keys(raw).forEach(key => {
            const query = raw[key];
            if (isNil(query)) {
              if (key in writeTo) delete writeTo[key];
            } else {
              writeTo[key] = initCtx.getPatchedSchema(query, `${schemaId}/properties/${key}`)
            }
          })
        }

        return writeTo
      }

      ans.properties = mergePropertyMap('properties')
      ans.patternProperties = mergePropertyMap('patternProperties')

      const patternProperties = ans.patternProperties!
      if (Object.keys(patternProperties).length === 0) {
        delete ans.patternProperties
      } else {
        const matches = Object.keys(patternProperties).map(pattern => [new RegExp(pattern), patternProperties![pattern]] as const)
        meta.resolvePatternProperty = k => {
          if (typeof k !== 'string') return null;
          for (const it of matches) {
            if (it[0].test(k)) return it[1]
          }
          return null
        }
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

  getDirectChildSchema(this: PatchedSchema<any>, key: any): PatchedSchema<any> | null {
    if (this.isObject()) {
      let ans: PatchedSchema<any> | null = this.properties[key]
      if (!ans && this.patternProperties) ans = this[patchedMark].resolvePatternProperty!(key)

      return ans || null;
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
  getPatchedSchema(x: any, preferredSchemaId: string): PatchedSchema<any>
  getCommonSchema(id: CommonSchemaId): PatchedSchema<any>
}
