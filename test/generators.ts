/** Medium/Large 项目生成器工具集 */
export type RecordTemplate = { base: string; fields: { name: string; type: string }[] };
export type SumTemplate = { base: string; variants: string[] };

export function generateLargeProgram(size: number): string {
  const lines = [
    'Module benchmark.test.',
    '',
    'Define User has id: Text and name: Text and email: Text.',
    'Define Status as one of Active or Inactive or Pending.',
    '',
  ];

  for (let i = 0; i < size; i++) {
    lines.push(`Rule process${i} given user: User, produce Status:`);
    lines.push(`  Let id be user.id.`);
    lines.push(`  Let name be user.name.`);
    lines.push(`  If name,:`);
    lines.push(`    Return Active.`);
    lines.push(`  Return Inactive.`);
    lines.push('');
  }

  return lines.join('\n');
}

/** 生成Medium规模项目（30-50模块，约3000-5000行） */
export function generateMediumProject(moduleCount = 40, baseSeed = 42): Map<string, string> {
  const modules = new Map<string, string>();
  modules.set('benchmark.medium.common', generateCommonModule());

  const random = createSeededRandom(baseSeed);
  for (let i = 1; i < moduleCount; i++) {
    const moduleName = `benchmark.medium.module${i}`;
    const needsImport = random() < 0.3;
    modules.set(moduleName, generateBusinessModule(moduleName, baseSeed + i * 17, needsImport));
  }

  return modules;
}

/** 生成通用模块，提供共享类型与函数 */
export function generateCommonModule(): string {
  const lines = [
    'Module benchmark.medium.common.',
    '',
    'Define LogLevel as one of Info or Warn or Error or Debug.',
    'Define HttpMethod as one of Get or Post or Put or Delete.',
    '',
    'Define RequestContext has requestId: Text and path: Text and method: Text and retries: Number.',
    'Define ResponseContext has status: Number and payload: Text and success: Boolean.',
    '',
    'Rule buildRequestId given prefix: Text and id: Number, produce Text:',
    '  Let base be prefix.',
    '  If base,:',
    '    Return base.',
    '  Return "req-default".',
    '',
    'Rule defaultLogLevel, produce LogLevel:',
    '  Return Info.',
    '',
    'Rule ensureSuccess given response: ResponseContext, produce Boolean:',
    '  Let flag be response.success.',
    '  If flag,:',
    '    Return true.',
    '  Return false.',
    '',
    'Rule renderPath given ctx: RequestContext, produce Text:',
    '  Let path be ctx.path.',
    '  If path,:',
    '    Return path.',
    '  Return "/".',
    '',
    'Rule emitLog given message: Text and level: LogLevel, produce Text. It performs io:',
    '  Let text be message.',
    '  If text,:',
    '    Return text.',
    '  Return "log".',
    '',
  ];

  return lines.join('\n');
}

/** 生成业务模块，控制模块内类型与函数数量 */
export function generateBusinessModule(name: string, seed: number, needsImport: boolean): string {
  const rand = createSeededRandom(seed);
  const recordTemplates = getRecordTemplates();
  const sumTemplates = getSumTemplates();

  const records = [] as { name: string; fields: { name: string; type: string }[] }[];
  const sums = [] as { name: string; variants: string[] }[];

  const lines: string[] = [];
  lines.push(`Module ${name}.`);
  lines.push('');

  if (needsImport) {
    lines.push('Use benchmark.medium.common.');
    lines.push('');
  }

  const recordCount = 2 + Math.floor(rand() * 2);
  const sumCount = 1 + Math.floor(rand() * 2);

  for (let i = 0; i < recordCount; i++) {
    const template = recordTemplates[(seed + i) % recordTemplates.length]!;
    const typeName = `${template.base}${seed}${i}`;
    const fieldParts = template.fields.map(field => `${field.name}: ${field.type}`);
    lines.push(`Define ${typeName} has ${fieldParts.join(' and ')}.`);
    lines.push('');
    records.push({ name: typeName, fields: template.fields });
  }

  for (let i = 0; i < sumCount; i++) {
    const template = sumTemplates[(seed + i * 3) % sumTemplates.length]!;
    const typeName = `${template.base}${seed}${i}`;
    lines.push(`Define ${typeName} as one of ${template.variants.join(' or ')}.`);
    lines.push('');
    sums.push({ name: typeName, variants: template.variants });
  }

  const functionCount = 8 + Math.floor(rand() * 5);
  let effectCounter = 0;

  for (let i = 0; i < functionCount; i++) {
    const effectful = i % 10 === 0;
    if (effectful) {
      effectCounter++;
      lines.push(...generateEffectfulFunction(seed, i));
    } else {
      lines.push(...generateRoutineFunction(records, sums, seed, i));
    }
    lines.push('');
  }

  if (effectCounter === 0 && functionCount > 0) {
    lines.splice(lines.length - 1, 0, ...generateEffectfulFunction(seed, functionCount));
    lines.push('');
  }

  return lines.join('\n');
}

/** 生成带效果声明的函数，确保比例约为10% */
export function generateEffectfulFunction(seed: number, fnIndex: number): string[] {
  const functionName = `fetch${seed}${fnIndex}`;
  return [
    `Rule ${functionName} given resource: Text, produce Text. It performs io:`,
    '  Let value be resource.',
    '  If value,:',
    '    Return value.',
    '  Return "unavailable".',
  ];
}

