import * as React from 'react';
import CodeMirror from 'codemirror';
import 'codemirror/lib/codemirror.css'
import 'codemirror/addon/display/placeholder'
import 'codemirror/addon/hint/show-hint'
import 'codemirror/addon/hint/show-hint.css'
import 'codemirror/addon/hint/javascript-hint'
import 'codemirror/mode/javascript/javascript'
import './style.scss'

type Props = React.PropsWithoutRef<{
  value?: string
  placeholder?: string
  onSubmit?: (code: string, fn: () => Promise<any>) => Promise<void> | void;
}>;

export const CommandInput = React.memo((_props: Props) => {
  const $cm = React.useRef<CodeMirror.Editor | null>(null)
  const $el = React.useRef<HTMLDivElement>(null)
  const props = React.useRef<Props>(_props)
  const getEditor = React.useCallback(() => $cm.current!, [])
  const [isReady, setReady] = React.useState(false)

  React.useEffect(() => {
    const cm = CodeMirror($el.current!, {
      // @ts-ignore
      mode: { name: 'javascript', globalVars: true },
      hintOptions: {
        globalScope: window
      } as any,
      lineNumbers: false,
      lineWrapping: true,
      viewportMargin: Infinity,
    })
    $cm.current = cm
    setReady(true)

    cm.addKeyMap({
      'Ctrl-Enter': 'newlineAndIndent',
      'Cmd-Enter': 'newlineAndIndent',
      "Ctrl-Space": "autocomplete",
      'Enter': () => {
        const value = cm.getValue();
        if (!value.trim()) return;

        if (cm.getOption('readOnly')) return;
        cm.setOption('readOnly', true);

        (async () => {
          // eslint-disable-next-line @typescript-eslint/ban-types
          let fn: Function | null = null;

          try {

            // make an async function

            try {
              fn = new Function(`return (async function(){ return (${value}\n); }).apply(this, arguments)`)
            } catch {
              fn = new Function(`return (async function(){ ${value}\n; }).apply(this, arguments)`)
            }

            // callback

            await props.current.onSubmit?.(value, fn as () => Promise<any>)
            cm.setValue('')
          } catch (err) {
            console.error('Failed to execute', err)
            cm.execCommand('newlineAndIndent')
          }
          cm.setOption('readOnly', false)
        })()
      }
    })

    cm.on('keyup', (instance, event) => {
      if (event.code === 'Period') cm.execCommand('autocomplete')
    })
  }, [])

  const cm = $cm.current
  props.current = _props

  React.useEffect(() => { cm?.setValue(_props.value || '') }, [cm, _props.value])
  React.useEffect(() => { cm?.setOption('placeholder', _props.placeholder || '') }, [cm, _props.placeholder])

  return <div className="commandInput" ref={$el}></div>
})