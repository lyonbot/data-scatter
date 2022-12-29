import { createSchemaRegistry, FromSchemaRegistry, ScatterStorage } from 'data-scatter';
import { loadIntoStorage, dumpOneNode, dumpNodesFromStorage, NodeContentObserver, Watcher, NodeInfo } from 'data-scatter'

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
    title: 'A person with goals!',
    extends: ['person'],
    properties: {
      goals: { type: 'array', items: { type: 'string' } },
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

export const storage = new ScatterStorage({ schemaRegistry: registry });

const sampleData: FromSchemaRegistry<typeof registry, 'task'> = {
  name: 'go shopping',
  assignee: { name: 'Tony' },
  subTasks: [
    { name: 'buy flowers' },
    { name: 'buy chocolate' },
  ]
};

const doc = storage.create('task', sampleData);

export const global = {
  registry,
  storage,
  doc,
  createSchemaRegistry,
  ScatterStorage,
  loadIntoStorage,
  dumpOneNode,
  dumpNodesFromStorage,
  NodeContentObserver,
  Watcher,
};
