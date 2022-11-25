import { ScatterNodeInfo } from "./ScatterNodeInfo";
import { makeEmptyLike } from "./utils";

export interface DumpedNodeInfo {
  nodeId: string;
  schemaId: string;
  value: any;
  refs: Record<string | number, string>;
}

export function dumpNodeInfo(nodeInfo: ScatterNodeInfo) {
  const out: DumpedNodeInfo = {
    nodeId: nodeInfo.id,
    schemaId: nodeInfo.schema?.$schemaId || '',
    value: makeEmptyLike(nodeInfo.container),
    refs: {}
  }

  Object.keys(nodeInfo.container).forEach(k => {
    const r = nodeInfo.refs?.[k]
    if (r) out.refs[k] = r.id;
    else out.value[k] = nodeInfo.container[k]
  })

  return out
}
