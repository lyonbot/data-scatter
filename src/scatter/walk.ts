import { forEach } from "lodash"
import { PatchedSchema } from "../schema"
import { Nil } from "../types"
import { ScatterNodeInfo } from "./ScatterNodeInfo"
import { ScatterStorage } from "./storage"
import { OneOrMany, isPromise } from "./utils"

export interface WalkOptions {
  /**  */
  startPath?: string[]

  /**
   * search mode, default is BFS(Breadth-First Search)
   */
  mode?: 'DFS' | 'BFS'
}

type PropertyNameOrFilterFunction =
  | string | number
  | ((key: string | number, subNodeInfo: ScatterNodeInfo, parentNodeInfo: ScatterNodeInfo) => boolean)

/** 
 * what shall the visitor function return, during `walk`
 */
export type WalkCallbackResponse =
  | void
  | 'skip-children'
  | 'abort-all'
  | {
    only?: PropertyNameOrFilterFunction[],
    skips?: PropertyNameOrFilterFunction[]
  }

/** 
 * during `walk`, the visitor function will receive this
 * 
 * do not forget checking `isVisited`
 */
export interface WalkStepInfo {
  /** current storage context */
  storage: ScatterStorage

  /** use this to access value and referenced nodes' value, equivalent to `nodeInfo.proxy` */
  value: any;

  /** all info about this value */
  nodeInfo: ScatterNodeInfo

  /** equals to `nodeInfo.schema` */
  schema: PatchedSchema<any> | Nil

  /** equals to `nodeInfo.id` */
  nodeId: string

  /** if this node is already visited, this will be the number we already met, otherwise `0` */
  isVisited: number

  /** 
   * all visited records, order: `[first time, second time, ..., this time]`
   * 
   * note: this array will be updated when we visit again
   */
  visitedRecords: WalkStepInfo[]

  /** 
   * the path of current node
   * 
   * @remark for array item `arr[2]`, this will be `["arr", 2]`
   */
  path: (string | number)[]

  /**
   * equals to `path[path.length - 1]`
   */
  key: (string | number)

  /** 
   * the ancestors and parents of current walking path
   * 
   * @remark for `foo.bar.baz`, this will be `[ WalkStepInfo(foo), WalkStepInfo(foo.bar) ]`
   */
  ancestors: WalkStepInfo[]
}

const normalizeSelector = (x: PropertyNameOrFilterFunction) => {
  if (typeof x === 'function') return x;

  const str = String(x)
  return (x: string) => x === str
}

/**
 * recursively visit nodes and their children
 * 
 * note: if `callback` is async function, this will return a `Promise`
 */
export function walk(storage: ScatterStorage, startsFrom: OneOrMany<string | ScatterNodeInfo | any>, callback: (info: WalkStepInfo) => Promise<WalkCallbackResponse>, opts?: WalkOptions): Promise<void>
export function walk(storage: ScatterStorage, startsFrom: OneOrMany<string | ScatterNodeInfo | any>, callback: (info: WalkStepInfo) => WalkCallbackResponse, opts?: WalkOptions): void
export function walk(storage: ScatterStorage, startsFrom: OneOrMany<string | ScatterNodeInfo | any>, callback: (info: WalkStepInfo) => any, opts: WalkOptions = {}): any {
  let pendingAsyncTaskCount = 0
  let handleAsyncDone: undefined | (() => void)
  let handleAsyncError: undefined | ((error: Error) => void)

  const mode = opts.mode === 'DFS' ? 'unshift' : 'push'
  const queue: WalkStepInfo[] = []
  type PartialStepInfo = Omit<WalkStepInfo, 'storage' | 'value' | 'schema' | 'nodeId' | 'key' | 'isVisited' | 'visitedRecords'>;

  const visitedRecordsLUT = new WeakMap<ScatterNodeInfo, WalkStepInfo[]>()

  const pushQueue = (partials: (PartialStepInfo | Nil)[]) => {
    queue[mode](...(partials as PartialStepInfo[])
      .filter(Boolean)
      .map((item): WalkStepInfo => {
        let visited = visitedRecordsLUT.get(item.nodeInfo)
        if (!visited) {
          visited = []
          visitedRecordsLUT.set(item.nodeInfo, visited)
        }

        const result = {
          ...item,
          storage,
          key: item.path[item.path.length - 1],
          value: item.nodeInfo.proxy,
          nodeId: item.nodeInfo.id,
          schema: item.nodeInfo.schema,
          isVisited: visited.length,
          visitedRecords: visited
        };

        visited.push(result)
        return result;
      })
    )
  }

  const processQueue = () => {
    const head = queue.shift();
    if (!head) return;

    const onCallbackDone = (result: WalkCallbackResponse) => {
      if (result === 'abort-all') {
        queue.splice(0)
        return
      }

      if (result === 'skip-children') result = { only: [] }

      const { nodeInfo } = head
      if (!nodeInfo.refsCount) return

      const only = result && result.only?.map(normalizeSelector)
      const skips = result && result.skips?.map(normalizeSelector)
      const children: PartialStepInfo[] = []

      forEach(nodeInfo.refs, (subNodeInfo, key) => {
        if (only && !only.some(fn => fn(key, subNodeInfo, nodeInfo))) return
        if (skips && skips.some(fn => fn(key, subNodeInfo, nodeInfo))) return

        children.push({
          nodeInfo: subNodeInfo,
          ancestors: [...head.ancestors, head],
          path: [...head.path, (nodeInfo.isArray ? +key : key)]
        })
      })

      if (children.length) pushQueue(children)
    }
    const res = callback(head)

    if (isPromise(res)) {
      pendingAsyncTaskCount += 1
      res
        .then(onCallbackDone)
        .then(processQueue)
        .then(
          () => handleAsyncDone?.(),
          (e) => handleAsyncError?.(e),
        )
    } else {
      onCallbackDone(res)
      processQueue()
    }
  }


  pushQueue(storage.getNodeInfos(startsFrom).map((nodeInfo) => ({
    nodeInfo,
    path: opts.startPath || [],
    ancestors: [],
  })))

  if (!queue.length) return Promise.resolve(); // nothing processed, be compatible with async mode
  processQueue()

  if (pendingAsyncTaskCount) {
    return new Promise<void>((resolve, reject) => {
      handleAsyncDone = () => {
        if (!--pendingAsyncTaskCount) {
          resolve()
          handleAsyncError = handleAsyncDone = undefined
        }
      };
      handleAsyncError = reject
    })
  }
}
