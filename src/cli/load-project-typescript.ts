import { TYPESCRIPT6_PACKAGE } from '../constants/typescript6-package.constant';
import { isTypescriptApi } from '../is-typescript-api';
import type { LoadedModule } from '../types/loaded-module.type';
import type { ProjectTypescript } from '../types/project-typescript.type';
import { loadProjectModule } from './load-project-module';

/**
 * TypeScript ПРОЕКТА, а не библиотеки: версия парсера та же, что у кода спек.
 *
 * Порядок: `typescript` проекта, если у него есть JS API (5.x, 6.x); иначе
 * `@typescript/typescript6` проекта (TypeScript 7 — компилятор на Go, его
 * главный вход даёт только `{ version }`, прежний API — отдельным пакетом);
 * иначе регулярка, и об этом строка журнала. Прежде TypeScript 7 проходил как
 * API, и первый же разбор ронял весь раннер («reading 'Latest'»).
 *
 * Оба ищутся от `cwd` (в монорепозитории — и выше по каталогам, как у Node),
 * но не от места библиотеки: иначе план зависел бы от того, как менеджер
 * пакетов разложил её зависимости.
 */
export const loadProjectTypescript = (cwd: string): ProjectTypescript => {
  const versionOf = (module: unknown): string => {
    const version = (module as { version?: unknown } | null)?.version;
    return typeof version === 'string' ? version : 'неизвестной версии';
  };
  const describe = (loaded: LoadedModule, missing: string): string =>
    loaded.kind === 'missing'
      ? missing
      : loaded.kind === 'failed'
        ? `не загрузился (${loaded.message})`
        : `${versionOf(loaded.module)} без JS API`;

  const project = loadProjectModule(cwd, 'typescript');
  if (project.kind === 'loaded' && isTypescriptApi(project.module)) {
    return { typescript: project.module, note: null };
  }
  const reason = project.kind === 'missing' ? null : `TypeScript проекта ${describe(project, '')}`;
  const fallback = loadProjectModule(cwd, TYPESCRIPT6_PACKAGE);
  if (fallback.kind === 'loaded' && isTypescriptApi(fallback.module)) {
    return {
      typescript: fallback.module,
      note:
        reason === null ? null : `${reason}: оценка по ${TYPESCRIPT6_PACKAGE} ${versionOf(fallback.module)}`,
    };
  }
  // Проект без TypeScript и без запасного пакета — обычный JS-проект: молча регулярка.
  if (reason === null && fallback.kind === 'missing') {
    return { typescript: null, note: null };
  }
  return {
    typescript: null,
    note:
      `${reason ?? 'TypeScript в проекте нет'}, ${TYPESCRIPT6_PACKAGE} ${describe(fallback, 'не установлен')}: ` +
      'оценка регуляркой — таблицы .each и циклы она не считает, такие файлы до первого факта идут ' +
      `группой из одного. Точнее: ${TYPESCRIPT6_PACKAGE} в devDependencies проекта`,
  };
};
