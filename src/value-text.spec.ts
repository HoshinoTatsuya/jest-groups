import { valueText } from './value-text';

/** `valueText` — текст любого брошенного значения без собственного броска. */
describe('valueText', () => {
  it('значение без прототипа — тег объекта', () => {
    expect(valueText(Object.create(null))).toBe('[object Object]');
  });

  it('бросающий toString — тег объекта', () => {
    const value = {
      toString: (): string => {
        throw new Error('toString');
      },
    };
    expect(valueText(value)).toBe('[object Object]');
  });

  it('бросающий Symbol.toPrimitive — строковый message, если он есть', () => {
    const value = {
      message: 'исходный отказ',
      [Symbol.toPrimitive]: (): string => {
        throw new Error('toPrimitive');
      },
    };
    expect(valueText(value)).toBe('исходный отказ');
  });

  it('ошибка с бросающим геттером message — константа, а не бросок', () => {
    const error = new Error('x');
    Object.defineProperty(error, 'message', {
      get: (): string => {
        throw new Error('getter');
      },
    });
    expect(valueText(error)).toBe('[значение без текста]');
  });

  it('обычная ошибка — «Имя: сообщение»', () => {
    expect(valueText(new TypeError('сломано'))).toBe('TypeError: сломано');
  });

  it('строка и undefined — как String()', () => {
    expect(valueText('SIGTERM')).toBe('SIGTERM');
    expect(valueText(undefined)).toBe('undefined');
  });
});
