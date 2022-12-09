import { combineFunctions, EventEmitter } from "../EventEmitter";
import { ScatterNodeInfo } from "./ScatterNodeInfo";
import { NodeWriteAccessAction, ScatterStorage } from "./storage";
import { addDepCollectCounter, minusDepCollectCounter, specialAccessKey, SpecialAccessKey } from "./utils";

export interface NodeContentObserverEvents {
  /** 
   * fired when some mutations are collected 
   * 
   * note: to reduce the frequency of events, this is debounced with micro-task
   */
  mutationCollected(observer: NodeContentObserver): void
}

/**
 * a NodeContentObserver can:
 * 
 * 1. create a Watcher and collect all "read" access as the watcher's dependencies
 * 
 *    - see {@link NodeContentObserver#startCollectDep}
 * 
 * 2. start watch the whole storage, gather mutations
 * 
 *    - see {@link NodeContentObserver#startGatherMutation}
 */
export class NodeContentObserver extends EventEmitter<NodeContentObserverEvents> {
  storage: ScatterStorage<any>;

  constructor(storage: ScatterStorage) {
    super();
    this.storage = storage;
  }

  private _removeListeners?: () => void;

  collectProgressStack: Watcher[] = []
  currentCollectProgress: Watcher | undefined

  /** 
   * start collecting all reading access, including `get`, `has`, `ownKeys`
   * 
   * this will return a `Watcher`. when collecting is stopped, you can use `watcher.startWatch(callback)`
   * 
   * @remark there is a internal "collecting" stack. If is already collecting deps for another watcher, it will be paused until this one is done.
   * @see {@link Watcher}
   * @see {@link NodeContentObserver#stopCollectDep} -- call this to stop collecting
   * @returns the new created Watcher -- you can use it to monitor changes
   */
  startCollectDep() {
    const { storage } = this
    const it = new Watcher(storage)
    const newLen = this.collectProgressStack.push(it)
    this.currentCollectProgress = it

    if (newLen === 1) {
      addDepCollectCounter()
      this._removeListeners = combineFunctions([
        storage.on('nodeReadAccess', (node, key) => {
          this.currentCollectProgress!.addDep(node, key)
        }),
        () => {
          minusDepCollectCounter()
          this._removeListeners = void 0
        },
      ])
    }

    return it
  }

  /**
   * stop collecting read access
   * 
   * @see {@link NodeContentObserver#startCollectDep}
   * @returns the related Watcher
   */
  stopCollectDep() {
    const arr = this.collectProgressStack
    const prev = arr.pop()
    this.currentCollectProgress = arr[arr.length - 1]
    if (!arr.length && this._removeListeners) this._removeListeners()
    return prev
  }

  private _isCollectingMutation?: Map<ScatterNodeInfo, Map<string | number, NodeWriteAccessAction>>
  private _removeMutationListeners?: () => void

  /** 
   * start collecting all write access, including `set` and `delete`
   * 
   * the scope is the whole `storage`
   * 
   * if things changed, the `"mutated"` event will be triggered
   * 
   * you can gather all mutations with `stopGatherMutation()`, meanwhile the progress will be stopped
   * 
   * @see {@link NodeContentObserver#stopGatherMutation}
   */
  startGatherMutation() {
    if (this._isCollectingMutation) return;

    this._isCollectingMutation = new Map()
    const map = this._isCollectingMutation

    let eventEmitPromise: Promise<void> | undefined

    this._removeMutationListeners = combineFunctions([
      this.storage.on('nodeWriteAccess', (node, key, action) => {
        if (typeof key === 'symbol') return

        let nodeSnapshot = map.get(node)
        if (!nodeSnapshot) map.set(node, nodeSnapshot = new Map())

        let propInfo = nodeSnapshot.get(key)
        if (!propInfo) {
          propInfo = action
          nodeSnapshot.set(key, propInfo)
        } else {
          if (!action.isDeleted) delete propInfo['isDeleted']
          else propInfo.isDeleted = true

          propInfo.newRef = action.newRef
          propInfo.newValue = action.newValue
        }

        // check if something really changed
        // if not, remove the snapshot of this property / node

        if (propInfo.oldValue === propInfo.newValue) {
          if (nodeSnapshot.size === 1) map.delete(node)
          else nodeSnapshot.delete(key)
        }

        // emit "mutationCollected" event
        // in next tick

        if (!eventEmitPromise) {
          eventEmitPromise = Promise.resolve().then(() => {
            eventEmitPromise = void 0
            if (map !== this._isCollectingMutation) return // maybe already stopped collecting

            this.emit('mutationCollected', this)
          })
        }
      }),
    ])
  }

  /**
   * during collecting mutations, check if something is collected
   */
  hasMutationGathered() {
    return !!this._isCollectingMutation?.size
  }

  /**
   * stop collecting mutations, and returns the collected mutations
   * 
   * all the intermediate values will be discarded -- you can only get the newest and oldest values between `startGatherMutation()` and `stopGatherMutation()`
   * 
   * if nothing changed, `null` will be returned
   * 
   * @see {@link NodeContentObserver#startGatherMutation}
   */
  stopGatherMutation() {
    const snapshot = this._isCollectingMutation
    this._removeMutationListeners?.()
    this._removeMutationListeners = this._isCollectingMutation = undefined

    if (!snapshot?.size) return null
    return snapshot
  }
}

/**
 * a Watcher contains the dependency information, and provides `startWatch(callback)`, `stopWatch()`
 * 
 * to create a new watcher, use this:
 * 
 * ```js
 * const observer = new NodeContentObserver(storage);   // observer is reusable
 * 
 * const watcher = observer.startCollectDep();
 * 
 * // ... access data of storage
 * // ... and all read access will be collected as watcher's dep
 * 
 * observer.stopCollectDep();
 * 
 * // now we get the watcher
 * 
 * watcher.startWatch(() => {
 *   watcher.stopWatch();
 *   
 *   console.log('changed!');
 * });
 * ```
 */
export class Watcher {
  storage: ScatterStorage
  deps: Map<ScatterNodeInfo, Set<string | number | SpecialAccessKey>>

  constructor(storage: ScatterStorage) {
    this.storage = storage
    this.deps = new Map()
  }

  addDep(node: ScatterNodeInfo, key: keyof any) {
    let set = this.deps.get(node)
    if (!set) this.deps.set(node, set = new Set())
    set.add(key)
  }

  private _removeListenersOnStorage?: () => void

  /**
   * start watching changes. only one process per Watcher
   * 
   * don't forget call `stopWatch()` later 
   * 
   * @param callback - called when watched data is changed
   * @param callbackForDeadLoop - it's a violation to mutate data inside `callback` because this may cause Infinite-loop!
   *    when the violation is detected, `callbackForDeadLoop` will be invoked rather than `callback`
   * @returns true if successfully start watching
   */
  startWatch(callback: () => void, callbackForDeadLoop?: () => void) {
    if (this._removeListenersOnStorage) return false

    let callbackRunning = false
    this._removeListenersOnStorage = this.storage.on(
      'nodeWriteAccess',
      (node, key) => {
        const ks = this.deps.get(node)
        if (!ks) return
        if (!ks.has(specialAccessKey.ownKeys) && !ks.has(key)) return
        if (callbackRunning) { return callbackForDeadLoop?.() }

        try { callbackRunning = true; callback() }
        finally { callbackRunning = false }
      }
    )

    return true
  }

  /**
   * stop watching for changes
   */
  stopWatch() {
    this._removeListenersOnStorage?.()
    this._removeListenersOnStorage = undefined
  }
}
