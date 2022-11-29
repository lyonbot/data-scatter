export function addReturnKeywordIfNeeded(code: string): string {
  try {
    const tempCode = `return (\n${code}\n);`;
    // eslint-disable-next-line no-new-func
    newFunction([], tempCode); // 如果有语法错误会抛出
    return tempCode;
  } catch (err) {
    /* istanbul ignore else */
    if (err instanceof SyntaxError) return code;

    /* istanbul ignore next */
    throw err;
  }
}

export type GeneratedFunction<ArgNames extends any[], Result = any> = (...args: Array<ArgNames>) => Result;

export function newFunction<
  ArgNames extends string[] = string[],
  T extends GeneratedFunction<ArgNames> = GeneratedFunction<ArgNames>
>(
  args: ArgNames,
  code: string,
  options?: { async?: boolean },
) {
  if (!options) options = {};
  if (options.async) code = `return (async()=>{\n${code}\n})()`;

  const fn = new Function(...args, code) as T;
  return fn;
}
