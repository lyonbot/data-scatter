import { NodeInfo } from 'data-scatter';
import { debounce } from 'lodash';
import * as React from 'react';
import { ObjectInspector, ObjectRootLabel, ObjectLabel } from 'react-inspector';
import { useForceUpdate, useLast } from '../hooks';
import { MyInspector } from '../MyInspector';

import { Icon } from '@iconify/react';
import linkVariant from '@iconify/icons-mdi/link-variant';

import './styles.scss'
import classNames from 'classnames';

export const NodeInfoView = React.memo((props: { nodeInfo: NodeInfo, showRefNodeId?: boolean }) => {
  const update = useForceUpdate()
  const nodeInfo = props.nodeInfo
  const schema = nodeInfo.schema

  React.useEffect(() => {
    return nodeInfo.bus?.on('nodeWriteAccess', (n) => {
      if (n === nodeInfo) update()
    })
  }, [nodeInfo])

  return <div className="rounded border border-gray-300 border-solid shadow m-2 p-2">
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

      <div className="nodeInfoView-label">Content</div>
      <div>
        <table className="nodeInfoView-content">
          {
            Object.keys(nodeInfo.proxy).map(key => {
              const linkTo = nodeInfo.refs?.[key]
              return <tr key={key}>
                <th className={classNames(linkTo && 'bg-slate-100 underline text-blue-800')}>{String(key)}</th>
                <td><MyInspector data={nodeInfo.proxy[key]} /></td>
              </tr>;
            })
          }
        </table>
      </div>

      <div className="nodeInfoView-label">Actions</div>
    </div>
  </div>
})