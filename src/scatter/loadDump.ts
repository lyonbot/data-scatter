import { forEach, memoize } from "lodash";
import { getValueType, makeEmptyLike, NodeSelector, normalizeNodeSelector } from "./utils";
import { ScatterNodeInfo } from "./ScatterNodeInfo";
import { Nil } from "../types";
import type { ScatterStorage } from "./storage";

export interface DumpedNodeInfo {
  nodeId: string;
  schemaId: string;
  value: any;
  refs: Record<string | number, string>;
}

export interface LoadIntoStorageOptions<LoaderMethodReturns = MaybePromise<DumpedNodeInfo | ScatterNodeInfo | Nil>> {
  nodes: DumpedNodeInfo[];
  storage: ScatterStorage

  /**
   * if a referred nodeId doesn't exist, this will be called.
   * 
   * this shall return `DumpedNodeInfo | null | undefined`
   * 
   * this can be an async function, meanwhile, `loadIntoStorage` will become async too.
   */
  loader?: (id: string) => LoaderMethodReturns
}

export interface LoadIntoStorageResponse {
  loaded: ScatterNodeInfo[]
  updated: ScatterNodeInfo[]
  renamed: { nodeInfo: ScatterNodeInfo, oldId: string }[]
}

type MaybePromise<T> = Promise<T> | T

/**
 * load nodes into a ScatterStorage
 */
export function loadIntoStorage<T extends DumpedNodeInfo | ScatterNodeInfo | Nil>(opts: LoadIntoStorageOptions<T>): LoadIntoStorageResponse;
export function loadIntoStorage<T extends Promise<DumpedNodeInfo | ScatterNodeInfo | Nil>>(opts: LoadIntoStorageOptions<T>): Promise<LoadIntoStorageResponse>;
export function loadIntoStorage(opts: LoadIntoStorageOptions): LoadIntoStorageResponse;
export function loadIntoStorage(opts: LoadIntoStorageOptions): any {
  const { storage } = opts

  let resolve!: () => void
  let reject!: (err: any) => void

  let useInitQueueToBind = true
  const initQueue = [] as (() => void)[]
  let pendingAsyncCount = 0;

  const loadedNodes = {} as Record<string, ScatterNodeInfo>
  const afterAllRes: LoadIntoStorageResponse = {
    loaded: [],
    updated: [],
    renamed: [],
  }

  type BindFn = (writeTo: any, key: any) => void;
  const loadNode: (id: string) => BindFn = memoize((id: string): BindFn => {
    const respond = (storage.nodes.get(id) || loadedNodes[id] || opts.loader?.(id)) as MaybePromise<DumpedNodeInfo | ScatterNodeInfo | Nil>
    let finalResult: ScatterNodeInfo | null = null

    const queue = [] as Parameters<BindFn>[]
    const handleStaticRespond = (result: DumpedNodeInfo | ScatterNodeInfo | Nil) => {
      if (!result) throw new Error('Failed to fetch missing node: ' + id)
      result = storage.getNodeInfo(result) || result // in case `loader` returned a Proxy
      finalResult = result instanceof ScatterNodeInfo ? result : loadSingleData(result)

      if (finalResult.bus !== storage) throw new Error('Don\'t directly call use node from other storage, create a node in this storage first!')

      queue.splice(0).forEach(([writeTo, key]) => { writeTo[key] = finalResult!.proxy })
    }

    if (respond && 'then' in respond) {
      pendingAsyncCount++;
      respond.then(handleStaticRespond).then(
        () => { if (--pendingAsyncCount === 0) resolve() },
        error => { reject(error) }
      );
    } else {
      handleStaticRespond(respond)
    }

    return (writeTo, key) => {
      if (finalResult) writeTo[key] = finalResult.proxy
      else queue.push([writeTo, key])
    }
  })

  /**
   * update localLUT, then make bind. this will ensure self-loop works
   */
  const loadSingleData = (data: DumpedNodeInfo): ScatterNodeInfo => {
    const schema = storage.schemaRegistry.get(data.schemaId)

    let writeTo: ScatterNodeInfo

    const oldNode = storage.nodes.get(data.nodeId)
    if (oldNode) {
      if (getValueType(data.value) === getValueType(oldNode.container) && oldNode.schema === schema) {
        // same schema + same container type. reuse old node
        // TODO: support extended schema ? do isExtendedFrom check ?
        writeTo = oldNode
        oldNode.clear()
        Object.assign(oldNode.proxy, data.value)
        afterAllRes.updated.push(oldNode)
      } else {
        // conflict! rename old existing node
        oldNode.id = storage.allocateId(oldNode)
        afterAllRes.renamed.push({ nodeInfo: oldNode, oldId: data.nodeId })
      }
    }

    if (!writeTo!) writeTo = storage.getNodeInfo(storage.create(schema, data.value))!
    writeTo.id = data.nodeId
    loadedNodes[writeTo.id] = writeTo

    // ------------------------------
    // fill refs...
    const doBind = () => forEach(data.refs, (refToId, key) => loadNode(refToId)(writeTo.proxy, key))
    if (useInitQueueToBind) initQueue.push(doBind)
    else doBind()

    return writeTo
  }

  opts.nodes.forEach(loadSingleData)

  useInitQueueToBind = false
  initQueue.forEach(f => f())
  initQueue.length = 0

  const getFinalRespond = () => {
    afterAllRes.loaded = Object.values(loadedNodes)
    return afterAllRes
  }

  if (pendingAsyncCount === 0) return getFinalRespond() // no async stuff
  return new Promise<void>((a, b) => {
    resolve = a;
    reject = b
  }).then(getFinalRespond)
}

/** 
 * dump one nodeInfo to a serializable format
 */
export function dumpOneNode(nodeInfo: ScatterNodeInfo) {
  const out: DumpedNodeInfo = {
    nodeId: nodeInfo.id,
    schemaId: nodeInfo.schema?.$schemaId || '',
    value: makeEmptyLike(nodeInfo.container),
    refs: {}
  }

  if (Array.isArray(nodeInfo.container)) out.value.length = nodeInfo.container.length

  Object.keys(nodeInfo.container).forEach(k => {
    const r = nodeInfo.refs?.[k]
    if (r) out.refs[k] = r.id;
    else out.value[k] = nodeInfo.container[k]
  })

  return out
}

/** 
 * dump some nodes (including referred nodes) to a serializable format
 */
export function dumpNodesFromStorage(opts: {
  storage: ScatterStorage,
  ids: Iterable<string>,

  /** do not export these nodes. can be a id list, or a filter function `(id, nodeInfo) => boolean` */
  skips?: NodeSelector
}) {
  const { storage } = opts
  const skips = normalizeNodeSelector(opts.skips)

  const visitedIds = new Set()
  const output: DumpedNodeInfo[] = []
  const skippedNodes: ScatterNodeInfo[] = []

  const idQueue = Array.from(opts.ids)

  for (let id: string; idQueue && (id = idQueue.shift()!);) {
    if (visitedIds.has(id)) continue
    visitedIds.add(id)

    const nodeInfo = storage.nodes.get(id)
    if (!nodeInfo) continue
    if (skips(nodeInfo)) {
      skippedNodes.push(nodeInfo)
      continue
    }

    const dumped = dumpOneNode(nodeInfo);
    output.push(dumped)
    idQueue.push(...Object.values(dumped.refs))
  }

  return { output, skippedNodes }
}
