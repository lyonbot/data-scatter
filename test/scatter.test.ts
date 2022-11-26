import { createSchemaRegistry, FromSchemaRegistry } from '../src/schema'
import { dumpNodesFromStorage, loadIntoStorage, ScatterNodeInfo, ScatterStorage } from '../src/scatter'

describe('ScatterStorage', () => {
  const getSchemaRegistry = () => createSchemaRegistry({
    task: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        executor: { type: 'string' },
        subTasks: { type: 'array', items: 'task' }
      }
    },
    note: {
      type: 'object',
      properties: {
        message: { type: 'string' }
      }
    },
    taskEx: {
      type: 'object',
      extends: ['task'],
      properties: {
        difficulty: { type: 'string' }
      }
    }
  })
  type Task = FromSchemaRegistry<ReturnType<typeof getSchemaRegistry>, 'task'>

  test('works', () => {
    const storage = new ScatterStorage({
      schemaRegistry: getSchemaRegistry(),
    });

    const nodes = [] as ScatterNodeInfo[]

    const $nodeCreated = jest.fn((x, nodeInfo: ScatterNodeInfo) => { nodes.push(nodeInfo) });
    const $nodeLostLastReferrer = jest.fn((x, nodeInfo: ScatterNodeInfo) => nodeInfo);
    storage.on('nodeCreated', $nodeCreated)
    storage.on('nodeLostLastReferrer', $nodeLostLastReferrer)

    // -------------------------------
    // then feel free to read / write it

    const sampleData: Task = {
      name: 'shopping',
      subTasks: [
        { name: 'flowers' },
        { name: 'gas' }
      ]
    }

    const task = storage.create('task')
    Object.assign(task, sampleData)

    task.subTasks!.push(task);
    (task.subTasks as any[]).push(null, 1234)    // push some invalid things -- no error shall happen

    // ------------------------------
    // ScatterStorage will automatically make two task nodes!
    // - use getNodeInfo() to check, if it's a node, it will return node info

    expect($nodeCreated).toBeCalledTimes(4)
    expect(nodes[0].referredCount).toBe(1)    // task
    expect(nodes[1].referredCount).toBe(1)    // task.subTasks
    expect(nodes[2].referredCount).toBe(1)    // task.subTasks[0]
    expect(nodes[3].referredCount).toBe(1)    // task.subTasks[1]

    expect(task.subTasks![2]).toBe(task)
    expect(task.subTasks![3]).toBe(null)
    expect(task.subTasks![4]).toBe(1234)

    const $subTaskArray = storage.getNodeInfo(task.subTasks!)!
    const $subTask0 = storage.getNodeInfo(task.subTasks![0])!

    expect($subTaskArray).toBe(nodes[1])
    expect($subTask0).toBe(nodes[2])
    expect($subTask0.schema).toBe(storage.schemaRegistry.get('task'))

    // ------------------------------

    task.subTasks!.shift()
    expect($subTask0.referredCount).toBe(0)
    expect($subTaskArray.refsCount).toBe(2)
    expect($nodeLostLastReferrer).toBeCalledTimes(1) // subTask[flowers] lost last referrer

    // ------------------------------

    $nodeLostLastReferrer.mockClear()

    task.subTasks!.length = 0// remove all
    expect($subTaskArray.refsCount).toBe(0)
    expect($nodeLostLastReferrer).toBeCalledTimes(2) // task and subTask[gas] lost last referrer

    // ------------------------------

    $nodeCreated.mockClear();

    (task as any).meta = { foo: [task] };
    expect($nodeCreated).toBeCalledTimes(2)  // meta object & meta.foo array
    expect(nodes[nodes.length - 2].proxy).toEqual({ foo: [task] })
    expect(nodes[nodes.length - 1].proxy).toEqual([task])
  })

  test('dump and load to another storage', () => {
    const storage = new ScatterStorage({ schemaRegistry: getSchemaRegistry() });
    const storage2 = new ScatterStorage({ schemaRegistry: getSchemaRegistry() })

    const task = storage.create('task')
    const $task = storage.getNodeInfo(task)!

    Object.assign(task, {
      name: 'shopping',
      meta: {
        foo: [task]   // circular!
      },
      subTasks: [
        { name: 'flowers' }
      ]
    })

    // ------------------------------

    const dumped = dumpNodesFromStorage({ storage, nodes: [$task.id] })
    expect(dumped.output.length).toEqual(5)

    const loadRes = loadIntoStorage({ storage: storage2, nodes: dumped.output })
    {
      expect(loadRes.loaded).toHaveLength(5)
      expect(loadRes.updated).toHaveLength(0)
      expect(loadRes.renamed).toHaveLength(0)

      const imported = storage2.get($task.id)
      expect(imported).toEqual({
        name: 'shopping',
        meta: {
          foo: [imported]   // circular!
        },
        subTasks: [
          { name: 'flowers' }
        ]
      })
    }

    const loadAgainRes = loadIntoStorage({ storage: storage2, nodes: dumped.output })
    {
      expect(loadAgainRes.loaded).toHaveLength(5)
      expect(loadAgainRes.updated).toHaveLength(5) // <-
      expect(loadAgainRes.renamed).toHaveLength(0)

      const imported = storage2.get($task.id)
      expect(imported).toEqual({
        name: 'shopping',
        meta: {
          foo: [imported]   // circular!
        },
        subTasks: [
          { name: 'flowers' }
        ]
      })
    }
  })

  test('disposeOrphanNodes', () => {
    const storage = new ScatterStorage({ schemaRegistry: getSchemaRegistry() });

    const task = storage.create('task')
    const $task = storage.getNodeInfo(task)!

    Object.assign(task, {
      name: 'shopping',
      meta: {
        foo: [task]   // circular!
      },
      subTasks: [
        { name: 'flowers' }
      ]
    })

    // -----------------------------
    // test dispose nodes

    // cannot nuclear all nodes: there is a loop in dependency graph!
    // task === task.meta.foo[0]

    expect(storage.orphanNodes.size).toBe(0)

    storage.disposeOrphanNodes()
    expect(storage.nodes.size).not.toBe(0)
    expect(storage.orphanNodes.size).toBe(0) // task === task.meta.foo[0]

    // cannot manually dispose those node

    const $subTask = storage.getNodeInfo(task.subTasks![0])!
    expect(() => { $subTask.dispose() }).toThrowError('Node is referred, cannot be disposed')
    expect(() => { $task.dispose() }).toThrowError('Node is referred, cannot be disposed')

    // unlink task.meta

    const $orphanMeta = storage.getNodeInfo((task as any).meta)!
    delete (task as any).meta
    expect(storage.orphanNodes.size).toBe(1) // the deleted "task.meta" object
    expect(storage.orphanNodes).toContain($orphanMeta)
    expect(() => { $task.dispose() }).toThrowError('Node is referred, cannot be disposed')

    // kill task.meta, auto unlink task.meta.foo

    const $orphanMetaFoo = storage.getNodeInfo($orphanMeta.proxy.foo)!
    $orphanMeta.dispose()
    expect(storage.orphanNodes.size).toBe(1) // "task.meta" is gone, kills the only ref to "task.meta.foo"
    expect(storage.orphanNodes).toContain($orphanMetaFoo)

    // kill task.meta.foo, auto unlink task

    $orphanMetaFoo.dispose()
    expect(storage.orphanNodes.size).toBe(1) // "task.meta.foo" is gone, kills the only ref to "task"
    expect(storage.orphanNodes).toContain($task)

    // nuclear all nodes: task is an orphan, and there is no loop in dependency graph!

    storage.disposeOrphanNodes()
    expect(storage.orphanNodes.size).toBe(0)
    expect(storage.nodes.size).toBe(0)
  })


  test('treeshake', () => {
    const storage = new ScatterStorage({ schemaRegistry: getSchemaRegistry() });

    const task = storage.create('task')
    Object.assign(task, {
      name: 'shopping',
      meta: {
        foo: [task]   // circular!
      },
      subTasks: [
        { name: 'flowers' }
      ]
    })

    // -----------------------------
    // hold task, create an orphan and dispose the orphan

    const orphanNote = storage.create('note', {
      message: 'this orphan be removed, even it referred task',
      task
    })
    const result1 = storage.treeshake({ entries: [task] })
    expect(result1.ids).toHaveLength(1)
    expect(orphanNote).toEqual({}) // empty object

    // ----------------------------
    // hold task.subTasks + skips task = nothing happens

    const subTasks = task.subTasks

    const result2 = storage.treeshake({
      entries: [subTasks],
      skips: (_, nodeInfo) => nodeInfo.proxy === task
    })
    expect(result2.ids).toHaveLength(0)

    // ----------------------------
    // hold task.subTasks, dispose: task, task.meta, task.meta.foo

    const $beforeDispose = jest.fn((nodes: any[]) => {
      expect(nodes.length).toBe(3)
    })
    const result3 = storage.treeshake({ entries: [subTasks], beforeDispose: $beforeDispose })
    expect($beforeDispose).toBeCalledTimes(1)
    expect(result3.ids).toHaveLength(3)
    expect(task).toEqual({})
    expect(storage.nodes.size).toEqual(2)
  })

  test.each([true, false])('disallowSubTypeAssign: %p', (disallowSubTypeAssign) => {
    const storage = new ScatterStorage({
      schemaRegistry: getSchemaRegistry(),
      disallowSubTypeAssign: disallowSubTypeAssign,
    });

    const mainTask = storage.create('task', {
      name: 'exercise',
      subTasks: []
    })
    const hardTask = storage.create('taskEx', {
      name: 'abs workout',
      difficulty: 'very hard',
      subTasks: [
        { name: 'warm up' }
      ]
    })

    const $nodeCreated = jest.fn()
    storage.on('nodeCreated', $nodeCreated)
    mainTask.subTasks!.push(hardTask)

    if (disallowSubTypeAssign) {
      expect(mainTask.subTasks![0]).not.toBe(hardTask)
      expect($nodeCreated).toBeCalledTimes(1)  // `subTasks` is directly reused!
    } else {
      expect(mainTask.subTasks![0]).toBe(hardTask)
      expect($nodeCreated).not.toBeCalled()
    }
  })

  test('loadIntoStorage', () => {
    const storage = new ScatterStorage({
      schemaRegistry: getSchemaRegistry(),
    });

    const task1 = storage.create('task')
    const $task1 = storage.getNodeInfo(task1)!

    $task1.id = 'task1'
    task1.name = 'buy flowers'

    const res = loadIntoStorage({
      storage,
      nodes: [{
        nodeId: 'task1',
        schemaId: 'task',
        value: { executor: 'lyonbot' },
        refs: { subTasks: 'array1', meta: 'anonymousObject1' }
      }, {
        nodeId: 'array1',
        schemaId: 'task/properties/subTasks',
        refs: { '0': 'task1' },
        value: [null]
      }, {
        nodeId: 'anonymousObject1',
        schemaId: '',
        value: { hello: 'world' },
        refs: { task: 'task1' }
      }]
    })

    expect(res.loaded).toHaveLength(3)
    expect(res.loaded).toContain(storage.getNodeInfo(task1))
    expect(res.renamed).toEqual([])

    expect(task1).toEqual({
      // name: ... is discarded
      executor: 'lyonbot',
      meta: {
        hello: 'world',
        task: task1 // anonymous object is referencing task1
      },
      subTasks: [task1] // subTasks is a self-looped array
    })
  })

  test('loadIntoStorage: async loader + rename id-same schema-different old node', async () => {
    const storage = new ScatterStorage({
      schemaRegistry: getSchemaRegistry(),
    });

    const note1 = storage.create('note')
    const $note1 = storage.getNodeInfo(note1)!

    $note1.id = 'task1'   // <-- id is "task1", but schema is "note"
    note1.message = 'buy flowers'

    // await!
    const res = await loadIntoStorage({
      storage,
      nodes: [{
        nodeId: 'task1',
        schemaId: 'task',
        value: { executor: 'lyonbot' },
        refs: { subTasks: 'array1' }
      }],
      async loader(id) {
        if (id === 'array1') {
          return {
            nodeId: 'array1',
            schemaId: 'task/properties/subTasks',
            refs: { '0': 'task1' },
            value: [null]
          }
        }
      },
    })

    const task1 = storage.get('task1')

    expect(task1).not.toBe(note1)
    expect(note1).toEqual({ message: 'buy flowers' }) // not affected!
    expect($note1.id).not.toBe('task1') // old node's id is changed

    expect(task1).toEqual({
      executor: 'lyonbot',
      subTasks: [task1] // subTasks is a self-looped array
    })

    expect(res.loaded).toHaveLength(2)
    expect(res.loaded).toContain(storage.getNodeInfo(task1))
    expect(res.renamed).toEqual([{ oldId: 'task1', nodeInfo: $note1 }])
  })

  test('loadIntoStorage: throw from loader', async () => {
    const storage = new ScatterStorage({
      schemaRegistry: getSchemaRegistry(),
    });

    await expect(() => loadIntoStorage({
      storage,
      nodes: [{
        nodeId: 'task1',
        schemaId: 'task',
        value: { executor: 'lyonbot' },
        refs: { subTasks: 'array1' }
      }],
      async loader(id) {
        if (id === 'array1') throw new Error('custom async error')
        return null
      },
    })).rejects.toThrowError('custom async error')

    expect(() => loadIntoStorage({
      storage,
      nodes: [{
        nodeId: 'task1',
        schemaId: 'task',
        value: { executor: 'lyonbot' },
        refs: { subTasks: 'array1' }
      }],
      loader(id) {
        if (id === 'array1') throw new Error('custom sync error')
        return null
      },
    })).toThrowError('custom sync error')

    expect(() => loadIntoStorage({
      storage,
      nodes: [{
        nodeId: 'task1',
        schemaId: 'task',
        value: { executor: 'lyonbot' },
        refs: { subTasks: 'array1' }
      }],
      loader() {
        return null
      },
    })).toThrowError('Failed to fetch missing node: array1');
  })
})
