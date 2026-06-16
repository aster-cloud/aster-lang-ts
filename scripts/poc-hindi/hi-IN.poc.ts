/**
 * POC — Hindi (Devanagari) lexicon for aster-lang-ts.
 *
 * Phase 0 of ADR 0017 ("Adding a fourth language"). 手写(非 generate-lexicons.ts
 * 生成)的一次性 lexicon,只为验证最大风险: Devanagari 非拉丁脚本能否被现有
 * lexer/canonicalizer/parser lex → parse → typecheck。**不进生产生成管线、不注册
 * 进 registry、不碰其他 6 仓**。验证通过=Phase 0 成功,再走 Phase 1(Java 引擎+parity)。
 *
 * 翻译原则(POC 阶段,保守):
 *   - keyword 用 Devanagari,选简洁无歧义、不易撞标识符的词。
 *   - 保持 zh/de 那样的"keyword 翻译"策略——不做激进 SOV 语序重排(那是 Phase 1
 *     transformer 的事)。POC 只证脚本可处理。
 *   - statementEnd 用 Devanagari danda「।」。direction ltr。whitespaceMode english
 *     (Devanagari 词间有空格,验证可复用 ENGLISH 模式,无需新 whitespaceMode)。
 */
import { SemanticTokenKind } from '../../src/config/token-kind.js';
import type { Lexicon } from '../../src/config/lexicons/types.js';

