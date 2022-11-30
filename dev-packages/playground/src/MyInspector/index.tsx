import * as React from 'react';
import { ObjectInspector, ObjectRootLabel, ObjectLabel } from 'react-inspector';
import './style.scss'

declare global {
  interface Window {
    $temp?: any;
    $temp0?: any;
    $temp1?: any;
    $temp2?: any;
  }
}

const span2data = new WeakMap()

function nodeRenderer({ depth, name, data, isNonenumerable, expanded }: any) {
  const child = depth === 0
    ? <ObjectRootLabel name={name} data={data} />
    : <ObjectLabel name={name} data={data} isNonenumerable={isNonenumerable} />;

  return <span
    onMouseEnter={onMouseEnter}
    onMouseLeave={onMouseLeave}
    ref={(el) => { el && span2data.set(el, data) }}
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
  const left = Math.min(ev.clientX - rect.left, rect.right - 20)
  popover.style.left = left + "px"
}

const onMouseLeave = (ev: React.MouseEvent) => {
  if (ev.currentTarget !== activeTarget) return;
  activeTarget.classList.remove('isActive')
  activeTarget = null;
  copy.textContent = 'save'
  popover.remove()
}

let activeTarget: HTMLSpanElement | null = null;
const popover = document.createElement('span')
popover.className = 'myInspector-popover'
popover.addEventListener('click', (ev) => ev.stopPropagation(), false)

const copy = document.createElement('span')
copy.textContent = 'save'
copy.className = 'myInspector-button'
copy.addEventListener('click', () => {
  const data = span2data.get(activeTarget!)
  window.$temp2 = window.$temp1
  window.$temp1 = window.$temp0
  window.$temp0 = window.$temp = data
  copy.textContent = '✔ $temp'
  setTimeout(() => copy.textContent = 'save', 1900)
})

popover.appendChild(copy)

export const MyInspector = React.forwardRef((props: { data: any }) => {
  return <ObjectInspector data={props.data} nodeRenderer={nodeRenderer} />
})