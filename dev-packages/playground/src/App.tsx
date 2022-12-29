import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import { DebugPanel, DebugPanelRef } from './DebugPanel';
import { NodeInfoView } from './NodeInfoView';
import introMarkdown from './intro.md?raw';
import { storage } from "./global";

import 'github-markdown-css/github-markdown-light.css'
import './index.css';
import { hoveringItemAtom, useAtom } from './state';
import { MyInspector } from './MyInspector';

// ----------------------------------------------------------------
const defaultOpts = {
  showRefNodeId: false
};

const SideBar = () => {
  const [active] = useAtom(hoveringItemAtom)

  return <div>
    <MyInspector data={active.data} />
  </div>
}

export const App = () => {
  const debugPanelRef = React.useRef<DebugPanelRef>(null);
  const [nodes, setNodes] = React.useState(() => Array.from(storage.nodes.values()));
  const [opts, updateOpts] = React.useState(defaultOpts);

  React.useEffect(() => {
    storage.on('nodeCreated', nodeInfo => {
      setNodes(arr => arr.concat(nodeInfo));
    });

    const addRecord = debugPanelRef.current!.addRecord;
    addRecord(<div className='py-8'>
      <ReactMarkdown children={introMarkdown} className="markdown-body" />
    </div>);
  }, []);

  return <div className="flex absolute inset-0 gap-4">
    <div className="flex-1 grow-[2] max-h-full">
      <DebugPanel placeholder="data.xxx" className='max-h-full' ref={debugPanelRef} />
    </div>

    <div className="flex-1 flex flex-col">
      <div className="p-4">
        test

        <SideBar />

        <label>
          <input type="checkbox" checked={opts.showRefNodeId} onChange={() => updateOpts(x => ({ ...x, showRefNodeId: !x.showRefNodeId }))} />
          showRefNodeId
        </label>
      </div>
      <div className="flex-1 overflow-auto">
        <div>
          {nodes.map(nodeInfo => <NodeInfoView
            key={nodeInfo.id}
            nodeInfo={nodeInfo}
            showRefNodeId={opts.showRefNodeId} />)}
        </div>
      </div>
    </div>
  </div>;
};
