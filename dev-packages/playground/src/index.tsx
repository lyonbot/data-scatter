import * as React from 'preact';
import { createSchemaRegistry } from 'data-scatter'

declare module "data-scatter" {

  // add basic fields for schemas

  export interface SchemaBase {
    description?: string
    tooltip?: string
  }
  
  // add basic types
  // so you can use them like { type: "integer" }

  export interface PrimitiveTypeLUT {
    integer: number,  // { type: "integer" } -> javascript number
  }
}

const registry = createSchemaRegistry({
  // ----------------------------------------------------------------
  // define a schema in JSON-Schema like format
  person: {
    type: 'object',
    properties: {
      // you can define type in JSON Schema
      name: { type: 'string' },

      // or just refer to a defined type
      father: 'person',
      mother: 'person',
      employer: 'entrepreneur',

      // you can also do it in a nested type
      // ( see `items` )
      children: { type: 'array', items: 'person' },
    },
  },

  // ----------------------------------------------------------------
  // extend an existing object schema
  entrepreneur: {
    type: 'object',
    title: 'A person with ambitions!', // <- extra notes
    extends: ['person'], // <- inherit properties from `person`
    properties: {
      permissions: { type: 'array', items: { type: 'string' } }, // add string[]
    },
  },

  test: { type: "integer" }
});

window.registry = registry

React.render(
  <div>test</div>,
  document.getElementById('app')!
)
