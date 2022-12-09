import { DumpedNodeInfo } from '../../src/scatter/loadDump';
import { createSchemaRegistry, FromSchemaRegistry } from '../../src/schema';

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
