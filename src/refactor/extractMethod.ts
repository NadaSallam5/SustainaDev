export function buildExtractPatch(source: string, selection: { from: number; to: number }) {
  const src = source.split(/\r?\n/);
  const extracted = src.slice(selection.from - 1, selection.to).join('\n');
  const callName = 'extractedHelper';

  const newMethod = [
    `    private void ${callName}() {`,
    extracted.replace(/^/gm, '        '),
    '    }',
    ''
  ].join('\n');

  const replaced = src.slice(0);
  replaced.splice(selection.from - 1, selection.to - selection.from + 1, `        ${callName}();`);

  return { preview: replaced.join('\n'), newMethod, callName };
}
