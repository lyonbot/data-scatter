# data-scatter

## How To Use

1. [Create a **SchemaRegistry**](#SchemaRegistry), define types and relations.

2. [Create a **ScatterStorage**](#ScatterStorage) with the SchemaRegistry.

3. Call `storage.create('schemaId')` and get an empty object / array to manipulate.

4. Manipulate the object / array in arbitrary ways you like.

   - ScatterStorage will automatically create and manage nodes. Feel free to `data.xxx = {...}`
   - there is no auto garage-collect, you shall [Clean unused Nodes](#clean-unused-nodes) at the appropriate moment
   - meanwhile, you can use [**NodeContentObserver**](#NodeContentObserver) to collect dependencies and edits.

5. [Load and Dump Nodes](#Load-and-Dump-Nodes), (de)serialize all nodes and references

<br />

## SchemaRegistry

Use `createSchemaRegistry` to define Schemas.

The schemas can do Cross-Referencing and be Self-Contained (like `father` of _person_ is still a _person_):

More details can be found in [Appendix](#appendix), including [How to Write Schema Definitions](#how-to-write-schema-definitions) and [Mastering the SchemaRegistry API](#Mastering-the-SchemaRegistry-API)

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

<br/>

## ScatterStorage

```ts
const storage = new ScatterStorage({ schemaRegistry: mySchemaRegistry });

// create a object / array based on a schema
// then feel free to read / write it

const task = storage.create('task');
task.name = 'shopping';
task.subTasks = [{ name: 'buy flowers' }];

expect(task).toEqual({
  name: 'shopping',
  subTasks: [{ name: 'buy flowers' }],
});

// ScatterStorage will automatically make 2 nodes: the `subTasks` array and the `buy-flowers` Task
// you can use getNodeInfo() to check, if it's a node, it will return node info

const subTask1 = task.subTasks[0];
expect(subTask1).toEqual({ name: 'buy flowers' });

const $$subTask1 = storage.getNodeInfo(subTask1);
expect($$subTask1.schema).toBe(mySchemaRegistry.get('task'));
```

### Generate ID for Nodes

By default nodes has random ID like `task#efe903` (schemaId + random number)

You can also implement `function nodeIdGenerator(storage, schema?): string` and give to **ScatterStorage**.

Note:

- This id can be ugly because it is invisible to users and only used in ScatterStorage.
- When load / dump nodes, we use nodeId to match and update existing nodes

### Clean unused Nodes

When nodes lost last referrer, the `storage` will fire `"nodeLostLastReferrer"` event.

When event is fired, DO NOT IMMEDIATELY start cleaning -- the node might be reused soon. It's suggested to wait for few seconds.

You can use these methods to do clean-up

#### `storage.treeshake(entries, { skips?, beforeDispose? }?)`

scan nodes from entries, then dispose all unreferenced nodes

- `entries` - one or many (nodeId / NodeInfo / array or object managed by this storage)
- `options`
  - `skips` - optional, array of nodeId, or `(id: string, nodeInfo: NodeInfo) => boolean`
  - `beforeDispose` -- called with `NodeInfo[]` before disposing nodes. this is the last moment you can read the data

#### `storage.disposeOrphanNodes()`

remove orphan nodes, but will reserve nodes that have self-referencing loop inside

- `skips` - optional, array of nodeId, or `(id: string, nodeInfo: NodeInfo) => boolean`

### Iterate through the Nodes

Use `storage.walk(entries, callback, options?)` to do a BFS search

```js
// provide one or more start points
storage.walk(['task1'], step => {
  if (step.isVisited) return 'skip-children'; // may skip self-referencing loops

  console.log(`visit ${step.path.join('/')}`);
  console.log(` - nodeId: ${step.nodeId}`);
  console.log(` - schema: ${step.schema}`);
});
```

The callback function

<br/>

## Load and Dump Nodes

### `loadIntoStorage({ storage, nodes, loader? })`

Load nodes into a storage.

- `nodes`: array in the dumped format

- `loader`: (optional) - called when met broken references

  - accepts one parameter: `nodeId: string`
  - can be an async function, but the `loadIntoStorage` will become async too (don't forget _await_)
  - the return value could be
    - `null`
    - node data in dumped format
    - or existing object from `storage.get(...)`
    - or a NodeInfo from `storage.getNodeInfo(...)`
    - or a nodeId string that exists in the storage

If met same **nodeId** in current storage:

- Same Schema? Clear current node's content and use loaded data.
- Different? Rename the existing node.

Returns `{ loaded, updated, renamed }` when loaded.

- `loaded`: Array of NodeInfo, including new and updated nodes.

- `updated`: Array of NodeInfo

- `renamed`: Array of `{ nodeInfo, oldId }`

### `dumpNodesFromStorage({ storage, nodes, skips? })`

Export nodes from storage into dumped format

- `nodes`: array of nodeId, actual object or NodeInfo

- `skips`: (optional) - nodeId list, or `(id, nodeInfo) => boolean`

Returns `{ output, skippedNodes }`

- `output`: array in the dumped format

- `skippedNodes`: Array of NodeInfo, these nodes are not included in `output`

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

## NodeContentObserver

a NodeContentObserver can:

1. create a Watcher and collect all "read" access as the watcher's dependencies
2. start watch the whole storage, gather mutations

With the observer, you can:

- Make things reactive like _Vue reactive_ and _Mobx_
- Implement undo / redo feature
- Make collative editing possible

### Collect Edits

This helps you find out what is changed and edited in _the whole ScatterStorage_

1. `startGatherMutation()` -- start collecting all write access, including `set` and `delete`

2. if things changed, the `"mutated"` event will be triggered

   - you can also use `hasMutationGathered()` to check whether things changed

3. you can gather all mutations with `stopGatherMutation()`, meanwhile the progress will be stopped

```js
const observer = new NodeContentObserver(storage); // observer is reusable

observer.startGatherMutation();
observer.on('mutationCollected', () => {
  const changes = observer.stopGatherMutation();
  console.log(changes); // can be null if value not changed
});

// ... edit data of storage
task1.name = 'aaaaa';
task1.tags.push('Shopping');
```

In the result, all the intermediate values will be discarded -- you can only get the newest and oldest values between `startGatherMutation()` and `stopGatherMutation()`

The result is a `null` or a two-layer Map: `Map<NodeInfo>` -> `Map<string | number>` -> `NodeWriteAccessAction`

- `NodeWriteAccessAction` contains `{ isDeleted, oldValue, newValue, oldRef, newRef }` and the *ref* is a NodeInfo instance

```js
if (!changes) {
  console.log('nothing changed');
  return;
}

changes.forEach((content, node) => {
  console.log(`node "${node.id}" is changed`);
  content.forEach((action, key) => {
    // actions: { isDeleted, oldValue, newValue, oldRef, newRef }
    if (action.isDeleted) {
      console.log(` - ${key}: deleted`);
    } else if (action.newRef) {
      console.log(` - ${key}: link to node "${action.newRef.id}"`);
    } else {
      console.log(` - ${key}: set value`, action.newValue);
    }
  });
});
```

### Collect Dependencies

Like Vue and Mobx, you can:

1. `startCollectDep` -- start to collect and record "read accesses" as dependencies
2. do some computing, rendering, etc.
3. `stopCollectDep` -- stop collecting and get a **Watcher** -- with dependency infos inside
4. Use watcher's `startWatch(callback)` and `stopWatch()` to react when things change

```js
const observer = new NodeContentObserver(storage); // observer is reusable

const watcher = observer.startCollectDep();

// ... access data of storage
// ... and all read access will be collected as watcher's dep

observer.stopCollectDep();

// now we get the watcher

watcher.startWatch(() => {
  watcher.stopWatch();

  console.log('changed!');
});
```

Note that it's a violation to mutate data inside `callback` because it may cause Infinite-loop!

The `startWatch(...)` accepts optional 2nd parameter -- a `callbackForDeadLoop`. When the violation is detected, it will be invoked rather than `callback`

<br/>

<span style="font-size: 3em">📚</span>

## Appendix

### Mastering the SchemaRegistry API

#### 🏗️ Make Registry Bigger

A SchemaRegistry is **immutable** -- you can't modify a registry, but you can use `reg1.extend(reg2)` to get an extended registry. All existing schemas will not be affected.

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

Beware that if the old `user` schema is already referenced by others, the old references will NOT be affected!

#### 👌 Get Schemas

You can easily get schema of any properties, in any depth!

- `registry.get('schemaId')`

It will return a [**PatchedSchema**](#what-is-patchedschema), which have the same content as your declarations, plus useful extra APIs (eg. `isObject()` and `getSchemaAtPath('...')` below)

```js
const $entrepreneur = registry.get('entrepreneur');
const $person = registry.get('person');

assert($entrepreneur.isObject());
expect($entrepreneur.title).toBe('A person with goals!'); // <- read info from a schema

// query via data path - from a schema
expect($person.getSchemaAtPath('children[0].father')).toBe($person);
expect($person.getSchemaAtPath('children[0].employer')).toBe($entrepreneur);

// (not recommended) query via schema path - from registry
const $alsoPerson = registry.get('person/properties/father');
expect($alsoPerson).toBe($person);
```

<br/>

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

<br/>

### What is PatchedSchema

In DevTool Console, the type of `registry.get('...')` is displayed as **_PatchedSchema_**.

A _PatchedSchema_ object:

- its content is the same as the corresponding raw schema declaration

- all (nested) schemas declaraions and references, are normalized to _PatchedSchema_

  - `extends`
  - `items` of array schema
  - `properties.*` of object schema

- could have self-referencing loop, do not serialize it.

- added some util methods and fields

  - `$schemaId: string`

    the shortest schema name, like `"task"`, or `"task/items"` if is anonymous schema

  - `isObject(): boolean`
  - `isArray(): boolean`
  - `getSchemaAtPath(dataPath: string | number | string[]): PatchedSchema | null`

    query a (nested) property / item's schema, if this schema's type is object or array.

    the `dataPath` could be `"propertyName"`, `123`, `"author.email"` or `["author", "email"]`

  - `isExtendedFrom(otherSchema: PatchedSchema): boolean`

    recursively check if the schema is extended form `otherSchema`

    caveats:

    - returns **true** if `this === otherSchema`
    - returns **false** if `otherSchema` is null

To check if an object is _PatchedSchema_, call `isPatchedSchema(obj)`

<br/>

## Works with TypeScript

1. You can get the TypeScript types directly from a `registry`

```ts
type Person = FromSchemaRegistry<typeof registry, 'person'>;
type Entrepreneur = FromSchemaRegistry<typeof registry, 'entrepreneur'>;
```

2. Want some custom fields in schema declarations? Add this to your file, then all schema declarations will be affected and checked by TypeScript

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