export const HI_IN_POC: Lexicon = {
  id: 'hi-IN',
  name: 'हिन्दी',
  direction: 'ltr',

  keywords: {
    [SemanticTokenKind.MODULE_DECL]: 'मॉड्यूल',
    [SemanticTokenKind.IMPORT]: 'उपयोग',
    [SemanticTokenKind.IMPORT_ALIAS]: 'रूप में',
    [SemanticTokenKind.IMPORT_VERSION]: 'संस्करण',
    [SemanticTokenKind.TYPE_DEF]: 'परिभाषित',
    [SemanticTokenKind.TYPE_WITH]: 'सहित',
    [SemanticTokenKind.TYPE_HAS]: 'रखता है',
    [SemanticTokenKind.TYPE_ONE_OF]: 'इनमें से एक',
    [SemanticTokenKind.FUNC_TO]: 'नियम',
    [SemanticTokenKind.FUNC_GIVEN]: 'दिया गया',
    [SemanticTokenKind.FUNC_PRODUCE]: 'उत्पन्न',
    [SemanticTokenKind.FUNC_PERFORMS]: 'यह करता है',
    [SemanticTokenKind.IF]: 'यदि',
    [SemanticTokenKind.OTHERWISE]: 'अन्यथा',
    [SemanticTokenKind.MATCH]: 'मिलान',
    [SemanticTokenKind.WHEN]: 'जब',
    [SemanticTokenKind.RETURN]: 'लौटाएं',
    [SemanticTokenKind.RESULT_IS]: 'परिणाम है',
    [SemanticTokenKind.FOR_EACH]: 'प्रत्येक',
    [SemanticTokenKind.IN]: 'में',
    [SemanticTokenKind.LET]: 'मानें',
    [SemanticTokenKind.BE]: 'हो',
    [SemanticTokenKind.SET]: 'निर्धारित',
    [SemanticTokenKind.TO_WORD]: 'को',
    [SemanticTokenKind.OR]: 'या',
    [SemanticTokenKind.AND]: 'और',
    [SemanticTokenKind.NOT]: 'नहीं',
    [SemanticTokenKind.PLUS]: 'जोड़',
    [SemanticTokenKind.MINUS_WORD]: 'घटा',
    [SemanticTokenKind.TIMES]: 'गुणा',
    [SemanticTokenKind.DIVIDED_BY]: 'भाग',
    [SemanticTokenKind.INTEGER_DIVIDED_BY]: 'पूर्णांक भाग',
    [SemanticTokenKind.MODULO]: 'शेषफल',
    [SemanticTokenKind.LESS_THAN]: 'से कम',
    [SemanticTokenKind.GREATER_THAN]: 'से अधिक',
    [SemanticTokenKind.EQUALS_TO]: 'बराबर',
    [SemanticTokenKind.IS]: 'है',
    [SemanticTokenKind.UNDER]: 'नीचे',
    [SemanticTokenKind.OVER]: 'ऊपर',
    [SemanticTokenKind.MORE_THAN]: 'से ज्यादा',
    [SemanticTokenKind.MAYBE]: 'शायद',
    [SemanticTokenKind.OPTION_OF]: 'विकल्प',
    [SemanticTokenKind.RESULT_OF]: 'परिणाम का',
    [SemanticTokenKind.OK_OF]: 'सही',
    [SemanticTokenKind.ERR_OF]: 'त्रुटि',
    [SemanticTokenKind.SOME_OF]: 'कुछ',
    [SemanticTokenKind.NONE]: 'कोई नहीं',
    [SemanticTokenKind.TRUE]: 'सत्य',
    [SemanticTokenKind.FALSE]: 'असत्य',
    [SemanticTokenKind.NULL]: 'शून्य',
    [SemanticTokenKind.TEXT]: 'पाठ',
    [SemanticTokenKind.INT_TYPE]: 'पूर्णांक',
    [SemanticTokenKind.FLOAT_TYPE]: 'दशमलव',
    [SemanticTokenKind.BOOL_TYPE]: 'बूलियन',
    [SemanticTokenKind.IO]: 'आईओ',
    [SemanticTokenKind.CPU]: 'सीपीयू',
    [SemanticTokenKind.WORKFLOW]: 'कार्यप्रवाह',
    [SemanticTokenKind.STEP]: 'चरण',
    [SemanticTokenKind.DEPENDS]: 'निर्भर',
    [SemanticTokenKind.ON]: 'पर',
    [SemanticTokenKind.COMPENSATE]: 'क्षतिपूर्ति',
    [SemanticTokenKind.RETRY]: 'पुनः प्रयास',
    [SemanticTokenKind.TIMEOUT]: 'समय समाप्ति',
    [SemanticTokenKind.MAX_ATTEMPTS]: 'अधिकतम प्रयास',
    [SemanticTokenKind.BACKOFF]: 'प्रतीक्षा',
    [SemanticTokenKind.WITHIN]: 'भीतर',
    [SemanticTokenKind.SCOPE]: 'क्षेत्र',
    [SemanticTokenKind.START]: 'आरंभ',
    [SemanticTokenKind.ASYNC]: 'अतुल्यकालिक',
    [SemanticTokenKind.AWAIT]: 'प्रतीक्षा करें',
    [SemanticTokenKind.WAIT_FOR]: 'इंतजार',
    [SemanticTokenKind.REQUIRED]: 'आवश्यक',
    [SemanticTokenKind.BETWEEN]: 'के बीच',
    [SemanticTokenKind.AT_LEAST]: 'कम से कम',
    [SemanticTokenKind.AT_MOST]: 'अधिक से अधिक',
    [SemanticTokenKind.MATCHING]: 'मिलते',
    [SemanticTokenKind.PATTERN]: 'पैटर्न',
  },

  punctuation: {
    statementEnd: '।', // Devanagari danda
    listSeparator: ',',
    enumSeparator: ',',
    blockStart: ':',
    stringQuotes: {
      open: '"',
      close: '"',
    },
  },

  canonicalization: {
    fullWidthToHalf: false,
    // Devanagari 词间有空格 → 复用 english 模式（验证 ADR 0017 的假设：
    // 非拉丁但有空格的脚本不需要新 whitespaceMode）。
    whitespaceMode: 'english',
    // Hindi 无英语式冠词 a/an/the → 不剥离冠词（避免误删 Devanagari 短词）。
    removeArticles: false,
    allowedDuplicates: [
      [SemanticTokenKind.FUNC_TO, SemanticTokenKind.TO_WORD],
      [SemanticTokenKind.UNDER, SemanticTokenKind.LESS_THAN],
      [SemanticTokenKind.OVER, SemanticTokenKind.GREATER_THAN, SemanticTokenKind.MORE_THAN],
    ],
  },

  messages: {
    unexpectedToken: 'अप्रत्याशित टोकन: {token}',
    expectedKeyword: 'अपेक्षित कीवर्ड: {keyword}',
    undefinedVariable: 'अपरिभाषित चर: {name}',
    typeMismatch: 'प्रकार बेमेल: अपेक्षित {expected}, मिला {actual}',
    unterminatedString: 'अधूरा स्ट्रिंग शाब्दिक',
    invalidIndentation: 'अमान्य इंडेंटेशन: 2 स्थानों के गुणकों में होना चाहिए',
  },
};
