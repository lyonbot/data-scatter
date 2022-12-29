import * as React from 'react';
import { toPath, get } from 'lodash';
import classnames from 'classnames';
import { CommandInput } from '../CommandInput';
import { MyInspector } from '../MyInspector';
import { CodeSnippet } from './runmode';
import "./style.scss"

// check if a string is path
const rePathValidator = /^\s*[a-z_$][\w$]*(\.[a-z_$][\w$]*|\[(-?\d+|'[^']*'|"[^"]*")\])*\s*$/i

type Props = React.HTMLProps<HTMLDivElement> & {
  /** a notice text */
  notice?: React.ReactNode
  placeholder?: string
}

export interface DebugPanelRef {
  /** insert a row into "log" area with custom `<div>` and content */
  addRecord: (...items: React.ReactElement[]) => void
  console: Pick<Console, 'log' | 'error' | 'warn' | 'clear'>
  setCode: (code: string) => void
}

export const DebugPanel = React.forwardRef<DebugPanelRef, Props>((_props, ref) => {
  const logsDiv = React.useRef<HTMLDivElement>(null)
  const { notice = '👆 Try executing some JavaScript above', placeholder, ...otherProps } = _props

  //----------------------------------------------------------------

  const recentCodes = React.useMemo(() => ({
    list: [] as string[],     // in reversed order: latest first
    index: 0
  }), [])
  const [records, updateRecords] = React.useState<React.ReactElement[]>([]);
  const clearRecords = React.useCallback(() => {
    recentCodes.index = 0
    recentCodes.list.length = 0
    updateRecords([]);
  }, []);

  const { addRecord, fakeConsole } = React.useMemo(() => {
    /** insert a row into "log" area with custom `<div>` and content */
    const addRecord = (...items: React.ReactElement[]) => updateRecords(x => {
      const origLength = x.length;
      return x.concat(items.map((item, index) => React.cloneElement(item, {
        key: index + '/' + origLength,
        className: 'debugPanel-row ' + (item.props.className || '')
      })));
    });

    const fakeConsole = Object.create(console);
    {
      fakeConsole.log = (...args: any[]) => (addRecord(<div>
        {consolePrint2VDom(args)}
      </div>), console.log(...args))
      fakeConsole.error = (...args: any[]) => (addRecord(<div className="isError">
        <div className="debugPanel-indicator">
          <span className="debugPanel-errorMark">!</span>
        </div>
        {consolePrint2VDom(args)}
      </div>), console.error(...args))
      fakeConsole.warn = (...args: any[]) => (addRecord(<div className="isWarn">
        <div className="debugPanel-indicator">
          <span className="debugPanel-warnMark">!</span>
        </div>
        {consolePrint2VDom(args)}
      </div>), console.warn(...args))
      fakeConsole.clear = () => (updateRecords([]), console.log('%c%s', 'color: #999', '<-- console clear -->'))
    }

    return { addRecord, fakeConsole }
  }, [])

  const handleCommandSubmit = React.useCallback(async (code: string, fn: (...args: any[]) => Promise<any>) => {
    addRecord(<div>
      <div className="debugPanel-indicator isGrey">&raquo;</div>
      <pre className='debugPanel-pre'><CodeSnippet code={code} /></pre>
    </div>);
    try {
      console.log("%c%s", "color:#35f", code)
      recentCodes.list.unshift(code)
      const result = await fn(fakeConsole);
      if (typeof result !== 'undefined') fakeConsole.log(result)
    } catch (error) {
      fakeConsole.error(error)
    }
  }, []);

  React.useEffect(() => {
    const div = logsDiv.current
    if (!div) return;

    div.scrollTo(0, div.scrollHeight)
  }, [records.length])

  // React.useEffect(() => {
  //   fakeConsole.log('test', window)
  //   fakeConsole.error('test', window)
  //   fakeConsole.warn('test', window)
  // }, [])

  //----------------------------------------------------------------

  const [code, setCode] = React.useState('')
  const isCodePath = React.useMemo(() => (rePathValidator.test(code) && toPath(code.trim())), [code])
  const instantChildren = React.useMemo(() => {
    if (!isCodePath) return null

    const value = get(window, isCodePath)
    return <MyInspector data={value} />
  }, [isCodePath]) || (code ? "Press Enter to Execute" : notice)

  React.useImperativeHandle(ref, () => ({
    addRecord,
    console: fakeConsole,
    setCode,
  }), [])

  //----------------------------------------------------------------

  return <div {...otherProps} className={classnames("debugPanel", otherProps.className)}>
    <div className="debugPanel-logs" ref={logsDiv}>
      {records}
    </div>
    <div className="debugPanel-input">
      <div className="debugPanel-indicator isBlue">&raquo;</div>
      <CommandInput
        placeholder={placeholder}
        functionArgumentList="console"
        onKeyDown={(cm, event) => {
          if (!cm.somethingSelected()) {
            let delta = 0;
            if (event.code === 'ArrowUp' && cm.getCursor().line === 0) delta = 1;
            if (event.code === 'ArrowDown' && cm.getCursor().line === cm.lineCount() - 1) delta = -1;

            if (delta) {
              const code = recentCodes.list[recentCodes.index]
              cm.setValue(code)
              document.addEventListener('keyup', () => cm.execCommand('selectAll'), { once: true })
              recentCodes.index = (recentCodes.index + delta + recentCodes.list.length) % recentCodes.list.length
            } else {
              recentCodes.index = 0
            }
          }
        }}
        onSubmit={handleCommandSubmit}
        onChange={setCode}
      />
    </div>
    <div className="debugPanel-instant">
      {instantChildren}
    </div>
  </div>;
});

const consolePrint2VDom = (args: any[]) => {
  const result: React.ReactNode[] = []

  for (const arg of args) {
    if (typeof arg === 'string' && !result.length) result.push(<span style={{ whiteSpace: 'pre-wrap' }}>{arg}</span>);
    else result.push(<MyInspector data={arg} key={result.length} />)
  }

  return result
}
