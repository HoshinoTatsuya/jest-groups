import { GROUP_DEFAULTS } from '../constants/group-defaults.constant';
import type { CacheEntry } from '../types/cache-entry.type';
import type { Estimator } from '../types/estimator.type';
import type { FileStamp } from '../types/file-stamp.type';
import type { TestAssessment } from '../types/test-assessment.type';
import { isFresh } from './is-fresh';

/**
 * Число тестов файла для плана.
 *
 * - Отпечаток тот же, что перед прогоном, давшим факт, — факт.
 * - Файл изменён — большее из: факта; факта плюс прирост видимых тестов,
 *   умноженный на калибровку ЭТОГО файла (факт / оценка того же содержимого,
 *   не меньше 1); факта, выросшего пропорционально размеру файла. Прежде было
 *   «большее из факта и оценки × 1.25» — а оценка недооценивает файлы с
 *   таблицами в 2–20 раз: файл с фактом 130 и оценкой 11 после +25 тестов
 *   планировался в 130, и группа выходила 305 при потолке 300. Размер ловит
 *   рост, которого текст не показывает (строки таблицы из переменной).
 *   Записи без оценки (до 0.6.0) — прежнее «большее из факта и оценки × 1.25»
 *   плюс рост по размеру.
 * - Истории нет — оценка × 1.25; если текст числа не доказывает
 *   (`certain: false`), — `unknownWeight` (полная группа плана): такой файл
 *   идёт группой из одного, и его неизвестное число не выталкивает за потолок
 *   соседей.
 *
 * `assess` — оценка ТЕКУЩЕГО текста без запаса (для файла в нескольких
 * проектах — умноженная на число копий), вызывается только при нужде;
 * `estimator` — чем она получена. Оценка записи другим оценщиком —
 * как запись без оценки: калибровать ею нельзя.
 */
export const plannedTests = (
  entry: CacheEntry | undefined,
  stamp: FileStamp | null,
  assess: () => TestAssessment,
  unknownWeight: number,
  estimator: Estimator,
): number => {
  if (entry === undefined) {
    const now = assess();
    const estimated = Math.ceil(now.tests * GROUP_DEFAULTS.ESTIMATE_MARGIN);
    return now.certain ? estimated : Math.max(unknownWeight, estimated);
  }
  if (isFresh(entry, stamp)) {
    return entry.tests;
  }
  const now = assess();
  const candidates = [entry.tests];
  const estimate =
    entry.estimator === undefined || entry.estimator === estimator ? entry.estimate : undefined;
  if (estimate === undefined) {
    candidates.push(Math.ceil(now.tests * GROUP_DEFAULTS.ESTIMATE_MARGIN));
  } else if (now.tests > estimate) {
    const calibration = Math.max(1, entry.tests / estimate);
    candidates.push(entry.tests + Math.ceil((now.tests - estimate) * calibration));
  }
  if (stamp !== null && entry.size > 0 && stamp.size > entry.size) {
    candidates.push(Math.ceil((entry.tests * stamp.size) / entry.size));
  }
  return Math.max(...candidates);
};
