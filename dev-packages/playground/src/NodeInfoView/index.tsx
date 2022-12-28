import { NodeInfo } from 'data-scatter';
import { debounce } from 'lodash';
import * as React from 'react';
import { ObjectInspector, ObjectRootLabel, ObjectLabel } from 'react-inspector';
import { useLast } from '../hooks';
import './style.scss'

export const NodeInfoView = React.memo((props: { nodeInfo: NodeInfo }) => {
  return <div className="nodeInfoView">
    <div className="text"></div>
  </div>
})