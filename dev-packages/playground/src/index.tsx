import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import { ObjectInspector } from 'react-inspector'
import { createSchemaRegistry, FromSchemaRegistry, ScatterStorage } from 'data-scatter'
import { DebugPanel } from './DebugPanel';

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
    title: 'A person with goals!', // <- extra notes
    extends: ['person'], // <- inherit properties from `person`
    properties: {
      goals: { type: 'array', items: { type: 'string' } }, // add string[]
      employer: null, // not inherit this property
    },
  },

  task: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      executor: { type: 'string' },
      subTasks: { type: 'array', items: 'task' },
      assignee: 'person'
    }
  },
});

const storage = new ScatterStorage({ schemaRegistry: registry })

const sampleData: FromSchemaRegistry<typeof registry, 'task'> = {
  name: 'go shopping',
  assignee: { name: 'Tony' },
  subTasks: [
    { name: 'buy flowers' },
    { name: 'buy chocolate' },
  ]
}

const doc = storage.create('task', sampleData)

const global = { registry, storage, doc }
Object.assign(window, global)


const root = ReactDOM.createRoot(document.getElementById('app')!);
root.render(<div>

  <DebugPanel />
  <ObjectInspector data={global} />

</div>)
