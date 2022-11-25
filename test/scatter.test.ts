import assert from 'assert';
import { createSchemaRegistry, FromSchemaRegistry, getPatchedSchemaMeta } from '../src/schema'
import { ScatterNodeInfo, ScatterStorage } from '../src/scatter/storage'

describe('AutoScatter', () => {
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
    storage.on('nodeCreated', $nodeCreated)

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
    task.subTasks!.push(task)

    // ------------------------------
    // ScatterStorage will automatically make two task nodes!
    // - use getNodeInfo() to check, if it's a node, it will return node info

    expect($nodeCreated).toBeCalledTimes(4)
    expect(nodes[0].referredCount).toBe(1)
    expect(nodes[1].referredCount).toBe(1)
    expect(nodes[2].referredCount).toBe(1)
    expect(nodes[3].referredCount).toBe(1)
    expect(task.subTasks![2]).toBe(task)

    const subTask1 = storage.getNodeInfo(task.subTasks![0])!
    expect(subTask1.schema).toBe(storage.schemaRegistry.get('task'))
  })
})
