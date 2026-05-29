import {
  ONE_OPEN_REQUEST_INDEX,
  assertOpenRequestIndexPresent,
} from './open-request-index';

describe('assertOpenRequestIndexPresent', () => {
  it('passes when the partial index is present in the list', () => {
    expect(() =>
      assertOpenRequestIndexPresent(['some_other_idx', ONE_OPEN_REQUEST_INDEX]),
    ).not.toThrow();
  });

  it('throws loudly when the partial index is missing (drift)', () => {
    expect(() => assertOpenRequestIndexPresent(['some_other_idx'])).toThrow(
      /missing/i,
    );
  });

  it('names the index in the error so the operator knows what to restore', () => {
    expect(() => assertOpenRequestIndexPresent([])).toThrow(
      ONE_OPEN_REQUEST_INDEX,
    );
  });
});
