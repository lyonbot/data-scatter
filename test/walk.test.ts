import { loadIntoStorage, ScatterStorage, WalkCallbackResponse, WalkOptions, WalkStepInfo } from '../src/scatter'
import { getSchemaRegistry, sampleDumpedData1 } from './fixture'

describe('walk', () => {
  const visitedLogs: any[] = [];
  const writeLog = (step: WalkStepInfo) => visitedLogs.push(`id=${step.nodeId}  path=${JSON.stringify(step.path)}  isVisited=${step.isVisited}`)

  beforeEach(() => {
    visitedLogs.splice(0)
  })

  test.each([
    {},
    { mode: 'DFS' as const },
    { async: true }
  ])('basic walk, %p', async (testCaseOpts) => {
    const storage = new ScatterStorage({ schemaRegistry: getSchemaRegistry() });
    loadIntoStorage({
      storage,
      nodes: sampleDumpedData1
    })

    const task1VisitedLog: WalkStepInfo[] = []

    const visitor = (step: WalkStepInfo): WalkCallbackResponse => {
      if (step.nodeId === 'task1') task1VisitedLog.push(step)
      writeLog(step)

      if (step.isVisited) return 'skip-children';
    }

    const walkOpt: WalkOptions = {
      startPath: ['myTask'],
      mode: testCaseOpts.mode,
    }

    if (testCaseOpts.async) {
      const resp = storage.walk('task1', async o => visitor(o), walkOpt);
      expect(resp).toBeInstanceOf(Promise);
      await resp
    } else {
      storage.walk('task1', visitor, walkOpt);
    }

    // ----------------------------
    expect(visitedLogs).toMatchSnapshot('visitedLogs')
  })

  test('callback returns', () => {
    const storage = new ScatterStorage({ schemaRegistry: getSchemaRegistry() });
    loadIntoStorage({
      storage,
      nodes: sampleDumpedData1
    })

    const visitor = jest.fn((step: WalkStepInfo): WalkCallbackResponse => {
      writeLog(step)

      if (step.nodeId === 'task1') return { only: ['meta'] }
      if (step.nodeId === 'anonymousObject1') return { skips: ['task'] }
    })

    storage.walk(['task1', ''], visitor)

    expect(visitedLogs).toMatchInlineSnapshot(`
[
  "id=task1  path=[]  isVisited=0",
  "id=anonymousObject1  path=["meta"]  isVisited=0",
]
`)
  })

  test.each([true, false])('throw error, isAsync = %p', async (isAsync) => {
    const storage = new ScatterStorage({ schemaRegistry: getSchemaRegistry() });
    loadIntoStorage({
      storage,
      nodes: sampleDumpedData1
    })

    const fn = (step: WalkStepInfo) => {
      writeLog(step)

      if (step.nodeId === 'anonymousObject1') throw new Error('bad')
    }

    if (isAsync) {
      const resp = storage.walk('task1', async (x) => fn(x));
      expect(resp).toBeInstanceOf(Promise)
      await expect(resp).rejects.toThrow('bad')
    } else {
      expect(() => storage.walk('task1', fn)).toThrow('bad')
    }

    expect(visitedLogs).toEqual([
      'id=task1  path=[]  isVisited=0',
      'id=array1  path=["subTasks"]  isVisited=0',
      'id=anonymousObject1  path=["meta"]  isVisited=0',
    ])
  })
})
