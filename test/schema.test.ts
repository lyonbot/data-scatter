import assert from 'assert';
import { createSchemaRegistry, FromSchemaRegistry, isPatchedSchema } from '../src/schema'

describe('SchemaRegistry', () => {
  test('demo', () => {
    const registry = createSchemaRegistry({
      // ----------------------------------------------------------------
      // define a schema in JSON-Schema like format
      person: {
        type: 'object',
        properties: {
          // you can define type in JSON Schema
          name: { type: 'string' },

          // or just refer to a defined type
          father: 'person',
          mother: 'person',

          // you can also do it in a nested type
          children: {
            type: 'array',
            items: 'person', // <-- here
          },

          employer: 'entrepreneur'
        }
      },

      // ----------------------------------------------------------------
      // besides, you can extend another schema
      entrepreneur: {
        type: 'object',
        title: 'A person with ambitions!',
        extends: ['person'],
        properties: {
          permissions: { type: 'array', items: { type: 'string' } },
          employer: null,  // delete from inherited properties
        }
      },
    })

    // ------------------------------
    // assertions

    const $entrepreneur = registry.get('entrepreneur')
    assert($entrepreneur.isObject())
    assert('permissions' in $entrepreneur.properties)
    assert('name' in $entrepreneur.properties)   // inherited from "user"
    assert(false === ('employer' in $entrepreneur.properties))   // deleted from inheriting
    expect($entrepreneur.title).toBe('A person with ambitions!')

    const $person = registry.get('person')
    assert($person.isObject())
    assert(false === ('permissions' in $person.properties))  // special properties of "admin"
    assert('name' in $person.properties)

    const $alsoPerson = registry.get('person/properties/father');
    expect($alsoPerson).toBe($person);

    // cross-reference!

    expect($person.getDirectChildSchema('employer')).toBe($entrepreneur)
    expect($person.getDirectChildSchema('father')).toBe($person)
    expect($person.getDirectChildSchema('mother')).toBe($person)

    expect($person.getSchemaAtPath('children[0].father')).toBe($person)
    expect($person.getSchemaAtPath('children[0].employer')).toBe($entrepreneur)

    // TypeScript

    type Person = FromSchemaRegistry<typeof registry, 'person'>
    type Entrepreneur = FromSchemaRegistry<typeof registry, 'entrepreneur'>
  })

  test('throw if loop', () => {
    expect(() => {
      createSchemaRegistry({
        foo: 'bar',
        bar: 'baz',
        baz: 'foo',
      })
    }).toThrowError('loop')

    expect(() => {
      createSchemaRegistry({
        foo: 'foo',
      })
    }).toThrowError('loop')

    expect(() => {
      createSchemaRegistry({
        foo: { type: 'boolean', extends: ['bar'] },
        bar: { type: 'boolean', extends: ['baz'] },
        baz: 'foo',
      })
    }).toThrowError('Cycle-dependencies found when "bar" extends "foo"')

    expect(() => {
      createSchemaRegistry({
        foo: { type: 'string', extends: ['bar'] },
        bar: { type: 'string', extends: ['baz'] },
        baz: { type: 'string', extends: ['foo'] },
      })
    }).toThrowError('Cycle-dependencies found when "baz" extends "foo"')
  })

  test('throw if reference is invalid', () => {
    expect(() => {
      createSchemaRegistry({
        // @ts-expect-error
        foo: { type: 'array', items: 'bar' }
      })
    }).toThrowError('Missing schema')
  })

  test('works', () => {
    const registry = createSchemaRegistry({
      fox: {
        type: 'boolean'
      },
      fov: {
        type: 'object',
        properties: {
          moz: 'fox',
          arr1: { type: 'array', items: { type: 'string' } },
          arr2: { type: 'array', items: 'fov' },
        }
      },
      mazz: {
        type: 'object',
        properties: {
          hello: 'mazzAlias',
        },
        patternProperties: {
          '^flag_': 'fox'
        }
      },
      mazzAlias: 'mazz'
    })

    // -------------------------------
    // integrate with TypeScript: extract a type from registry
    // make things well-typed!

    type ExtractedFOVType = FromSchemaRegistry<typeof registry, 'fov'>
    const a: ExtractedFOVType = { // eslint-disable-line
      moz: true,
      arr1: ['str'],
      arr2: [
        {
          moz: false,
          // @ts-expect-error
          arr1: [123],
          arr2: []
        },
      ]
    }

    // -------------------------------
    // alias

    expect(registry.get('mazzAlias')).toBe(registry.get('mazz'))
    expect(registry.get('mazz/properties/hello')).toBe(registry.get('mazz'))
    expect(registry.get('mazz/properties/x')).toBeUndefined()
    expect(registry.get('mazz/properties')).toBeUndefined()

    // -------------------------------
    // object

    const $mazz = registry.get('mazz')

    assert(isPatchedSchema($mazz))
    expect($mazz.$schemaId).toBe('mazz')
    assert($mazz.isObject())
    expect($mazz.type).toBe('object')
    expect(Object.keys($mazz.properties)).toEqual(['hello'])

    expect($mazz.properties.hello).toBe($mazz)
    expect($mazz.getSchemaAtPath('hello')).toBe($mazz)
    expect($mazz.getSchemaAtPath('hello.hello')).toBe($mazz)
    expect($mazz.getSchemaAtPath('hello.x')).toBe(null)
    expect($mazz.getSchemaAtPath('xxx')).toBe(null)

    const $fox = registry.get('fox')
    expect($mazz.getSchemaAtPath('flag_123')).toBe($fox)
    expect($mazz.getSchemaAtPath('flag_456')).toBe($fox)

    // -------------------------------
    // nested ref

    const $fov_moz = registry.get('fov').getSchemaAtPath('moz')

    assert(isPatchedSchema($fov_moz))
    expect($fov_moz).toBe(registry.get('fox'))

    // -------------------------------
    // array

    const $arr1 = registry.get('fov').getSchemaAtPath('arr1')!

    expect($arr1.$schemaId).toBe('fov/properties/arr1')
    assert($arr1.isArray())
    expect($arr1.items.type).toBe('string')
    expect($arr1.getDirectChildSchema('length')!.type).toBe('number')

    // array2

    const $arr2 = registry.get('fov').getDirectChildSchema('arr2')!

    assert($arr2.isArray())
    expect($arr2.items).toBe(registry.get('fov'))
    expect($arr2.getDirectChildSchema(-1)).toBe(null)
    expect($arr2.getDirectChildSchema(0)).toBe(registry.get('fov'))
  })

  test('extend + plain', () => {
    const reg1 = createSchemaRegistry({
      foo: { type: 'string' },
      bar: { type: 'boolean' },
      usingOldBar: { type: 'array', items: 'bar' },
    })

    const reg2 = reg1.extend({
      bar: 'foo',
      baz: { type: 'array', items: 'foo' },
    })

    // ----------------------------------------------------------------
    // nothing extended?

    expect(reg1.extend(null)).toBe(reg1)
    expect(reg1.extend({})).toBe(reg1)

    // ----------------------------------------------------------------

    const $foo = reg2.get('foo')
    expect($foo).toBe(reg1.get('foo'))  // PatchedSchema is reused as-is

    expect(reg2.get('bar')).toBe($foo)  // id "bar" is overwritten
    expect(reg2.get('baz').getDirectChildSchema(1)).toBe($foo)  // new array type is using 'foo'

    // old references are not affected

    const $usingOldBar = reg2.get('usingOldBar')
    assert($usingOldBar.isArray())
    expect($usingOldBar.items.type).toBe('boolean')
  })

  test('extend + anotherRegistry', () => {
    const reg1 = createSchemaRegistry({
      foo: { type: 'string' },
      bar: { type: 'boolean' },
      usingOldBar: { type: 'array', items: 'bar' },
    })

    const reg2 = createSchemaRegistry({
      bar: { type: 'number' },
      baz: { type: 'array', items: 'bar' },
    })

    const finalReg = reg1.extend(reg2)

    // ----------------------------------------------------------------

    expect(finalReg.get('bar').type).toBe('number')   // "bar" is overwritten by reg2
    expect(finalReg.get('bar')).toBe(reg2.get('bar')) // reused from reg2

    // old references are not affected

    const $usingOldBar = finalReg.get('usingOldBar')
    assert($usingOldBar.isArray())
    expect($usingOldBar.items.type).toBe('boolean')
  })

  test('createSchemaRegistry + extendsFrom', () => {
    const reg1 = createSchemaRegistry({
      foo: { type: 'string' },
      bar: { type: 'boolean' },
      usingOldBar: { type: 'array', items: 'bar' },
    })

    const reg2 = createSchemaRegistry({
      bar: { type: 'number' },
      baz: { type: 'array', items: 'bar' },
    }, reg1) // <-- 

    // ----------------------------------------------------------------

    expect(reg2.get('bar').type).toBe('number')   // "bar" is overwritten by reg2

    // old references are not affected

    const $usingOldBar = reg2.get('usingOldBar')
    assert($usingOldBar.isArray())
    expect($usingOldBar.items.type).toBe('boolean')
  })
})
