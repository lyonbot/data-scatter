/* eslint-disable @typescript-eslint/ban-types */

import type { PatchedSchema } from './PatchedSchema'

// ----------------------------------------------------------------
// these interface is extensible!
// feel free to hack them

export interface SchemaBase {
  type: string;
  title?: string;
}

export interface PrimitiveTypeLUT {
  boolean: boolean;
  string: string;
  number: number;
  any: any;
}

// ----------------------------------------------------------------
// basic schema definitions

export interface ObjectSchema<SchemaID extends string = string> extends SchemaBase {
  type: 'object',
  extends?: Array<Schema<SchemaID> | SchemaID>
  properties?: { [k: string]: Schema<SchemaID> | SchemaID | null }
  patternProperties?: { [k: string]: Schema<SchemaID> | SchemaID | null }
}

export interface ArraySchema<SchemaID extends string = string> extends SchemaBase {
  type: 'array',
  extends?: Array<Schema<SchemaID> | SchemaID>
  items: Schema<SchemaID> | SchemaID
}

export interface PrimitiveSchema<SchemaID extends string = string> extends SchemaBase {
  type: keyof PrimitiveTypeLUT
  extends?: Array<Schema<SchemaID> | SchemaID>
}

export { PatchedSchema as PatchedSchema }

// ----------------------------------------------------------------
// here comes magic

export type Schema<SchemaID extends string = string> =
  | ObjectSchema<SchemaID>
  | ArraySchema<SchemaID>
  | PrimitiveSchema<SchemaID>
  | PatchedSchema<any>

export type SchemaLUT<SchemaID extends string = string, SelfSchemaID extends string = SchemaID> = {
  [k in SelfSchemaID]: Schema<SchemaID> | SchemaID
}

export type Schema2Type<S, LUT extends SchemaLUT = {}, UNKNOWN_TYPE = unknown> =
  S extends keyof LUT ? Schema2Type<LUT[S], LUT, UNKNOWN_TYPE> :
  S extends ArraySchema ? Array<Schema2Type<S['items'], LUT, UNKNOWN_TYPE>> :
  S extends ObjectSchema ? (
    { [k in keyof S['properties']]?: Schema2Type<S['properties'][k], LUT, UNKNOWN_TYPE> }
    & ResolveObjectExtends<S, LUT>
  ) :
  S extends PrimitiveSchema ? PrimitiveTypeLUT[S['type']] :
  S extends PatchedSchema<infer R> ? R :
  S extends null ? never :
  UNKNOWN_TYPE

export type SchemaLUT2TypeLUT<LUT extends SchemaLUT, UNKNOWN_TYPE = unknown> = {
  [k in keyof LUT]: Schema2Type<LUT[k], LUT, UNKNOWN_TYPE>
}

// this may results `{ foo: string } & { bar: number }`
// see test1

type ResolveObjectExtends<ObjectSchema, LUT extends SchemaLUT = {}> =
  ObjectSchema extends { extends: (infer R)[] } ? Intersect<Schema2Type<R, LUT>> : unknown

// type test1 = ResolveObjectExtends<['user', 'dog'], {
//   a: { type: 'object', properties: { x: { type: 'string' } } },
//   user: { type: 'object', properties: { uid: { type: 'string' } } },
//   dog: { type: 'object', properties: { woof: { type: 'string' } } },
// }>

// see https://stackoverflow.com/questions/50374908/transform-union-type-to-intersection-type
type Intersect<T> = (T extends any ? (x: T) => 0 : never) extends ((x: infer R) => 0) ? R : never

// ----------------------------------------------------------------
// registry implementation

export type TypeLUT = { [k: string]: any }
