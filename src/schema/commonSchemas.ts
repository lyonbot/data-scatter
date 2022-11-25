export const commonSchemas = {
  arrayLength: { type: 'number', title: 'Array Length' },
} as const

export type CommonSchemaId = keyof typeof commonSchemas
