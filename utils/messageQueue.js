class MessageQueue {
  constructor({ maxSize = 100, concurrency = 3 } = {}) {
    this.maxSize = maxSize;
    this.concurrency = concurrency;
    this.queue = [];
    this.active = 0;
    this.accepting = true;
    this.idleWaiters = [];
  }

  enqueue(task) {
    if (!this.accepting || this.queue.length + this.active >= this.maxSize) return false;
    this.queue.push(task);
    this.process();
    return true;
  }

  async process() {
    while (this.accepting && this.active < this.concurrency && this.queue.length) {
      const task = this.queue.shift();
      this.active += 1;
      Promise.resolve()
        .then(task)
        .catch(() => {})
        .finally(() => {
          this.active -= 1;
          this.process();
          this.resolveIdleWaiters();
        });
    }
    this.resolveIdleWaiters();
  }

  stopAccepting() {
    this.accepting = false;
  }

  async drain(timeoutMs = 30000) {
    this.stopAccepting();
    if (!this.queue.length && this.active === 0) return;

    await Promise.race([
      new Promise((resolve) => this.idleWaiters.push(resolve)),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
    this.queue.length = 0;
  }

  getStats() {
    return {
      queued: this.queue.length,
      active: this.active,
      accepting: this.accepting,
      concurrency: this.concurrency,
    };
  }

  resolveIdleWaiters() {
    if (this.queue.length || this.active) return;
    const waiters = this.idleWaiters.splice(0);
    for (const resolve of waiters) resolve();
  }
}

module.exports = MessageQueue;
