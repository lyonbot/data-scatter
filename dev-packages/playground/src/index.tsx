import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import { App } from './App';
import { global } from './global';

declare module "data-scatter" {

  // add basic fields for schemas

  export interface SchemaBase {
    description?: string
    tooltip?: string
  }

  // add basic types
  // so you can use them like { type: "integer" }

  export interface PrimitiveTypeLUT {
    integer: number,  // { type: "integer" } -> javascript number
  }
}

Object.assign(window, global)

const root = ReactDOM.createRoot(document.getElementById('app')!);
root.render(<App />)
