import { createSchemaRegistry, FromSchemaRegistry } from '../src/schema'
import { ScatterNodeInfo, ScatterStorage } from '../src/scatter'

describe('ScatterStorage', () => {
  const getSchemaRegistry = () => createSchemaRegistry({
    task: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        subTasks: { type: 'array', items: 'task' }
      }
    },
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

    task.subTasks!.splice(0) // remove all
    expect($subTaskArray.refsCount).toBe(0)
    expect($nodeLostLastReferrer).toBeCalledTimes(2) // task and subTask[gas] lost last referrer
  })
})
