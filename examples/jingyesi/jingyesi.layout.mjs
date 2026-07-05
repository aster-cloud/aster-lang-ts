// 《静夜思》的 LayoutMap —— 同一段 canonical Aster 的两种排版。
//
// canonical（编译用的唯一真源，= jingyesi.aster）：诗句被语法结构约束，排成
//   床前 明月光。
//   疑是 地上霜，举头 望明月：
//     低头 思故乡。
// 其中 `。` 结束语句、`：` 开块、缩进表示块内 —— 这些结构 token 让诗形式必须迁就语法。
//
// display（给用户看的排版）：李白原诗的工整四句、每句一行、原诗标点。结构 token（冒号/
// 缩进/规范换行）在显示层被替换成原诗标点或隐藏，于是诗回到它本来的样子，而 canonical
// 一字未改、仍可编译运行。

/** @type {import('./layout-map.mjs').LayoutSpan[]} */
export const JINGYESI_LAYOUT = [
  // 第一句：内容「床前 明月光」——两视图都原样出现。
  { text: '床前 明月光' },
  // 句1↔句2 之间：canonical 用「。+换行」结束语句；display 用原诗的「，+换行」。
  { canonical: '。\n', display: '，\n' },

  { text: '疑是 地上霜' },
  // canonical 用「，」（同一 stmt 行内继续到 Rule 声明）；display 用原诗的「。+换行」断句。
  { canonical: '，', display: '。\n' },

  { text: '举头 望明月' },
  // canonical 用「：+换行+缩进」开块并进入块内；display 用原诗的「，+换行」。
  { canonical: '：\n  ', display: '，\n' },

  { text: '低头 思故乡' },
  // 末句收尾：canonical 用「。」；display 也用「。」（原诗末句句号）。
  { canonical: '。', display: '。' },
];
