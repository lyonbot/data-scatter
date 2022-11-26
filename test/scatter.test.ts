import { createSchemaRegistry, FromSchemaRegistry } from '../src/schema'
import { loadIntoStorage, ScatterNodeInfo, ScatterStorage } from '../src/scatter'
import { omit } from 'lodash'

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
        refs: { subTasks: 'array1' }
      }, {
        nodeId: 'array1',
        schemaId: 'task/properties/subTasks',
        refs: { '0': 'task1' },
        value: [null]
      }]
    })

    expect(res.loaded).toHaveLength(2)
    expect(res.loaded).toContain(storage.getNodeInfo(task1))
    expect(res.renamed).toEqual([])

    expect(omit(task1, 'subTasks')).toEqual({
      // name: ... is discarded
      executor: 'lyonbot',
      // subTasks is a self-looped array. check it later.
    })
    expect(task1.subTasks![0]).toBe(task1)
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

    expect(omit(task1, 'subTasks')).toEqual({
      executor: 'lyonbot',
      // subTasks is a self-looped array. check it later.
    })
    expect(task1.subTasks![0]).toBe(task1)

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
