export function createAuthOperationTracker() {
  let generation = 0;

  const advance = () => {
    generation += 1;
    return generation;
  };

  return {
    begin: advance,
    invalidate: advance,
    isCurrent(candidate) {
      return candidate === generation;
    },
  };
}
