// A loader must validate its result before resolving. Failures remain retryable.
export class RequestCache extends Map {
  #pending = new Map();

  load(key, loader) {
    if (this.has(key)) return Promise.resolve(this.get(key));
    if (this.#pending.has(key)) return this.#pending.get(key);
    const task = Promise.resolve().then(loader).then((value) => {
      this.set(key, value);
      return value;
    }).finally(() => this.#pending.delete(key));
    this.#pending.set(key, task);
    return task;
  }
}
