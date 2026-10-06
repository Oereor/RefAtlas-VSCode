import { findNodeAtOffset, parseTree, type ParseError } from 'jsonc-parser';

export const SOURCE_PATH = 'ExcelOutput/AvatarConfig.json';
export const TARGET_PATH = 'TextMap/TextMapCHS.json';

export interface HashReference {
  readonly hash: string;
  readonly offset: number;
  readonly length: number;
}

/** AST values are deliberately never used as reference identities. */
export function identifyAvatarNameHash(
  text: string, offset: number, relativePath: string,
): HashReference | undefined {
  if (relativePath !== SOURCE_PATH || offset < 0 || offset >= text.length) return;
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false });
  if (!root || errors.length || root.type !== 'array') return;
  const number = findNodeAtOffset(root, offset, false);
  if (!number || number.type !== 'number' || offset >= number.offset + number.length) return;
  const hashProperty = number.parent;
  const avatarName = hashProperty?.parent;
  const nameProperty = avatarName?.parent;
  const record = nameProperty?.parent;
  if (hashProperty?.type !== 'property' || hashProperty.children?.[0]?.value !== 'Hash'
    || avatarName?.type !== 'object' || nameProperty?.type !== 'property'
    || nameProperty.children?.[0]?.value !== 'AvatarName'
    || record?.type !== 'object' || record.parent !== root) return;
  return { hash: text.slice(number.offset, number.offset + number.length), offset: number.offset, length: number.length };
}
