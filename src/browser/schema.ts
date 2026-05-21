/**
 * @module @aster-cloud/aster-lang-ts/browser/schema
 *
 * Schema extraction for dynamic form generation. Split out of `browser.ts`
 * in the Round-3 codex refactor: previously the main browser entry was a
 * 660-line monolith mixing compile / validate / schema / evaluate / typecheck
 * gates. Public exports remain available from `@aster-cloud/aster-lang-ts/browser`
 * — this module is implementation detail.
 */

import { canonicalize } from '../frontend/canonicalizer.js';
import { lex } from '../frontend/lexer.js';
import { parse } from '../parser.js';
import { createKeywordTranslator, needsKeywordTranslation } from '../frontend/keyword-translator.js';
import { attachTypeInferenceRules } from '../config/lexicons/type-inference-rules.js';
import type { Lexicon } from '../config/lexicons/types.js';
import type { TypeKind, ParameterInfo, FieldInfo } from '../parser/input-generator.js';
import type { Declaration, Func, Data, Enum, Type } from '../types.js';

/** Schema extraction options */
export interface SchemaOptions {
  /** CNL lexicon (default: EN_US) */
  lexicon?: Lexicon;
  /** Target function name (default: first function) */
  functionName?: string;
}

export interface SchemaResult {
  /** Whether extraction succeeded */
  success: boolean;
  /** Module name */
  moduleName?: string;
  /** Function name */
  functionName?: string;
  /** Parameter schema */
  parameters?: ParameterInfo[];
  /** Error message if failed */
  error?: string;
}

/** Convert AST Type to type kind */
function getTypeKind(type: Type): TypeKind {
  if (!type || typeof type !== 'object' || !('kind' in type)) {
    return 'unknown';
  }
  switch (type.kind) {
    case 'TypeName': {
      const name = type.name.toLowerCase();
      if (['int', 'float', 'double', 'number', 'bool', 'boolean', 'text', 'string', 'datetime', 'date', 'time'].includes(name)) {
        return 'primitive';
      }
      // Custom type names are typically structs
      return 'struct';
    }
    case 'List':
      return 'list';
    case 'Map':
      return 'map';
    case 'Option':
    case 'Maybe':
      return 'option';
    case 'Result':
      return 'result';
    case 'FuncType':
      return 'function';
    default:
      return 'unknown';
  }
}

/** Convert AST Type to display string */
function typeToString(type: Type): string {
  if (!type || typeof type !== 'object' || !('kind' in type)) {
    return 'Unknown';
  }
  switch (type.kind) {
    case 'TypeName':
      return type.name;
    case 'List':
      return `List<${typeToString(type.type)}>`;
    case 'Map':
      return `Map<${typeToString(type.key)}, ${typeToString(type.val)}>`;
    case 'Option':
      return `Option<${typeToString(type.type)}>`;
    case 'Maybe':
      return `Maybe<${typeToString(type.type)}>`;
    case 'Result':
      return `Result<${typeToString(type.ok)}, ${typeToString(type.err)}>`;
    default:
      return 'Unknown';
  }
}

/**
 * Extract schema from CNL source code.
 *
 * Parses CNL source and extracts parameter schema for the specified function,
 * suitable for dynamic form generation.
 *
 * @example
 * ```typescript
 * const result = extractSchema(`
 *   Module loan.
 *   Define LoanApplication has creditScore as Int, amount as Float, term as Int.
 *   Rule evaluate given application as LoanApplication, produce Bool:
 *     If application.creditScore >= 700 then Return true
 *     Otherwise Return false.
 * `);
 * if (result.success) {
 *   console.log(result.parameters);
 * }
 * ```
 */
export function extractSchema(source: string, options?: SchemaOptions): SchemaResult {
  try {
    const lexicon = options?.lexicon;

    // Canonicalize with lexicon for language-specific normalization
    const canonical = canonicalize(source, lexicon);
    let tokens = lex(canonical, lexicon);

    // Translate non-English tokens to English for parser compatibility
    if (lexicon && needsKeywordTranslation(lexicon)) {
      const translator = createKeywordTranslator(lexicon);
      tokens = translator.translateTokens(tokens);
    }

    // Parse to AST
    const effectiveLexForSchema = lexicon ? attachTypeInferenceRules(lexicon) : undefined;
    const parseResult = parse(tokens, effectiveLexForSchema);

    if (parseResult.diagnostics.length > 0 && parseResult.ast.decls.length === 0) {
      return {
        success: false,
        error: parseResult.diagnostics[0]?.message ?? 'Parse failed',
      };
    }

    const module = parseResult.ast;
    const moduleName = module.name ?? 'unknown';

    // Find all Data and Enum declarations (for struct/enum field resolution)
    const dataDecls = new Map<string, FieldInfo[]>();
    const enumDecls = new Map<string, string[]>();
    for (const decl of module.decls) {
      if (decl.kind === 'Data') {
        const data = decl as Data;
        const fields: FieldInfo[] = data.fields.map((f) => {
          const fieldTypeKind = getTypeKind(f.type);
          const fieldTypeName = typeToString(f.type);
          return {
            name: f.name,
            type: fieldTypeName,
            typeKind: fieldTypeKind,
          };
        });
        dataDecls.set(data.name, fields);
      } else if (decl.kind === 'Enum') {
        const enumDecl = decl as Enum;
        enumDecls.set(enumDecl.name, [...enumDecl.variants]);
      }
    }

    // Find the target function
    const funcs = module.decls.filter((d: Declaration) => d.kind === 'Func') as Func[];
    if (funcs.length === 0) {
      return {
        success: false,
        error: 'No functions found in module',
      };
    }

    const targetFuncName = options?.functionName;
    const func = targetFuncName
      ? funcs.find((f: Func) => f.name === targetFuncName)
      : funcs[0];

    if (!func) {
      return {
        success: false,
        error: targetFuncName
          ? `Function '${targetFuncName}' not found`
          : 'No functions found in module',
      };
    }

    // Extract parameters
    const parameters: ParameterInfo[] = func.params.map((param, index) => {
      let typeName = typeToString(param.type);
      let typeKind = getTypeKind(param.type);
      let fields: FieldInfo[] | undefined;

      // Resolve struct/enum fields if applicable
      if (typeKind === 'struct' && enumDecls.has(typeName)) {
        // Type is actually an enum, not a struct
        typeKind = 'enum';
      } else if (typeKind === 'struct' && dataDecls.has(typeName)) {
        // Resolve struct fields, also resolving enum types within fields
        fields = dataDecls.get(typeName)!.map((f) => {
          if (f.typeKind === 'struct' && enumDecls.has(f.type)) {
            return { ...f, typeKind: 'enum' as TypeKind, enumVariants: enumDecls.get(f.type)! };
          }
          return f;
        });
      } else if (typeKind === 'primitive' && dataDecls.has(param.name)) {
        // 当参数类型为基本类型但参数名与 Data 定义匹配时，
        // 推断参数类型为该 Data 类型（支持中文无类型参数语法）
        typeName = param.name;
        typeKind = 'struct';
        fields = dataDecls.get(param.name);
      }

      const result: ParameterInfo = {
        name: param.name,
        type: typeName,
        typeKind,
        optional: false, // Parameters don't have optional field in AST
        position: index,
      };

      if (typeKind === 'enum' && enumDecls.has(typeName)) {
        result.enumVariants = enumDecls.get(typeName)!;
      }

      if (fields) {
        result.fields = fields;
      }

      return result;
    });

    return {
      success: true,
      moduleName,
      functionName: func.name,
      parameters,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
