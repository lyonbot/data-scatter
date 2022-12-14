import { NodeInfo } from 'data-scatter';
import classNames from 'classnames';
import { debounce } from 'lodash';
import * as React from 'react';
import { ObjectInspector, ObjectRootLabel, ObjectLabel } from 'react-inspector';
import { useForceUpdate, useLast } from '../hooks';
import { MyInspector } from '../MyInspector';

import { Icon } from '@iconify/react';
import linkVariant from '@iconify/icons-mdi/link-variant';

import './styles.scss'

export const NodeInfoView = React.memo((props: {
  nodeInfo: NodeInfo
  showRefNodeId?: boolean
  isSticky?: boolean
}) => {
  const update = useForceUpdate()
  const nodeInfo = props.nodeInfo
  const schema = nodeInfo.schema

  React.useEffect(() => {
    return nodeInfo.bus?.on('nodeWriteAccess', (n) => {
      if (n === nodeInfo) update()
    })
  }, [nodeInfo])

  return <div className="nodeInfoView">
    <div className="nodeInfoView-grid">

      <div className="nodeInfoView-label">test</div>
      <div>{nodeInfo.id}</div>

      <div className="nodeInfoView-label">Schema</div>
      <div>
        {
          nodeInfo.isArray
          && <span className="myTag isBlue">isArray</span>
        }
        {
          schema
            ? <span className="myTag">{schema.$schemaId}</span>
            : <span className="myTag isGray">no schema</span>
        }
      </div>

      <div className="nodeInfoView-label">Stat</div>
      <div>
        Referred by {nodeInfo.referredCount} nodes
      </div>

      <div className="nodeInfoView-label">Content</div>
      <div>
        <table className="nodeInfoView-content">
          <tbody>
            {
              Object.keys(nodeInfo.proxy).map(key => {
                const linkTo = nodeInfo.refs?.[key]
                return <tr key={key}>
                  <th className={classNames(linkTo && 'bg-slate-100 underline text-blue-800')}>{String(key)}</th>
                  <td><MyInspector data={nodeInfo.proxy[key]} /></td>
                </tr>;
              })
            }
          </tbody>
        </table>
      </div>
    </div>
  </div>
})