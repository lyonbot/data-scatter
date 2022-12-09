import { loadIntoStorage, NodeContentObserver, ScatterStorage, WalkCallbackResponse, WalkOptions, WalkStepInfo } from '../src/scatter'
import { getSchemaRegistry, sampleDumpedData1 } from './fixture'

describe('observe', () => {
  let storage!: ScatterStorage
  let observer!: NodeContentObserver

  beforeEach(() => {
    storage = new ScatterStorage({ schemaRegistry: getSchemaRegistry() });
    loadIntoStorage({ storage, nodes: sampleDumpedData1 })
    observer = new NodeContentObserver(storage);
  })

  it.each([
    'event fires',
    'suppress event',
  ])('startGatherMutation, %s', async (flavor) => {
    observer.startGatherMutation()

    const task1 = storage.get('task1');
    delete task1.notExists
    delete task1.executor
    task1.done = 'done'
    task1.subTasks.length = 0

    const task2 = storage.create('task');
    task2.name = 'New task'
    task2.master = task1

    expect(observer.hasMutationGathered()).toBe(true);

    let changes
    if (flavor === 'suppress event') {
      const callback = jest.fn()
      observer.once('mutationCollected', callback);

      // if stopGatherMutation is called before "next micro task"
      // the event will not be emitted
      changes = observer.stopGatherMutation()!

      await new Promise(done => setTimeout(done, 100))
      expect(callback).not.toHaveBeenCalled()
    } else {
      // otherwise normally the event will be emitted
      await new Promise(done => observer.once('mutationCollected', done))
      changes = observer.stopGatherMutation()!
    }

    // ------------------------------

    expect(changes.size).toBe(3) // task1, task2, task1.subTasks

    const $task1 = storage.getNodeInfo('task1')!
    const $task2 = storage.getNodeInfo(task2)!
    const $array1 = storage.getNodeInfo(task1.subTasks)!

    const changes$task1 = changes.get($task1)!
    const changes$task2 = changes.get($task2)!
    const changes$array1 = changes.get($array1)!

    expect(changes$task1.size).toBe(2)
    expect(changes$task1.get('notExists')).toEqual(undefined)
    expect(changes$task1.get('executor')).toEqual(expect.objectContaining({ isDeleted: true, oldValue: 'lyonbot' }))
    expect(changes$task1.get('done')).toEqual({ newRef: undefined, newValue: "done" })

    expect(changes$task2.size).toBe(2)
    expect(changes$task2.get('name')).toEqual({ newValue: 'New task' })
    expect(changes$task2.get('master')).toEqual({ newRef: $task1, newValue: task1 })

    expect(changes$array1.size).toBe(3)
    expect(changes$array1.get('length')).toEqual({ oldValue: 2, newValue: 0 })
    expect(changes$array1.get(0)).toEqual({ isDeleted: true, oldValue: task1, oldRef: $task1 })
    expect(changes$array1.get(1)).toEqual({ isDeleted: true, oldValue: null })
  })

  it('startCollectDep', () => {
    const task1 = storage.get('task1');
    const task2 = storage.create('task');

    // start collecting "read" dependencies

    const watcher = observer.startCollectDep();
    [task1.executor, Object.keys(task2), Reflect.has(task1.meta, 'hello')];

    const stopCollectResp = observer.stopCollectDep();
    expect(stopCollectResp).toBe(watcher);
    expect(observer.stopCollectDep()).toBeFalsy();    // "stop" again while not collecting

    // do some changes

    const callback = jest.fn()
    const deadLockCallback = jest.fn()
    watcher.startWatch(callback, deadLockCallback)

    callback.mockClear()
    task1.meta.world = 'irrelative field'
    expect(callback).not.toHaveBeenCalled()

    callback.mockClear()
    task2.newField = 'irrelative field'
    expect(callback).toBeCalledTimes(1)

    callback.mockClear()
    task2.name = 'what a job'
    expect(callback).toBeCalledTimes(1)

    callback.mockClear()
    delete task1.executor
    expect(callback).toBeCalledTimes(1)

    callback.mockClear()
    delete task1.executor
    expect(callback).toBeCalledTimes(1)

    // ----------------------------
    // it's illegal to mutate data inside callback
    // `deadLockCallback` will be called during the violation

    expect(deadLockCallback).not.toHaveBeenCalled()
    callback.mockClear()

    callback.mockImplementation(() => {
      expect(task1.executor).toBe('hey')
      task1.executor = 'we can\'t trigger callback inside callback'
    })
    task1.executor = 'hey'

    expect(callback).toBeCalledTimes(1)   // only once
    expect(deadLockCallback).toBeCalledTimes(1)
    expect(task1.executor).toBe('we can\'t trigger callback inside callback')
  })
})
