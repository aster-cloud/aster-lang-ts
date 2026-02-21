/**
 * @module config/lexicons/de-DE
 *
 * 德语（德国）词法表，为 Aster CNL 提供正式德语皮肤。
 * 关键词使用标准德语表达，沿用英文标点，保留大小写以强调句首。
 */

import { SemanticTokenKind } from '../token-kind.js';
import type { Lexicon } from './types.js';

/**
 * 德语（德国）词法表实现。
 */
export const DE_DE: Lexicon = {
  id: 'de-DE',
  name: 'Deutsch',
  direction: 'ltr',

  keywords: {
    // 模块声明
    [SemanticTokenKind.MODULE_DECL]: 'Modul',
    [SemanticTokenKind.IMPORT]: 'verwende',
    [SemanticTokenKind.IMPORT_ALIAS]: 'als',

    // 类型定义
    [SemanticTokenKind.TYPE_DEF]: 'Definiere',
    [SemanticTokenKind.TYPE_WITH]: 'mit',
    [SemanticTokenKind.TYPE_HAS]: 'hat',
    [SemanticTokenKind.TYPE_ONE_OF]: 'als eines von',

    // 函数定义
    [SemanticTokenKind.FUNC_TO]: 'Regel',
    [SemanticTokenKind.FUNC_GIVEN]: 'gegeben',
    [SemanticTokenKind.FUNC_PRODUCE]: 'liefert',
    [SemanticTokenKind.FUNC_PERFORMS]: 'führt aus',

    // 控制流
    [SemanticTokenKind.IF]: 'wenn',
    [SemanticTokenKind.OTHERWISE]: 'sonst',
    [SemanticTokenKind.MATCH]: 'prüfe',
    [SemanticTokenKind.WHEN]: 'bei',
    [SemanticTokenKind.RETURN]: 'gib zurück',
    [SemanticTokenKind.RESULT_IS]: 'Ergebnis ist',
    [SemanticTokenKind.FOR_EACH]: 'für jedes',
    [SemanticTokenKind.IN]: 'in',

    // 变量操作
    [SemanticTokenKind.LET]: 'sei',
    [SemanticTokenKind.BE]: 'gleich',
    [SemanticTokenKind.SET]: 'setze',
    [SemanticTokenKind.TO_WORD]: 'auf',

    // 布尔运算
    [SemanticTokenKind.OR]: 'oder',
    [SemanticTokenKind.AND]: 'und',
    [SemanticTokenKind.NOT]: 'nicht',

    // 算术运算
    [SemanticTokenKind.PLUS]: 'plus',
    [SemanticTokenKind.MINUS_WORD]: 'minus',
    [SemanticTokenKind.TIMES]: 'mal',
    [SemanticTokenKind.DIVIDED_BY]: 'geteilt durch',

    // 比较运算
    [SemanticTokenKind.LESS_THAN]: 'kleiner als',
    [SemanticTokenKind.GREATER_THAN]: 'größer als',
    [SemanticTokenKind.EQUALS_TO]: 'entspricht',
    [SemanticTokenKind.IS]: 'ist',
    [SemanticTokenKind.UNDER]: 'unter',
    [SemanticTokenKind.OVER]: 'ueber',
    [SemanticTokenKind.MORE_THAN]: 'mehr als',

    // 类型构造
    [SemanticTokenKind.MAYBE]: 'vielleicht',
    [SemanticTokenKind.OPTION_OF]: 'Option aus',
    [SemanticTokenKind.RESULT_OF]: 'Ergebnis aus',
    [SemanticTokenKind.OK_OF]: 'ok von',
    [SemanticTokenKind.ERR_OF]: 'Fehler von',
    [SemanticTokenKind.SOME_OF]: 'einige von',
    [SemanticTokenKind.NONE]: 'keines',

    // 字面量
    [SemanticTokenKind.TRUE]: 'wahr',
    [SemanticTokenKind.FALSE]: 'falsch',
    [SemanticTokenKind.NULL]: 'null',

    // 基础类型
    [SemanticTokenKind.TEXT]: 'Text',
    [SemanticTokenKind.INT_TYPE]: 'Ganzzahl',
    [SemanticTokenKind.FLOAT_TYPE]: 'Dezimal',
    [SemanticTokenKind.BOOL_TYPE]: 'Boolesch',

    // 效果声明
    [SemanticTokenKind.IO]: 'IO',
    [SemanticTokenKind.CPU]: 'CPU',

    // 工作流
    [SemanticTokenKind.WORKFLOW]: 'Arbeitsablauf',
    [SemanticTokenKind.STEP]: 'Schritt',
    [SemanticTokenKind.DEPENDS]: 'hängt ab',
    [SemanticTokenKind.ON]: 'von',
    [SemanticTokenKind.COMPENSATE]: 'kompensiere',
    [SemanticTokenKind.RETRY]: 'wiederhole',
    [SemanticTokenKind.TIMEOUT]: 'Zeitlimit',
    [SemanticTokenKind.MAX_ATTEMPTS]: 'maximale Versuche',
    [SemanticTokenKind.BACKOFF]: 'Wartezeit',

    // 异步操作
    [SemanticTokenKind.WITHIN]: 'innerhalb',
    [SemanticTokenKind.SCOPE]: 'Bereich',
    [SemanticTokenKind.START]: 'starte',
    [SemanticTokenKind.ASYNC]: 'asynchron',
    [SemanticTokenKind.AWAIT]: 'warte',
    [SemanticTokenKind.WAIT_FOR]: 'warte auf',

    // 约束声明
    [SemanticTokenKind.REQUIRED]: 'erforderlich',
    [SemanticTokenKind.BETWEEN]: 'zwischen',
    [SemanticTokenKind.AT_LEAST]: 'mindestens',
    [SemanticTokenKind.AT_MOST]: 'höchstens',
    [SemanticTokenKind.MATCHING]: 'passend zu',
    [SemanticTokenKind.PATTERN]: 'Muster',
  },

  punctuation: {
    statementEnd: '.',
    listSeparator: ',',
    enumSeparator: ',',
    blockStart: ':',
    stringQuotes: {
      open: '"',
      close: '"',
    },
  },

  canonicalization: {
    fullWidthToHalf: false, // 德语沿用半角字符
    whitespaceMode: 'english', // 德语以空格分词
    removeArticles: true, // 移除常见冠词以降低噪音
    articles: ['der', 'die', 'das', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines'],
    allowedDuplicates: [
      [SemanticTokenKind.UNDER, SemanticTokenKind.LESS_THAN], // unter / kleiner als → "<"
      [SemanticTokenKind.OVER, SemanticTokenKind.GREATER_THAN, SemanticTokenKind.MORE_THAN], // ueber / größer als / mehr als → ">"
    ],
    // ASCII-ized umlaut normalization: convert common ASCII alternatives to proper umlauts
    // This allows users to type "groesser" instead of "größer", "zurueck" instead of "zurück"
    customRules: [
      // Step 1: Handle oe -> ö first (before ss -> ß rules that might depend on it)
      { name: 'oe-to-ö', pattern: 'oe', replacement: 'ö' },
      // Step 2: Handle ue -> ü (zurueck -> zurück, fuehrt -> führt, pruefe -> prüfe)
      { name: 'ue-to-ü', pattern: 'ue', replacement: 'ü' },
      // Step 3: Handle ae -> ä (Minderjaehriger -> Minderjähriger)
      { name: 'ae-to-ä', pattern: 'ae', replacement: 'ä' },
      // Step 4: Handle ss -> ß in specific keyword contexts
      // Note: After step 1, "groesser" becomes "grösser", need to convert "grösser" -> "größer"
      { name: 'ss-to-ß-grösser', pattern: '\\bgrösser\\b', replacement: 'größer' },
      { name: 'ss-to-ß-gross', pattern: '\\bgross\\b', replacement: 'groß' },
      { name: 'ss-to-ß-höchstens', pattern: '\\bhöchstens\\b', replacement: 'höchstens' }, // already correct, no change needed
    ],
  },

  messages: {
    unexpectedToken: 'Unerwartetes Symbol: {token}',
    expectedKeyword: "Erwartetes Schlüsselwort '{keyword}'",
    undefinedVariable: 'Nicht definierte Variable: {name}',
    typeMismatch: 'Typkonflikt: erwartet {expected}, erhalten {actual}',
    unterminatedString: 'Nicht abgeschlossener Zeichenkettenliteral',
    invalidIndentation: 'Ungültige Einrückung: muss ein Vielfaches von 2 Leerzeichen sein',
  },
};
