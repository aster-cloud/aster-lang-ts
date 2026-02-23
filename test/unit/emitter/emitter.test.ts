import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emitJava } from '../../../src/jvm/emitter.js';
import { Core } from '../../../src/core/core_ir.js';
import type { Core as CoreTypes } from '../../../src/types.js';

function createTempDir(): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aster-emitter-'));
  return base;
}

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

async function emitToTemp(module: CoreTypes.Module): Promise<{ outDir: string; cleanup: () => void }> {
  const outDir = createTempDir();
  let cleaned = false;
  return {
    outDir,
    cleanup: () => {
      if (!cleaned) {
        fs.rmSync(outDir, { recursive: true, force: true });
        cleaned = true;
      }
    },
  };
}

async function emitJavaClassContent(module: CoreTypes.Module, relativePath: string[]): Promise<string> {
  const { outDir, cleanup } = await emitToTemp(module);
  try {
    await emitJava(module, outDir);
    const filePath = path.join(outDir, ...relativePath);
    return readFile(filePath);
  } finally {
    cleanup();
  }
}

describe('JVM 代码生成器', () => {
  it('应生成数据类型对应的 Java 类', async () => {
    const module = Core.Module('test.emitter.data', [
      Core.Data('User', [
        { name: 'id', type: Core.TypeName('Text') },
        { name: 'age', type: Core.TypeName('Int') },
      ]),
    ]);
    const { outDir, cleanup } = await emitToTemp(module);
    try {
      await emitJava(module, outDir);
      const filePath = path.join(outDir, 'test', 'emitter', 'data', 'User.java');
      assert.equal(fs.existsSync(filePath), true);
      const content = readFile(filePath);
      assert.equal(content.includes('public final class User'), true);
      assert.equal(content.includes('public final String id;'), true);
    } finally {
      cleanup();
    }
  });

  it('应生成枚举声明', async () => {
    const module = Core.Module('test.emitter.enum', [Core.Enum('Status', ['Pending', 'Success'])]);
    const { outDir, cleanup } = await emitToTemp(module);
    try {
      await emitJava(module, outDir);
      const filePath = path.join(outDir, 'test', 'emitter', 'enum', 'Status.java');
      const content = readFile(filePath);
      assert.equal(content.includes('public enum Status'), true);
      assert.equal(content.includes('Pending'), true);
    } finally {
      cleanup();
    }
  });

  it('应生成函数包装类并渲染主体', async () => {
    const funcBody = Core.Block([Core.Return(Core.String('pong'))]);
    const funcDecl: CoreTypes.Func = Core.Func(
      'ping',
      [],
      [{ name: 'input', type: Core.TypeName('Text') }],
      Core.TypeName('Text'),
      [],
      funcBody
    );
    const module = Core.Module('test.emitter.func', [funcDecl]);
    const { outDir, cleanup } = await emitToTemp(module);
    try {
      await emitJava(module, outDir);
      const filePath = path.join(outDir, 'test', 'emitter', 'func', 'ping_fn.java');
      const content = readFile(filePath);
      assert.equal(content.includes('public static String ping'), true);
      assert.equal(content.includes('return "pong";'), true);
    } finally {
      cleanup();
    }
  });

  it('应为枚举匹配生成 switch 结构', async () => {
    const enumDecl = Core.Enum('Status', ['Ok', 'Err']);
    const matcher = Core.Func(
      'classify',
      [],
      [{ name: 'status', type: Core.TypeName('Status') }],
      Core.TypeName('int'),
      [],
      Core.Block([
        Core.Match(Core.Name('status'), [
          Core.Case(Core.PatName('Ok'), Core.Return(Core.Int(1))),
          Core.Case(Core.PatName('Err'), Core.Return(Core.Int(0))),
        ]),
      ])
    );
    const module = Core.Module('test.emitter.match', [enumDecl, matcher]);
    const { outDir, cleanup } = await emitToTemp(module);
    try {
      await emitJava(module, outDir);
      const filePath = path.join(outDir, 'test', 'emitter', 'match', 'classify_fn.java');
      const content = readFile(filePath);
      assert.equal(content.includes('switch((Status)__scrut)'), true);
      assert.equal(content.includes('case Status.Ok'), true);
      assert.equal(content.includes('return 1;'), true);
    } finally {
      cleanup();
    }
  });

  it('嵌套数据匹配应生成 instanceof 守卫与解构', async () => {
    const pairData = Core.Data('Pair', [
      { name: 'left', type: Core.TypeName('Object') },
      { name: 'right', type: Core.TypeName('Object') },
    ]);
    const matcher = Core.Func(
      'unwrap',
      [],
      [{ name: 'value', type: Core.TypeName('Pair') }],
      Core.TypeName('Object'),
      [],
      Core.Block([
        Core.Match(Core.Name('value'), [
          Core.Case(
            Core.PatCtor('Pair', [], [
              Core.PatName('a'),
              Core.PatCtor('Pair', ['innerLeft']),
            ]),
            Core.Return(Core.Name('innerLeft'))
          ),
        ]),
      ])
    );
    const module = Core.Module('test.emitter.nested_match', [pairData, matcher]);
    const { outDir, cleanup } = await emitToTemp(module);
    try {
      await emitJava(module, outDir);
      const filePath = path.join(outDir, 'test', 'emitter', 'nested_match', 'unwrap_fn.java');
      const content = readFile(filePath);
      assert.equal(content.includes('if (__scrut instanceof Pair)'), true);
      assert.equal(content.includes('var __tmp = (Pair)__scrut;'), true);
      assert.equal(content.includes('__tmp_1'), true);
    } finally {
      cleanup();
    }
  });

  it('数据类应对 List 与 Map 字段生成泛型类型', async () => {
    const module = Core.Module('test.emitter.collections', [
      Core.Data('Catalog', [
        { name: 'items', type: Core.List(Core.TypeName('Int')) },
        {
          name: 'metadata',
          type: Core.Map(Core.TypeName('Text'), Core.TypeName('Text')),
        },
      ]),
    ]);
    const { outDir, cleanup } = await emitToTemp(module);
    try {
      await emitJava(module, outDir);
      const filePath = path.join(outDir, 'test', 'emitter', 'collections', 'Catalog.java');
      const content = readFile(filePath);
      assert.equal(content.includes('java.util.List<int> items;'), true);
      assert.equal(content.includes('java.util.Map<String, String> metadata;'), true);
    } finally {
      cleanup();
    }
  });

  it('Scope 语句应串联内部语句输出', async () => {
    const scopedBody = Core.Block([
      Core.Scope([
        Core.Let('temp', Core.Int(1)),
        Core.Set('result', Core.Int(2)),
      ]),
      Core.Return(Core.Name('result')),
    ]);
    const funcDecl: CoreTypes.Func = Core.Func(
      'withScope',
      [],
      [{ name: 'result', type: Core.TypeName('int') }],
      Core.TypeName('int'),
      [],
      scopedBody
    );
    const module = Core.Module('test.emitter.scope', [funcDecl]);
    const { outDir, cleanup } = await emitToTemp(module);
    try {
      await emitJava(module, outDir);
      const filePath = path.join(outDir, 'test', 'emitter', 'scope', 'withScope_fn.java');
      const content = readFile(filePath);
      assert.equal(content.includes('var temp = 1;'), true);
      assert.equal(content.includes('result = 2;'), true);
    } finally {
      cleanup();
    }
  });

  it('Start 与 Wait 语句暂未实现时应输出占位注释', async () => {
    const funcDecl: CoreTypes.Func = Core.Func(
      'asyncStub',
      [],
      [],
      Core.TypeName('void'),
      [],
      Core.Block([
        Core.Start('task', Core.Name('producer')),
        Core.Wait(['task']),
      ])
    );
    const module = Core.Module('test.emitter.async', [funcDecl]);
    const { outDir, cleanup } = await emitToTemp(module);
    try {
      await emitJava(module, outDir);
      const filePath = path.join(outDir, 'test', 'emitter', 'async', 'asyncStub_fn.java');
      const content = readFile(filePath);
      assert.equal(content.includes('// async not implemented in MVP'), true);
    } finally {
      cleanup();
    }
  });

  it('Await 表达式当前回退为 null 占位', async () => {
    const funcDecl: CoreTypes.Func = Core.Func(
      'awaitFallback',
      [],
      [],
      Core.TypeName('Object'),
      [],
      Core.Block([Core.Return(Core.Await(Core.Name('future')))])
    );
    const module = Core.Module('test.emitter.await', [funcDecl]);
    const { outDir, cleanup } = await emitToTemp(module);
    try {
      await emitJava(module, outDir);
      const filePath = path.join(outDir, 'test', 'emitter', 'await', 'awaitFallback_fn.java');
      const content = readFile(filePath);
      assert.equal(content.includes('return null;'), true);
    } finally {
      cleanup();
    }
  });

  it('javaType 应将 Maybe<Text> 映射为可空字符串', async () => {
    const module = Core.Module('test.emitter.java_type_maybe_text', [
      Core.Data('MaybeSample', [
        { name: 'value', type: Core.Maybe(Core.TypeName('Text')) },
      ]),
    ]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'java_type_maybe_text',
      'MaybeSample.java',
    ]);
    assert.equal(content.includes('public final String value;'), true);
  });

  it('javaType 应将 Maybe 自定义类型保持引用类型', async () => {
    const module = Core.Module('test.emitter.java_type_maybe_custom', [
      Core.Data('Profile', [
        { name: 'name', type: Core.TypeName('Text') },
      ]),
      Core.Data('Wrapper', [
        { name: 'payload', type: Core.Maybe(Core.TypeName('Profile')) },
      ]),
    ]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'java_type_maybe_custom',
      'Wrapper.java',
    ]);
    assert.equal(content.includes('public final Profile payload;'), true);
  });

  it('javaType 应将 Option<Bool> 映射为布尔类型', async () => {
    const module = Core.Module('test.emitter.java_type_option_bool', [
      Core.Data('FlagHolder', [
        { name: 'active', type: Core.Option(Core.TypeName('Bool')) },
      ]),
    ]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'java_type_option_bool',
      'FlagHolder.java',
    ]);
    assert.equal(content.includes('public final boolean active;'), true);
  });

  it('javaType 应将 Result<Text, Int> 映射为运行时包装', async () => {
    const module = Core.Module('test.emitter.java_type_result', [
      Core.Data('ActionResult', [
        {
          name: 'state',
          type: Core.Result(Core.TypeName('Text'), Core.TypeName('Int')),
        },
      ]),
    ]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'java_type_result',
      'ActionResult.java',
    ]);
    assert.equal(content.includes('aster.runtime.Result<String, int> state;'), true);
  });

  it('Let 语句应生成局部变量声明', async () => {
    const func = Core.Func(
      'initCounter',
      [],
      [],
      Core.TypeName('int'),
      [],
      Core.Block([Core.Let('counter', Core.Int(0)), Core.Return(Core.Name('counter'))])
    );
    const module = Core.Module('test.emitter.let_statement', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'let_statement',
      'initCounter_fn.java',
    ]);
    assert.equal(content.includes('var counter = 0;'), true);
  });

  it('Set 语句应输出赋值语句', async () => {
    const func = Core.Func(
      'assignValue',
      [],
      [{ name: 'value', type: Core.TypeName('int') }],
      Core.TypeName('int'),
      [],
      Core.Block([Core.Set('value', Core.Int(10)), Core.Return(Core.Name('value'))])
    );
    const module = Core.Module('test.emitter.set_statement', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'set_statement',
      'assignValue_fn.java',
    ]);
    assert.equal(content.includes('value = 10;'), true);
  });

  it('Set 语句应保留函数调用结果', async () => {
    const func = Core.Func(
      'updateValue',
      [],
      [],
      Core.TypeName('int'),
      [],
      Core.Block([
        Core.Let('value', Core.Int(1)),
        Core.Set('value', Core.Call(Core.Name('increment'), [Core.Name('value')])),
        Core.Return(Core.Name('value')),
      ])
    );
    const module = Core.Module('test.emitter.set_call', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'set_call',
      'updateValue_fn.java',
    ]);
    assert.equal(content.includes('value = increment(value);'), true);
  });

  it('If 语句应输出 else 分支结构', async () => {
    const func = Core.Func(
      'chooseValue',
      [],
      [{ name: 'flag', type: Core.TypeName('boolean') }],
      Core.TypeName('int'),
      [],
      Core.Block([
        Core.If(
          Core.Name('flag'),
          Core.Block([Core.Return(Core.Int(1))]),
          Core.Block([Core.Return(Core.Int(0))])
        ),
      ])
    );
    const module = Core.Module('test.emitter.if_else', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'if_else',
      'chooseValue_fn.java',
    ]);
    assert.equal(content.includes('if (flag) {'), true);
    assert.equal(content.includes('} else {'), true);
  });

  it('If-else 语句应保持分支缩进', async () => {
    const func = Core.Func(
      'toggle',
      [],
      [],
      Core.TypeName('int'),
      [],
      Core.Block([
        Core.Let('result', Core.Int(0)),
        Core.If(
          Core.Bool(true),
          Core.Block([Core.Set('result', Core.Int(5))]),
          Core.Block([Core.Set('result', Core.Int(8))])
        ),
        Core.Return(Core.Name('result')),
      ])
    );
    const module = Core.Module('test.emitter.if_indent', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'if_indent',
      'toggle_fn.java',
    ]);
    assert.equal(content.includes('if (true) {'), true);
    assert.equal(content.includes('result = 5;'), true);
    assert.equal(content.includes('result = 8;'), true);
  });

  it('枚举匹配无返回体时应生成 break 语句', async () => {
    const enumDecl = Core.Enum('Status', ['Idle', 'Busy']);
    const func = Core.Func(
      'score',
      [],
      [{ name: 'status', type: Core.TypeName('Status') }],
      Core.TypeName('int'),
      [],
      Core.Block([
        Core.Let('result', Core.Int(0)),
        Core.Match(Core.Name('status'), [
          Core.Case(Core.PatName('Idle'), Core.Block([Core.Set('result', Core.Int(1))])),
          Core.Case(Core.PatName('Busy'), Core.Block([Core.Set('result', Core.Int(2))])),
        ]),
        Core.Return(Core.Name('result')),
      ])
    );
    const module = Core.Module('test.emitter.enum_break', [enumDecl, func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'enum_break',
      'score_fn.java',
    ]);
    assert.equal(content.includes('switch((Status)__scrut)'), true);
    assert.equal(content.includes('break;'), true);
  });

  it('整数模式匹配应转换为 switch 结构', async () => {
    const func = Core.Func(
      'mapCode',
      [],
      [{ name: 'code', type: Core.TypeName('int') }],
      Core.TypeName('int'),
      [],
      Core.Block([
        Core.Let('result', Core.Int(0)),
        Core.Match(Core.Name('code'), [
          Core.Case(Core.PatInt(1), Core.Block([Core.Set('result', Core.Int(10))])),
          Core.Case(Core.PatInt(2), Core.Block([Core.Set('result', Core.Int(20))])),
        ]),
        Core.Return(Core.Name('result')),
      ])
    );
    const module = Core.Module('test.emitter.int_switch', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'int_switch',
      'mapCode_fn.java',
    ]);
    assert.equal(content.includes('switch (code)'), true);
    assert.equal(content.includes('default: break;'), true);
  });

  it('PatNull 与 PatName fallback 应添加空检查', async () => {
    const func = Core.Func(
      'describe',
      [],
      [{ name: 'input', type: Core.TypeName('Object') }],
      Core.TypeName('String'),
      [],
      Core.Block([
        Core.Match(Core.Name('input'), [
          Core.Case(Core.PatNull(), Core.Return(Core.String('missing'))),
          Core.Case(Core.PatName('value'), Core.Return(Core.String('present'))),
        ]),
        Core.Return(Core.String('fallback')),
      ])
    );
    const module = Core.Module('test.emitter.pat_null_name', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'pat_null_name',
      'describe_fn.java',
    ]);
    assert.equal(content.includes('if (__scrut == null)'), true);
    assert.equal(content.includes('if (__scrut != null)'), true);
  });

  it('Ok 与 Err 构造应生成运行时包装', async () => {
    const func = Core.Func(
      'wrap',
      [],
      [],
      Core.TypeName('Object'),
      [],
      Core.Block([
        Core.Let('okResult', Core.Ok(Core.Int(1))),
        Core.Let('errResult', Core.Err(Core.String('fail'))),
        Core.Return(Core.Name('okResult')),
      ])
    );
    const module = Core.Module('test.emitter.ok_err', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'ok_err',
      'wrap_fn.java',
    ]);
    assert.equal(content.includes('new aster.runtime.Ok<>(1)'), true);
    assert.equal(content.includes('new aster.runtime.Err<>("fail")'), true);
  });

  it('Some 与 None 应对应可空值表达', async () => {
    const func = Core.Func(
      'optionUsage',
      [],
      [],
      Core.TypeName('Object'),
      [],
      Core.Block([
        Core.Let('someValue', Core.Some(Core.String('done'))),
        Core.Let('noneValue', Core.None()),
        Core.Return(Core.Name('someValue')),
      ])
    );
    const module = Core.Module('test.emitter.some_none', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'some_none',
      'optionUsage_fn.java',
    ]);
    assert.equal(content.includes('var someValue = "done";'), true);
    assert.equal(content.includes('var noneValue = null;'), true);
  });

  it('Text.concat 应拼接字符串', async () => {
    const func = Core.Func(
      'joinText',
      [],
      [],
      Core.TypeName('String'),
      [],
      Core.Block([
        Core.Return(
          Core.Call(Core.Name('Text.concat'), [Core.String('A'), Core.String('B')])
        ),
      ])
    );
    const module = Core.Module('test.emitter.text_concat', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'text_concat',
      'joinText_fn.java',
    ]);
    assert.equal(content.includes('return ("A" + "B");'), true);
  });

  it('Text.replace 应映射为 Java replace', async () => {
    const func = Core.Func(
      'replace',
      [],
      [],
      Core.TypeName('String'),
      [],
      Core.Block([
        Core.Return(
          Core.Call(Core.Name('Text.replace'), [
            Core.Name('input'),
            Core.String('X'),
            Core.String('Y'),
          ])
        ),
      ])
    );
    const module = Core.Module('test.emitter.text_replace', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'text_replace',
      'replace_fn.java',
    ]);
    assert.equal(content.includes('return input.replace("X", "Y");'), true);
  });

  it('Text.split 应转换为 Arrays.asList', async () => {
    const func = Core.Func(
      'split',
      [],
      [],
      Core.TypeName('Object'),
      [],
      Core.Block([
        Core.Return(
          Core.Call(Core.Name('Text.split'), [Core.Name('path'), Core.String('/')])
        ),
      ])
    );
    const module = Core.Module('test.emitter.text_split', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'text_split',
      'split_fn.java',
    ]);
    assert.equal(content.includes('java.util.Arrays.asList(path.split("/"))'), true);
  });

  it('Text.length 应映射为 length 方法', async () => {
    const func = Core.Func(
      'length',
      [],
      [],
      Core.TypeName('int'),
      [],
      Core.Block([
        Core.Return(Core.Call(Core.Name('Text.length'), [Core.Name('input')])),
      ])
    );
    const module = Core.Module('test.emitter.text_length', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'text_length',
      'length_fn.java',
    ]);
    assert.equal(content.includes('return input.length();'), true);
  });

  it('Text.contains 应映射为 contains 调用', async () => {
    const func = Core.Func(
      'contains',
      [],
      [],
      Core.TypeName('boolean'),
      [],
      Core.Block([
        Core.Return(
          Core.Call(Core.Name('Text.contains'), [Core.Name('source'), Core.String('needle')])
        ),
      ])
    );
    const module = Core.Module('test.emitter.text_contains', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'text_contains',
      'contains_fn.java',
    ]);
    assert.equal(content.includes('return source.contains("needle");'), true);
  });

  it('Text.trim 未特化时应保留直接调用', async () => {
    const func = Core.Func(
      'trim',
      [],
      [],
      Core.TypeName('String'),
      [],
      Core.Block([
        Core.Return(Core.Call(Core.Name('Text.trim'), [Core.String(' value ')])),
      ])
    );
    const module = Core.Module('test.emitter.text_trim', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'text_trim',
      'trim_fn.java',
    ]);
    assert.equal(content.includes('return Text.trim(" value ");'), true);
  });

  it('javaType 应将 TypeVar 映射为 Object', async () => {
    const func = Core.Func(
      'identity',
      ['T'],
      [{ name: 'value', type: Core.TypeVar('T') }],
      Core.TypeVar('T'),
      [],
      Core.Block([Core.Return(Core.Name('value'))])
    );
    const module = Core.Module('test.emitter.java_type_var', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'java_type_var',
      'identity_fn.java',
    ]);
    assert.equal(content.includes('public static Object identity(Object value)'), true);
  });

  it('javaType 应将 TypeApp 映射为 Object', async () => {
    const func = Core.Func(
      'consume',
      [],
      [
        {
          name: 'future',
          type: Core.TypeApp('Future', [Core.TypeName('Text')]),
        },
      ],
      Core.TypeName('void'),
      [],
      Core.Block([Core.Return(Core.Null())])
    );
    const module = Core.Module('test.emitter.java_type_app', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'java_type_app',
      'consume_fn.java',
    ]);
    assert.equal(content.includes('Object future'), true);
  });

  it('javaType 应根据参数数量选择 Fn 接口', async () => {
    const fnType: CoreTypes.FuncType = {
      kind: 'FuncType',
      params: [Core.TypeName('Text'), Core.TypeName('Int')],
      ret: Core.TypeName('Bool'),
    };
    const func = Core.Func(
      'apply',
      [],
      [{ name: 'fn', type: fnType }],
      Core.TypeName('boolean'),
      [],
      Core.Block([Core.Return(Core.Bool(true))])
    );
    const module = Core.Module('test.emitter.java_type_func', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'java_type_func',
      'apply_fn.java',
    ]);
    assert.equal(content.includes('aster.runtime.Fn2 fn'), true);
  });

  it('List.length 应映射为 size 调用', async () => {
    const func = Core.Func(
      'size',
      [],
      [{ name: 'items', type: Core.List(Core.TypeName('Object')) }],
      Core.TypeName('int'),
      [],
      Core.Block([
        Core.Return(Core.Call(Core.Name('List.length'), [Core.Name('items')])),
      ])
    );
    const module = Core.Module('test.emitter.list_length', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'list_length',
      'size_fn.java',
    ]);
    assert.equal(content.includes('return items.size();'), true);
  });

  it('List.get 应映射为 get 调用', async () => {
    const func = Core.Func(
      'getItem',
      [],
      [{ name: 'items', type: Core.List(Core.TypeName('Object')) }],
      Core.TypeName('Object'),
      [],
      Core.Block([
        Core.Return(
          Core.Call(Core.Name('List.get'), [Core.Name('items'), Core.Int(1)])
        ),
      ])
    );
    const module = Core.Module('test.emitter.list_get', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'list_get',
      'getItem_fn.java',
    ]);
    assert.equal(content.includes('return items.get(1);'), true);
  });

  it('List.head 应生成空检查逻辑', async () => {
    const func = Core.Func(
      'head',
      [],
      [{ name: 'items', type: Core.List(Core.TypeName('Object')) }],
      Core.TypeName('Object'),
      [],
      Core.Block([
        Core.Return(Core.Call(Core.Name('List.head'), [Core.Name('items')])),
      ])
    );
    const module = Core.Module('test.emitter.list_head', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'list_head',
      'head_fn.java',
    ]);
    assert.equal(
      content.includes('return (items.isEmpty() ? null : items.get(0));'),
      true
    );
  });

  it('Map.get 应映射为 get 调用', async () => {
    const func = Core.Func(
      'byKey',
      [],
      [
        {
          name: 'mapping',
          type: Core.Map(Core.TypeName('String'), Core.TypeName('String')),
        },
      ],
      Core.TypeName('String'),
      [],
      Core.Block([
        Core.Return(
          Core.Call(Core.Name('Map.get'), [Core.Name('mapping'), Core.String('key')])
        ),
      ])
    );
    const module = Core.Module('test.emitter.map_get', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'map_get',
      'byKey_fn.java',
    ]);
    assert.equal(content.includes('return mapping.get("key");'), true);
  });

  it('Scope 语句应按序展开内部语句', async () => {
    const func = Core.Func(
      'useScope',
      [],
      [],
      Core.TypeName('int'),
      [],
      Core.Block([
        Core.Scope([Core.Let('x', Core.Int(1)), Core.Set('x', Core.Int(3))]),
        Core.Return(Core.Name('x')),
      ])
    );
    const module = Core.Module('test.emitter.scope_flat', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'scope_flat',
      'useScope_fn.java',
    ]);
    assert.equal(content.includes('var x = 1;'), true);
    assert.equal(content.includes('x = 3;'), true);
  });

  it('嵌套 Scope 应保持缩进', async () => {
    const func = Core.Func(
      'nestedScope',
      [],
      [],
      Core.TypeName('int'),
      [],
      Core.Block([
        Core.Scope([
          Core.Let('outer', Core.Int(1)),
          Core.Scope([Core.Let('inner', Core.Int(2))]),
        ]),
        Core.Return(Core.Name('outer')),
      ])
    );
    const module = Core.Module('test.emitter.scope_nested', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'scope_nested',
      'nestedScope_fn.java',
    ]);
    assert.equal(content.includes('var outer = 1;'), true);
    assert.equal(content.includes('  var inner = 2;'), true);
  });

  it('Construct 表达式应生成类型实例化', async () => {
    const module = Core.Module('test.emitter.construct', [
      Core.Data('User', [
        { name: 'name', type: Core.TypeName('String') },
        { name: 'age', type: Core.TypeName('int') },
      ]),
      Core.Func(
        'build',
        [],
        [],
        Core.TypeName('User'),
        [],
        Core.Block([
          Core.Return(
            Core.Construct('User', [
              { name: 'name', expr: Core.String('alice') },
              { name: 'age', expr: Core.Int(30) },
            ])
          ),
        ])
      ),
    ]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'construct',
      'build_fn.java',
    ]);
    assert.equal(content.includes('return new User("alice", 30);'), true);
  });

  it('Match 多分支应解构数据字段', async () => {
    const pair = Core.Data('Pair', [
      { name: 'left', type: Core.TypeName('Object') },
      { name: 'right', type: Core.TypeName('Object') },
    ]);
    const func = Core.Func(
      'describePair',
      [],
      [{ name: 'value', type: Core.TypeName('Pair') }],
      Core.TypeName('Object'),
      [],
      Core.Block([
        Core.Match(Core.Name('value'), [
          Core.Case(
            Core.PatCtor('Pair', [], [Core.PatName('left'), Core.PatName('right')]),
            Core.Return(Core.Name('left'))
          ),
          Core.Case(Core.PatName('other'), Core.Return(Core.Name('other'))),
        ]),
        Core.Return(Core.Null()),
      ])
    );
    const module = Core.Module('test.emitter.match_fields', [pair, func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'match_fields',
      'describePair_fn.java',
    ]);
    assert.equal(content.includes('var left = __tmp.left;'), true);
    assert.equal(content.includes('var right = __tmp.right;'), true);
    assert.equal(content.includes('if (__scrut != null)'), true);
  });

  it('Match 混合 Null 与构造体应按序生成守卫', async () => {
    const wrapper = Core.Data('Wrapper', [
      { name: 'payload', type: Core.TypeName('Object') },
    ]);
    const func = Core.Func(
      'analyze',
      [],
      [{ name: 'input', type: Core.TypeName('Wrapper') }],
      Core.TypeName('String'),
      [],
      Core.Block([
        Core.Match(Core.Name('input'), [
          Core.Case(Core.PatNull(), Core.Return(Core.String('null'))),
          Core.Case(
            Core.PatCtor('Wrapper', [], [Core.PatName('payload')]),
            Core.Return(Core.String('payload'))
          ),
        ]),
        Core.Return(Core.String('none')),
      ])
    );
    const module = Core.Module('test.emitter.match_order', [wrapper, func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'match_order',
      'analyze_fn.java',
    ]);
    assert.equal(content.includes('if (__scrut == null)'), true);
    assert.equal(content.includes('if (__scrut instanceof Wrapper)'), true);
  });

  it('Return 语句应直接返回表达式', async () => {
    const func = Core.Func(
      'giveBack',
      [],
      [],
      Core.TypeName('boolean'),
      [],
      Core.Block([Core.Return(Core.Bool(true))])
    );
    const module = Core.Module('test.emitter.return_stmt', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'return_stmt',
      'giveBack_fn.java',
    ]);
    assert.equal(content.includes('return true;'), true);
  });

  it('链式调用应保持嵌套顺序', async () => {
    const func = Core.Func(
      'chain',
      [],
      [],
      Core.TypeName('Object'),
      [],
      Core.Block([
        Core.Return(
          Core.Call(Core.Name('outer'), [
            Core.Call(Core.Name('middle'), [Core.Call(Core.Name('inner'), [])]),
          ])
        ),
      ])
    );
    const module = Core.Module('test.emitter.call_chain', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'call_chain',
      'chain_fn.java',
    ]);
    assert.equal(content.includes('return outer(middle(inner()));'), true);
  });

  it('not 内置函数应转换为逻辑非表达式', async () => {
    const func = Core.Func(
      'negate',
      [],
      [],
      Core.TypeName('boolean'),
      [],
      Core.Block([
        Core.Return(
          Core.Call(Core.Name('not'), [
            Core.Call(Core.Name('Text.contains'), [Core.Name('source'), Core.String('a')]),
          ])
        ),
      ])
    );
    const module = Core.Module('test.emitter.call_not', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'call_not',
      'negate_fn.java',
    ]);
    assert.equal(content.includes('return !(source.contains("a"));'), true);
  });

  it('Start 语句应输出占位注释', async () => {
    const func = Core.Func(
      'launch',
      [],
      [],
      Core.TypeName('void'),
      [],
      Core.Block([Core.Start('job', Core.Name('producer'))])
    );
    const module = Core.Module('test.emitter.start_stmt', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'start_stmt',
      'launch_fn.java',
    ]);
    assert.equal(content.includes('// async not implemented in MVP'), true);
  });

  it('Wait 语句应输出占位注释', async () => {
    const func = Core.Func(
      'awaitAll',
      [],
      [],
      Core.TypeName('void'),
      [],
      Core.Block([Core.Wait(['first', 'second'])])
    );
    const module = Core.Module('test.emitter.wait_stmt', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'wait_stmt',
      'awaitAll_fn.java',
    ]);
    assert.equal(content.includes('// async not implemented in MVP'), true);
  });

  it('Within scope 语句应串联内部赋值', async () => {
    const func = Core.Func(
      'withinScope',
      [],
      [],
      Core.TypeName('int'),
      [],
      Core.Block([
        Core.Scope([Core.Let('temp', Core.Int(5)), Core.Set('temp', Core.Int(9))]),
        Core.Return(Core.Name('temp')),
      ])
    );
    const module = Core.Module('test.emitter.within_scope', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'within_scope',
      'withinScope_fn.java',
    ]);
    assert.equal(content.includes('var temp = 5;'), true);
    assert.equal(content.includes('temp = 9;'), true);
  });

  it('类型注解应传递到函数签名', async () => {
    const func = Core.Func(
      'withTypes',
      [],
      [
        {
          name: 'items',
          type: Core.List(Core.TypeName('String')),
        },
      ],
      Core.Map(Core.TypeName('String'), Core.TypeName('String')),
      [],
      Core.Block([Core.Return(Core.Null())])
    );
    const module = Core.Module('test.emitter.type_annotations', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'type_annotations',
      'withTypes_fn.java',
    ]);
    assert.equal(content.includes('java.util.List<String> items'), true);
    assert.equal(
      content.includes('public static java.util.Map<String, String> withTypes'),
      true
    );
  });

  it('函数缺失 return 时应生成兜底返回', async () => {
    const func = Core.Func(
      'fallback',
      [],
      [],
      Core.TypeName('String'),
      [],
      Core.Block([])
    );
    const module = Core.Module('test.emitter.fallback_return', [func]);
    const content = await emitJavaClassContent(module, [
      'test',
      'emitter',
      'fallback_return',
      'fallback_fn.java',
    ]);
    assert.equal(content.includes('return null;'), true);
  });
});
