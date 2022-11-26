# data-scatter

## How To Use

1. [Create a **SchemaRegistry**](#SchemaRegistry), define types and relations.
2. [Create a **ScatterStorage**](#ScatterStorage) with the SchemaRegistry.
3. Call `storage.create('schemaId')` and get an empty object / array to mutate.
4. Manipulate the object / array as you like. ScatterStorage will create sub-nodes automatically when needed.
5. [Load and Dump Nodes](#Load-and-Dump-Nodes), (de)serialize all nodes and references

## SchemaRegistry

Use `createSchemaRegistry` to make schemas cross-referencing!

- **Define Schemas, with Cross-Referencing**: easy way to define flexible schemas

```js
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
      employer: null, // delete from inherited properties
    },
  },
});
```

- **Access Schema Registry**: now, you can easily get schema of any properties, in any depth!

```js
const $entrepreneur = registry.get('entrepreneur');
const $person = registry.get('person');

assert($entrepreneur.isObject());
expect($entrepreneur.title).toBe('A person with goals!'); // <- read extra notes

// query via data path - from a schema
expect($person.getSchemaAtPath('children[0].father')).toBe($person);
expect($person.getSchemaAtPath('children[0].employer')).toBe($entrepreneur);

// (not recommended) query via schema path - from registry
const $alsoPerson = registry.get('person/properties/father');
expect($alsoPerson).toBe($person);
```

- **Immutable**: you can't modify a registry, but you can create a new one based on it.

- **Combining Registries**: call `reg1.extend(reg2)` and you will get the larger registry. All existing schemas will not be affected.

- **Works with TypeScript**: no more duplicated declaration! write schema once, get TypeScript type immediately.

```ts
type Person = FromSchemaRegistry<typeof registry, 'person'>;
type Entrepreneur = FromSchemaRegistry<typeof registry, 'entrepreneur'>;
```

<br/>

## ScatterStorage

```ts
const storage = new ScatterStorage({ schemaRegistry: mySchemaRegistry });

// assuming "task" schema is defined, it is an object
// we create an empty Task Object

const task = storage.create('task');

// then feel free to read / write it

task.name = 'shopping';
task.subTasks = [{ name: 'buy flowers' }];

// ScatterStorage will automatically make two task nodes!
// - use getNodeInfo() to check, if it's a node, it will return node info

const subTask1 = storage.getNodeInfo(task.subTasks[0]);
expect(subTask1.schema).toBe(mySchemaRegistry.get('task'));
```

### Generate ID for Nodes

By default nodes has random ID like `task#efe903` (schemaId + random number)

You can also implement `function nodeIdGenerator(storage, schema?): string` and give to **ScatterStorage**.

Note:

- This id can be ugly because it is invisible to users and only used in ScatterStorage.
- When load / dump nodes, we use nodeId to replace current existing nodes

<br/>

## Load and Dump Nodes

This library provides two methods for you. While loading / dumping, all the referencing relations are retained.

### `loadIntoStorage({ storage, nodes, loader? })`

Load nodes into this storage.

- `nodes`: array in the dumped format

- `loader`: (optional) - called when met broken references

  - accepts one parameter: `nodeId: string`
  - returns `null`, data in dumped format, or existing object from `storage.get(...)`
  - can be an async function, but the `loadIntoStorage` will become async too (don't forget _await_)

If met same **nodeId** in current storage:

- Same Schema? Clear current node's content and use loaded data.
- Different? Make a new id for the old node.

Returns `{ loaded, updated, renamed }` when loaded.

- `loaded`: NodeInfo list, including new and updated nodes.

- `updated`: NodeInfo list

- `renamed`: Array of `{ nodeInfo, oldId }`


### `dumpNodesFromStorage({ storage, nodes, skips? })`

Export nodes from storage into dumped format

- `nodes`: array of nodeId, actual object or NodeInfo

- `skips`: (optional) - nodeId list, or `(id, nodeInfo) => boolean`

Returns `{ output, skippedNodes }`

- `output`: array in the dumped format

- `skippedNodes`: NodeInfo list, these nodes are not dumped


### Dumped Format

```js
[
  {
    nodeId: 'xxxxxxxxxxx',
    schemaId: 'task',
    value: {
      name: 'go shopping',
      // subTasks is a ref, not storaged here
    },
    refs: {
      subTasks: 'yyyyyyy',
    },
  },
  // ... other nodes
];
```

<br/>


## Tricks

### How to Write Schema Definitions

First of all, when referencing another schema, you can use:

- schemaId like `"task"`
- nested schema definition, like `{ type: 'string' }`
- a Schema from a registry, like `registry.get('...')`

The `anotherSchema` in examples, can be one of these three forms.

```ts
const objectSampleSchema = {
  type: 'object',

  properties: {
    foo: 'schemaId',
    bar: anotherSchema3,
    baz: registry.get('...'),

    delete_from_inherited: null, // use null to delete a property from `extends`
  },

  // (optional)
  //   inherit from others: properties, patternProperties
  //   priorities are lowest -- can be overridden by this schema self's definitions
  extends: [anotherSchema1, anotherSchema2],

  // (optional)
  //   If a property name matches the given regular expression,
  //   then assume that the property matches the corresponding schema.
  patternProperties: {
    '^str_': { type: 'string' },
    '^num_': { type: 'number' },
    '^task_': anotherSchema6,
  },
};

const arraySampleSchema = {
  type: 'array',
  items: anotherSchema4, // schemaId, nested definition, or registry.get('...')
};
```

### Extend an existing Schema

If you already have a `schemaRegistry`, and there is a `user` schema inside, and you **want to add a property**,
then you can do it like this:

```ts
const newSchemaRegistry = schemaRegistry.extend({
  user: {
    type: 'object',
    extends: [schemaRegistry.get('user')], // <- extends from old `user` schema, from old registry
    properties: {
      newProp: { ... },
    },
  },
})
```

### Check Schema Definitions in TypeScript

If you need, you can define custom fields for schemas.

Add this to your file, then all schema declarations will be affected.

```ts
declare module 'data-scatter' {
  // define new fields for schemas

  export interface SchemaBase {
    description?: string;
    required?: boolean;
    readonly?: boolean;
  }

  // you can also hack ObjectSchema, ArraySchema

  // define new types

  export interface PrimitiveTypeLUT {
    integer: number; // { type: "integer" } -> javascript number
  }
}
```
