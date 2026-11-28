/** Память раннера: предел cgroup (`cgroup`) или физическая память машины (`machine`), байт. */
export interface MemoryBudget {
  readonly bytes: number;
  readonly source: 'cgroup' | 'machine';
}
