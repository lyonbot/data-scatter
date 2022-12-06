import { debounce } from 'lodash';
import * as React from 'react';
import { ObjectInspector, ObjectRootLabel, ObjectLabel } from 'react-inspector';
import { useLast } from '../hooks';
import './style.scss'

declare global {
  interface Window {
    $temp?: any;
    $temp0?: any;
    $temp1?: any;
    $temp2?: any;
  }
}

const span2data = new WeakMap<any, { upstream: MyInspectorProps, depth: number, name: string, data: any }>()

function nodeRenderer({ depth, name, data, isNonenumerable, expanded }: any) {
  const child = depth === 0
    ? <ObjectRootLabel name={name} data={data} />
    : <ObjectLabel name={name} data={data} isNonenumerable={isNonenumerable} />;

  const upstream = React.useContext(TheCtx)!
  const refMem = useLast({ upstream, depth, name, data })

  return <span
    onMouseEnter={onMouseEnter}
    onMouseLeave={onMouseLeave}
    onClick={onClick}
    ref={(el) => { el && span2data.set(el, refMem) }}
    className="myInspector-node"
  >
    {child}
  </span>
}

const onMouseEnter = (ev: React.MouseEvent) => {
  activeTarget?.classList.remove('isActive')
  if (ev.currentTarget === activeTarget) return;

  activeTarget = ev.currentTarget as HTMLElement;
  activeTarget.classList.add('isActive')

  const rect = activeTarget.getBoundingClientRect()
  activeTarget.appendChild(popover)
  const left = Math.min(ev.clientX - rect.left + 10, rect.right - 40)
  popover.style.left = left + "px"

  const { upstream, data, name } = span2data.get(ev.currentTarget)!
  upstream.onMouseEnter?.({ event: ev.nativeEvent, data, name })
}

const onMouseLeave = (ev: React.MouseEvent) => {
  if (ev.currentTarget !== activeTarget) return;
  activeTarget.classList.remove('isActive')
  activeTarget = null;
  revertCopiedTextLater.flush()
  popover.remove()

  const { upstream, data, name } = span2data.get(ev.currentTarget)!
  upstream.onMouseLeave?.({ event: ev.nativeEvent, data, name })
}

const onClick = (ev: React.MouseEvent) => {
  if (ev.currentTarget !== activeTarget) return;

  const { upstream, data, name } = span2data.get(ev.currentTarget)!
  upstream.onClick?.({ event: ev.nativeEvent, data, name })
}

let activeTarget: HTMLSpanElement | null = null;
const popover = document.createElement('span')
popover.className = 'myInspector-popover'
popover.addEventListener('click', (ev) => ev.stopPropagation(), false)

const copy = document.createElement('span')
copy.textContent = 'save'
copy.className = 'myInspector-button'
copy.addEventListener('click', () => {
  const data = span2data.get(activeTarget!)?.data
  window.$temp2 = window.$temp1
  window.$temp1 = window.$temp0
  window.$temp0 = window.$temp = data
  copy.textContent = '✔ $temp'
  revertCopiedTextLater()
})

const revertCopiedTextLater = debounce(() => {
  copy.textContent = 'save'
}, 1900, { leading: false })

popover.appendChild(copy)

const TheCtx = React.createContext<MyInspectorProps | null>(null)

interface MyInspectorProps {
  data: any
  onMouseEnter?: (o: { event: MouseEvent, data: any, name: string }) => void
  onMouseLeave?: (o: { event: MouseEvent, data: any, name: string }) => void
  onClick?: (o: { event: MouseEvent, data: any, name: string }) => void
}

export const MyInspector = React.memo((_props: MyInspectorProps) => {
  const props = useLast(_props)

  return <TheCtx.Provider value={props}>
    <ObjectInspector data={_props.data} nodeRenderer={nodeRenderer} />
  </TheCtx.Provider>
})