import { Nil, Spread } from "../types";
import { CommonSchemaId, commonSchemas } from "./commonSchemas";
import { createPatchedSchema, isPatchedSchema, PatchedSchema, SchemaPatchingContext } from "./PatchedSchema";
import { TypeLUT, SchemaLUT, Schema, SchemaLUT2TypeLUT, } from "./types";

let commonSchemaRegistry: any
const getCommonSchema = (id: CommonSchemaId) => {
  if (!commonSchemaRegistry) commonSchemaRegistry = createSchemaRegistry(commonSchemas)
  return commonSchemaRegistry.get(id)
}

export function createSchemaRegistry<
  U extends SchemaLUT<string & keyof U>,
>(schemaLUT: U): SchemaRegistry<{
  [k in string & keyof U]: SchemaLUT2TypeLUT<U>[k]
}>

export function createSchemaRegistry<
  T2 extends TypeLUT,
  U extends SchemaLUT<string & (keyof T2 | keyof U), string & keyof U>,
>(schemaLUT: U, extendsFrom: SchemaRegistry<T2>): SchemaRegistry<{
  [k in string & (keyof T2 | keyof U)]: k extends keyof U ? SchemaLUT2TypeLUT<U>[k] : T2[k]
}>

export function createSchemaRegistry(schemaLUT: any, extendsFrom?: SchemaRegistry<any>) {
  if (extendsFrom instanceof SchemaRegistry) schemaLUT = { ...extendsFrom.schemaLUT, ...schemaLUT }
  return new SchemaRegistry<any>(schemaLUT)
}

class SchemaRegistry<T extends TypeLUT> {
  readonly schemaLUT: { [k in keyof T]: PatchedSchema<T[k]> }

  constructor(schemaLUT: SchemaLUT) {
    const output = {} as Record<string, PatchedSchema<any>>;
    const visitedInstances = new Map<Schema, PatchedSchema<any>>()

    let refs = [] as [id: string, referTo: string][];
    const sInitCtx: SchemaPatchingContext = {
      generatorQueue: [],
      getCommonSchema,
      getPatchedSchema(input, preferredId) {
        if (typeof input === 'string') input = querySchema(output, input);

        if (!input) throw new Error(`Missing schema for ${preferredId}`)
        if (isPatchedSchema(input)) return input;

        let sealedSchema = visitedInstances.get(input)
        if (!sealedSchema) {
          sealedSchema = createPatchedSchema(sInitCtx, input, preferredId)
          visitedInstances.set(input, sealedSchema)
        }

        return sealedSchema
      },
    }

    Object.keys(schemaLUT).forEach(id => {
      const value = schemaLUT[id];
      if (value && typeof value === 'string') refs.push([id, value]);
      else output[id] = sInitCtx.getPatchedSchema(value, id);
    })

    while (refs.length) {
      const newRefs = [] as typeof refs
      for (const it of refs) {
        const [id, referTo] = it
        const to = output[referTo];
        if (to) output[id] = to;
        else newRefs.push(it);
      }

      if (!newRefs.length) break;
      if (refs.length === newRefs.length) throw new Error('Some schema is loop-referenced')
      refs = newRefs;
    }

    while (sInitCtx.generatorQueue.length) {
      const generator = sInitCtx.generatorQueue.shift()!
      if (!generator.next().done) sInitCtx.generatorQueue.push(generator)
    }

    // once a registry instance is created, it cannot be be modified
    // but you can extend it and get new registry

    this.schemaLUT = Object.freeze(output as any)
  }

  /**
   * get a registered and patched schema, which provides some useful methods
   * 
   * @param query - schema id, or expression like `"task/properties/foo"`
   * @returns PatchedSchema object
   */
  get<K extends keyof T>(query: K): PatchedSchema<T[K]>
  get(query: string): PatchedSchema<any> | Nil
  get(query: string) {
    return querySchema(this.schemaLUT, query)
  }

  /**
   * mix two SchemaRegistries, return new Registry
   *
   * note:
   * 
   * - if input is `anotherRegistry`, all original references will remain unchanged, even if the id is overwritten
   * - if input is a new and raw SchemaLUT, all refs will be resolved
   */
  extend<U extends TypeLUT>(anotherRegistry: SchemaRegistry<U> | Nil): SchemaRegistry<Spread<T, U>>
  extend<U extends {
    [k: string]: Schema<((keyof U | keyof T) & string)> | ((keyof U | keyof T) & string)
  }>(schemaLUT: U): SchemaRegistry<SchemaLUT2TypeLUT<{
    [k in (keyof T | keyof U) & string]: k extends keyof U ? U[k] : PatchedSchema<T[k]>
  }>>
  extend<U>(...others: any[]): SchemaRegistry<Spread<T, U>> {
    let writtenCount = 0;
    const u: SchemaLUT = { ...this.schemaLUT }

    for (const item of others) {
      if (!item || typeof item !== 'object' || Object.keys(item).length === 0) continue;

      const otherRegistry = item instanceof SchemaRegistry ? item : createSchemaRegistry({ ...u, ...item })
      const schemaLUT = otherRegistry.schemaLUT

      writtenCount += Object.keys(schemaLUT).length
      Object.assign(u, schemaLUT)
    }


    if (!writtenCount) return this as SchemaRegistry<any>
    return new SchemaRegistry(u)
  }
}

export type { SchemaRegistry }

/**
 * extract a TypeScript type from a SchemaRegistry.
 * 
 * @example
 *   const theRegistry = createSchemaRegistry({
 *     myTable: { ... }
 *   })
 * 
 *   type MyTable = FromSchemaRegistry<typeof theRegistry, 'myTable'>
 *   const table1: MyTable = { ... }
 */
export type FromSchemaRegistry<T extends SchemaRegistry<any>, K extends keyof T['schemaLUT']> = T['schemaLUT'][K] extends PatchedSchema<infer R> ? R : unknown


function querySchema(schemaLUT: Record<string, PatchedSchema<any>>, query: string): PatchedSchema<any> | Nil {
  if (!query) return null;
  const ans = schemaLUT[query] as PatchedSchema<any> | Nil
  if (!ans && query.includes('/')) {
    const parts = query.split('/')
    let ptr: any = schemaLUT[parts.shift()!]
    while (ptr && parts.length) ptr = ptr[parts.shift()!]
    if (isPatchedSchema(ptr)) return ptr
  }
  return ans
}