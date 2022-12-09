import { ScatterNodeInfo, ScatterStorage } from '../../src/scatter'
import { getSchemaRegistry, Task } from './fixture'

describe('ScatterStorage', () => {
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
})
