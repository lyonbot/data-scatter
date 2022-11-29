import * as React from 'react';
import { ObjectInspector } from 'react-inspector';
import { CommandInput } from '../CommandInput';
import "./style.scss"

export const DebugPanel = () => {
  const [records, updateRecords] = React.useState<React.ReactElement[]>([]);
  const clearRecords = React.useCallback(() => updateRecords([]), []);

  const handleCommandSubmit = React.useCallback(async (code: string, fn: () => Promise<any>) => {
    const log = (...items: React.ReactElement[]) => updateRecords(x => {
      const origLength = x.length;
      return x.concat(items.map((item, index) => React.cloneElement(item, {
        key: index + origLength,
        className: 'debugPanel-row ' + (item.props.className || '')
      })));
    });

    log(<div>
      <div className="debugPanel-indicator isGrey">&raquo;</div>
      <pre className='debugPanel-pre'>{code}</pre>
    </div>);
    try {
      const result = await fn();
      if (typeof result !== 'undefined')
        log(<div><ObjectInspector data={result} /></div>);
    } catch (error) {
      log(<div className="isError">
        <div className="debugPanel-indicator isGrey">❌</div>
        <ObjectInspector data={error} />
      </div>);
    }
  }, []);
  return <div className="debugPanel">
    <div className="debugPanel-logs">
      {records}
    </div>
    <div className="debugPanel-input">
      <div className="debugPanel-indicator isBlue">&raquo;</div>

      <CommandInput placeholder="foo.bar = ..." onSubmit={handleCommandSubmit} />
    </div>
  </div>;
};
