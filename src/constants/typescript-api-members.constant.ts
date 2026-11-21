import { deepFreeze } from '../deep-freeze';

/**
 * Члены JS API TypeScript, которыми пользуется оценка по тексту
 * (`assessTests`): функции и числовые члены перечислений. Модуль без любого из
 * них — не API (так выглядит главный вход TypeScript 7). Что список полон,
 * держит спека: она читает обращения `ts.*` из исходника оценки.
 */
export const TYPESCRIPT_API_MEMBERS = {
  functions: [
    'createSourceFile',
    'forEachChild',
    'isArrayLiteralExpression',
    'isAsExpression',
    'isCallExpression',
    'isForInStatement',
    'isForOfStatement',
    'isForStatement',
    'isIdentifier',
    'isNonNullExpression',
    'isObjectLiteralExpression',
    'isParenthesizedExpression',
    'isPropertyAccessExpression',
    'isSatisfiesExpression',
    'isSpreadAssignment',
    'isSpreadElement',
    'isTaggedTemplateExpression',
    'isTypeAssertionExpression',
    'isVariableDeclaration',
    'isVariableDeclarationList',
    'isWhileStatement',
  ],
  enums: { ScriptTarget: ['Latest'], NodeFlags: ['Const'] },
} as const;

deepFreeze(TYPESCRIPT_API_MEMBERS);
