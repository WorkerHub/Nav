/**
 * 手控 Promise：用它在「请求还在飞」的时刻断言界面状态（乐观更新 / 不回弹）。
 * 例：`const d = deferred(); mock.mockReturnValue(d.promise);` 先断言，再 `d.resolve()`。
 */
export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
