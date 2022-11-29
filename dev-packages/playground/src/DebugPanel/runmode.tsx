import * as React from "react"
import { createElement, ReactNode, useMemo } from "react"
import CodeMirror from "codemirror"
import "codemirror/addon/runmode/runmode"

export const runModeReact = (code: string) => {
  const resArr: ReactNode[] = []
  CodeMirror.runMode(code, "javascript", (text, className) => {
    resArr.push(createElement("span", { className: className?.replace(/^|\s+/g, ' cm-'), key: resArr.length }, text))
  })
  return resArr
}

export const CodeSnippet = (props: { code: string }) => {
  const children = useMemo(() => runModeReact(props.code), [props.code])
  return <pre className="debugPanel-pre cm-s-default">{children}</pre>
}