/** 生成常规函数，实现控制流与绑定多样性 */
export function generateRoutineFunction(
  records: { name: string; fields: { name: string; type: string }[] }[],
  sums: { name: string; variants: string[] }[],
  seed: number,
  fnIndex: number,
): string[] {
  const parts: string[] = [];

  if (records.length === 0) {
    records.push({
      name: `TempRecord${seed}${fnIndex}`,
      fields: [
        { name: 'id', type: 'Text' },
        { name: 'name', type: 'Text' },
        { name: 'flag', type: 'Boolean' },
      ],
    });
  }
  if (sums.length === 0) {
    sums.push({
      name: `TempSum${seed}${fnIndex}`,
      variants: ['Alpha', 'Beta', 'Gamma'],
    });
  }

  const recordA = records[fnIndex % records.length]!;
  const recordB = records[(fnIndex + 1) % records.length]!;
  const sum = sums[fnIndex % sums.length]!;
  const primaryVariant = sum.variants[fnIndex % sum.variants.length] ?? sum.variants[0] ?? 'Alpha';
  const secondaryVariant = sum.variants[(fnIndex + 1) % sum.variants.length] ?? primaryVariant;
  const textFieldA = getTextField(recordA);
  const textFieldB = getTextField(recordB);
  const booleanFieldA = getBooleanField(recordA);

  const signatureVariants = fnIndex % 4;
  switch (signatureVariants) {
    case 0: {
      const functionName = `format${seed}${fnIndex}`;
      parts.push(
        `Rule ${functionName} given item: ${recordA.name}, produce Text:`,
        `  Let value be item.${textFieldA}.`,
        '  If value,:',
        '    Return value.',
        '  Return "unknown".',
      );
      return parts;
    }
    case 1: {
      const functionName = `evaluate${seed}${fnIndex}`;
      parts.push(
        `Rule ${functionName} given item: ${recordA.name} and status: ${sum.name}, produce ${sum.name}:`,
        `  Let active be item.${booleanFieldA}.`,
        '  If active,:',
        '    Let current be status.',
        '    If current,:',
        '      Return current.',
        `    Return ${primaryVariant}.`,
        `  Return ${secondaryVariant}.`,
      );
      return parts;
    }
    case 2: {
      const functionName = `compare${seed}${fnIndex}`;
      parts.push(
        `Rule ${functionName} given left: ${recordA.name} and right: ${recordB.name}, produce Boolean:`,
        `  Let first be left.${textFieldA}.`,
        `  Let second be right.${textFieldB}.`,
        '  If first,:',
        '    If second,:',
        '      Return true.',
        '  Return false.',
      );
      return parts;
    }
    default: {
      const functionName = `current${seed}${fnIndex}`;
      parts.push(
        `Rule ${functionName}, produce Text:`,
        `  Let mark be "${recordA.name}-${fnIndex}".`,
        '  If mark,:',
        `    Return mark.`,
        '  Return "constant".',
      );
      return parts;
    }
  }
}

/** 提供可复用的记录类型模板 */
export function getRecordTemplates(): RecordTemplate[] {
  return [
    {
      base: 'User',
      fields: [
        { name: 'id', type: 'Text' },
        { name: 'name', type: 'Text' },
        { name: 'email', type: 'Text' },
        { name: 'isActive', type: 'Boolean' },
      ],
    },
    {
      base: 'Config',
      fields: [
        { name: 'endpoint', type: 'Text' },
        { name: 'timeout', type: 'Number' },
        { name: 'retries', type: 'Number' },
        { name: 'enabled', type: 'Boolean' },
      ],
    },
    {
      base: 'Request',
      fields: [
        { name: 'path', type: 'Text' },
        { name: 'method', type: 'Text' },
        { name: 'payload', type: 'Text' },
        { name: 'attempts', type: 'Number' },
      ],
    },
    {
      base: 'Profile',
      fields: [
        { name: 'nickname', type: 'Text' },
        { name: 'createdAt', type: 'Text' },
        { name: 'score', type: 'Number' },
        { name: 'verified', type: 'Boolean' },
      ],
    },
  ];
}

/** 提供可复用的和类型模板 */
export function getSumTemplates(): SumTemplate[] {
  return [
    { base: 'Status', variants: ['Ready', 'Busy', 'Error', 'Pending'] },
    { base: 'ErrorKind', variants: ['Network', 'Timeout', 'Invalid', 'Unknown'] },
    { base: 'ResultFlag', variants: ['Ok', 'Retry', 'Fail'] },
    { base: 'Mode', variants: ['Live', 'Test', 'Maintenance'] },
  ];
}

/** 返回记录类型中的文本字段名称 */
export function getTextField(record: { fields: { name: string; type: string }[] }): string {
  const item = record.fields.find(field => field.type === 'Text');
  return item ? item.name : record.fields[0]?.name ?? 'id';
}

/** 返回记录类型中的布尔字段名称 */
export function getBooleanField(record: { fields: { name: string; type: string }[] }): string {
  const item = record.fields.find(field => field.type === 'Boolean');
  return item ? item.name : record.fields[record.fields.length - 1]?.name ?? 'isActive';
}

/** 构建可复用的确定性随机数生成器 */
export function createSeededRandom(seed: number): () => number {
  let state = Math.abs(seed) % 233280;
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}
