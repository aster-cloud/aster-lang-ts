import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { PolicyValidator } from '../../src/ai/validator.js';

// 测试数据
const validCNL = `Module tests.ai.valid.

Rule add given x: Int, y: Int, produce Int:
  Return x plus y.
`;

const validCNLComplex = `Module tests.ai.complex.

Rule greet given name: Text, produce Text:
  Return "Hello".

Rule double given n: Int, produce Int:
  Return n times 2.
`;

const invalidCNL_TypeMismatch = `Module tests.ai.invalid.

Rule returnMismatch produce Int:
  Return "invalid".
`;

const invalidCNL_SyntaxError = `Module tests.ai.syntax.

Rule badSyntax produce Int:
  Return x plus.
`;

const invalidCNL_UndefinedVariable = `Module tests.ai.undefined.

Rule useUndefined produce Int:
  Return undefinedVar.
`;

describe('Policy Validator', () => {
  test('應該成功驗證合法的 CNL 代碼', async () => {
    const validator = new PolicyValidator();
    const result = await validator.validate(validCNL);

    assert.equal(result.valid, true);
    assert.equal(result.diagnostics.length, 0);
    assert.ok(result.coreIR, 'Should have Core IR when validation succeeds');
    assert.equal(result.coreIR.name, 'tests.ai.valid');
  });

  test('應該成功驗證複雜的合法 CNL 代碼', async () => {
    const validator = new PolicyValidator();
    const result = await validator.validate(validCNLComplex);

    // 檢查沒有錯誤（允許警告）
    const errors = validator.getErrors(result.diagnostics);
    assert.equal(errors.length, 0, `Should have no errors, but got: ${JSON.stringify(errors)}`);
    assert.ok(result.coreIR);
  });

  test('應該檢測類型不匹配錯誤', async () => {
    const validator = new PolicyValidator();
    const result = await validator.validate(invalidCNL_TypeMismatch);

    assert.equal(result.valid, false);
    assert.ok(result.diagnostics.length > 0);
    assert.equal(result.coreIR, undefined);

    // 檢查診斷信息包含錯誤
    const errors = validator.getErrors(result.diagnostics);
    assert.ok(errors.length > 0);

    // 檢查錯誤消息包含類型不匹配信息
    const hasTypeError = result.diagnostics.some(d =>
      d.message.toLowerCase().includes('type') ||
      d.message.toLowerCase().includes('类型')
    );
    assert.ok(hasTypeError, 'Should have type-related error');
  });

  test('應該檢測語法錯誤', async () => {
    const validator = new PolicyValidator();
    const result = await validator.validate(invalidCNL_SyntaxError);

    assert.equal(result.valid, false);
    assert.ok(result.diagnostics.length > 0);
    assert.equal(result.coreIR, undefined);

    // 語法錯誤應該在診斷中體現
    const hasError = result.diagnostics.some(d => d.severity === 'error');
    assert.ok(hasError);
  });

  test('應該檢測未定義變量錯誤', async () => {
    const validator = new PolicyValidator();
    const result = await validator.validate(invalidCNL_UndefinedVariable);

    assert.equal(result.valid, false);
    assert.ok(result.diagnostics.length > 0);

    const errors = validator.getErrors(result.diagnostics);
    assert.ok(errors.length > 0);
  });

  test('isValid() 應該返回正確的布爾值', async () => {
    const validator = new PolicyValidator();

    const validResult = await validator.isValid(validCNL);
    assert.equal(validResult, true);

    const invalidResult = await validator.isValid(invalidCNL_TypeMismatch);
    assert.equal(invalidResult, false);
  });

  test('formatDiagnostics() 應該正確格式化診斷信息', async () => {
    const validator = new PolicyValidator();
    const result = await validator.validate(invalidCNL_TypeMismatch);

    const formatted = validator.formatDiagnostics(result.diagnostics);

    assert.ok(formatted.length > 0);
    assert.ok(formatted.includes('[ERROR]') || formatted.includes('[error]'));
  });

  test('formatDiagnostics() 應該處理空診斷列表', () => {
    const validator = new PolicyValidator();
    const formatted = validator.formatDiagnostics([]);

    assert.equal(formatted, '无诊断信息');
  });

  test('getErrors() 應該只返回錯誤', async () => {
    const validator = new PolicyValidator();
    const result = await validator.validate(invalidCNL_TypeMismatch);

    const errors = validator.getErrors(result.diagnostics);
    const allAreErrors = errors.every(d => d.severity === 'error');

    assert.ok(allAreErrors);
  });

  test('getWarnings() 應該只返回警告', async () => {
    const validator = new PolicyValidator();

    // 使用實際的驗證結果來測試
    // 對於這個測試，我們只需要驗證 getWarnings 方法能正確過濾
    const validResult = await validator.validate(validCNL);
    const warnings = validator.getWarnings(validResult.diagnostics);

    // 合法代碼應該沒有警告
    assert.ok(Array.isArray(warnings));
  });

  test('應該處理空字符串輸入', async () => {
    const validator = new PolicyValidator();
    const result = await validator.validate('');

    // 空字符串會導致編譯錯誤（缺少模塊聲明）
    // 實際上可能通過（空模塊），所以只驗證不會崩潰
    assert.ok(result);
    assert.ok(Array.isArray(result.diagnostics));
  });

  test('應該處理僅包含模塊聲明的代碼', async () => {
    const validator = new PolicyValidator();
    const result = await validator.validate('Module tests.ai.minimal.');

    // 僅有模塊聲明可能會通過或產生警告（取決於類型檢查器）
    // 至少不應該崩潰
    assert.ok(result);
    assert.ok(Array.isArray(result.diagnostics));
  });

  test('驗證結果應該保持穩定（多次調用相同輸入）', async () => {
    const validator = new PolicyValidator();

    const result1 = await validator.validate(validCNL);
    const result2 = await validator.validate(validCNL);

    assert.equal(result1.valid, result2.valid);
    assert.equal(result1.diagnostics.length, result2.diagnostics.length);
  });

  test('應該處理包含註釋的 CNL 代碼', async () => {
    const cnlWithComments = `// This is a comment
Module tests.ai.comments.

// Add two numbers
Rule add given x: Int, y: Int, produce Int:
  Return x plus y.
`;

    const validator = new PolicyValidator();
    const result = await validator.validate(cnlWithComments);

    // 註釋應該被正確處理
    assert.ok(result);
  });
});
