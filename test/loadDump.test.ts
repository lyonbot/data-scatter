import { dumpNodesFromStorage, loadIntoStorage, ScatterStorage } from '../src/scatter'
import { getSchemaRegistry, sampleDumpedData1 } from './fixture'

describe('loadDump', () => {
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
      nodes: sampleDumpedData1
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
      subTasks: [task1, null] // subTasks is a self-looped array
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
    const resPromise = loadIntoStorage({
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
    expect(resPromise).toBeInstanceOf(Promise)
    
    const res = await resPromise

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
