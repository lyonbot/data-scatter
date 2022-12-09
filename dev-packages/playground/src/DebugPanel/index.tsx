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

export const DebugPanel = (_props: Props) => {
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
      <pre className='debugPanel-pre'><CodeSnippet code={code} /></pre>
    </div>);
    try {
      console.log("%c%s", "color:#35f", code)
      recentCodes.list.unshift(code)
      const result = await fn();
      if (typeof result !== 'undefined') {
        console.log(result)
        log(<div><MyInspector data={result} /></div>);
      }
    } catch (error) {
      console.error(error)
      log(<div className="isError">
        <div className="debugPanel-indicator">
          <span className="debugPanel-errorMark">!</span>
        </div>
        <MyInspector data={error} />
      </div>);
    }
  }, []);

  React.useEffect(() => {
    const div = logsDiv.current
    if (!div) return;

    div.scrollTo(0, div.scrollHeight)
  }, [records.length])

  //----------------------------------------------------------------

  const [code, setCode] = React.useState('')
  const isCodePath = React.useMemo(() => (rePathValidator.test(code) && toPath(code.trim())), [code])
  const instantChildren = React.useMemo(() => {
    if (!isCodePath) return null

    const value = get(window, isCodePath)
    return <MyInspector data={value} />
  }, [isCodePath]) || (code ? "Press Enter to Execute" : notice)

  //----------------------------------------------------------------

  return <div {...otherProps} className={classnames("debugPanel", otherProps.className)}>
    <div className="debugPanel-logs" ref={logsDiv}>
      {records}
    </div>
    <div className="debugPanel-input">
      <div className="debugPanel-indicator isBlue">&raquo;</div>
      <CommandInput
        placeholder={placeholder}
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
};
