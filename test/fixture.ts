import { DumpedNodeData } from '../src/scatter';
import { createSchemaRegistry, FromSchemaRegistry } from '../src/schema';

export const getSchemaRegistry = () => createSchemaRegistry({
  task: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      executor: { type: 'string' },
      subTasks: { type: 'array', items: 'task' }
    }
  },
  note: {
    type: 'object',
    properties: {
      message: { type: 'string' }
    }
  },
  taskEx: {
    type: 'object',
    extends: ['task'],
    properties: {
      difficulty: { type: 'string' }
    }
  }
});

export type Task = FromSchemaRegistry<ReturnType<typeof getSchemaRegistry>, 'task'>;

/**
 * ```
 *            task1 | {
 *                  |   executor: 'lyonbot',
 *           array1 |   subTasks: [
 *                * |     *task1,
 *                  |     null
 *                  |   ],
 * anonymousObject1 |   meta: {
 *                  |     hello: 'world',
 *                * |     task: *task1
 *                  |   }
 *                  | }
 * ```
 */
export const sampleDumpedData1: DumpedNodeData[] = [
  {
    nodeId: 'task1',
    schemaId: 'task',
    value: { executor: 'lyonbot' },
    refs: { subTasks: 'array1', meta: 'anonymousObject1' }
  },
  {
    nodeId: 'array1',
    schemaId: 'task/properties/subTasks',
    refs: { '0': 'task1' },
    value: [null, null]
  },
  {
    nodeId: 'anonymousObject1',
    schemaId: '',
    value: { hello: 'world' },
    refs: { task: 'task1' }
  }
];