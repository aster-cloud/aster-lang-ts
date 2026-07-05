// 《斑点带子案》的 LayoutMap —— 同一段 canonical Aster 的两种排版。
//
// canonical（编译真源，= sherlock.aster）：侦探方言别名（探案笔记/推断/已知/若/凶手即/且）
// 已让它读得像推理，但仍夹着规范的 `then`/`else`/`：` 和缩进（这些是 inline-if 的语法必需，
// 且 then/else 非 SemanticTokenKind 无法别名）。
//
// display（给读者看的排版）：福尔摩斯的推理独白，把 `then` 渲染成「——则真凶必是」、`else 若`
// 渲染成「纵此不足为凭，然」等推理连接词，缩进/冒号隐去，成为连贯的推理段落。
// canonical 一字未改、仍编译运行输出真凶。

/** @type {import('../jingyesi/layout-map.mjs').LayoutSpan[]} */
export const SHERLOCK_LAYOUT = [
  // 案卷标题。「探案笔记」= MODULE_DECL 别名（canonical 结构词），display 侧渲染成引导语。
  // 结构词的 canonical 值原样保留（保证 toCanonical===.aster），display 值自由美化。
  { canonical: '探案笔记 ', display: '《' },
  { text: '斑点带子案' },
  { canonical: '。\n\n', display: '》\n\n' },

  // 「推断 揪出真凶 已知」= FUNC_TO/FUNC_GIVEN 别名（结构词），display 渲染成推理开场白。
  { canonical: '推断 揪出真凶 已知 ', display: '要揪出真凶，已知这几处疑点：' },
  // 三条线索（内容 span，两视图原样）。
  { text: '铃绳通风口' },
  { canonical: '，', display: '、' },
  { text: '保险箱藏毒蛇' },
  { canonical: '，', display: '、' },
  { text: '唯继父可入密室' },
  { canonical: '，', display: '、' },
  { text: '姐姐临终呼斑点带子' },
  // 「产出：换行缩进」→ 推理正式开始。
  { canonical: '，产出：\n  ', display: '。\n\n  ' },

  // 第一条推断：铃绳通风口 且 保险箱藏毒蛇 → 继父。
  { text: '若 铃绳通风口 且 保险箱藏毒蛇' },
  { canonical: ' then 凶手即 ', display: '——则真凶必是' },
  { text: '"继父罗伊洛特"' },

  // 第二条推断（else if）：唯继父可入密室 → 继父。
  { canonical: '\n  else 若 ', display: '。\n  纵此不足为凭，然' },
  { text: '唯继父可入密室' },
  { canonical: ' then 凶手即 ', display: '，亦足以断定凶手乃' },
  { text: '"继父罗伊洛特"' },

  // 第三条推断（else if）：仅有姐姐临终呼喊「斑点带子」这一线索 → 尚需查证豢养毒蛇者。
  { canonical: '\n  else 若 ', display: '。\n  假使仅凭' },
  { text: '姐姐临终呼斑点带子' },
  { canonical: ' then 凶手即 ', display: '一句遗言，则只能锁定' },
  { text: '"尚需查证：谁豢养毒蛇"' },

  // 兜底（else）。
  { canonical: '\n  else 凶手即 ', display: '。\n  否则，只得承认' },
  { text: '"疑点未清，尚难定论"' },
  { canonical: '。', display: '。' },
];
