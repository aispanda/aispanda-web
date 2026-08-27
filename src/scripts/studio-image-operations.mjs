export const createStudioImageOperationCoordinator = () => {
  let active = null;
  let sequence = 0;

  const cancel = () => {
    if (!active) return;
    active.controller.abort();
    active = null;
  };

  const isActive = (operation) => active === operation && !operation.controller.signal.aborted;

  return {
    begin(context) {
      cancel();
      const operation = Object.freeze({
        id: ++sequence,
        context: Object.freeze({ ...context }),
        controller: new AbortController(),
      });
      active = operation;
      return operation;
    },
    cancel,
    isActive,
    complete(operation, apply) {
      if (!isActive(operation)) return false;
      const applied = apply(operation.context);
      if (applied === false) return false;
      active = null;
      return true;
    },
    finish(operation) {
      if (active === operation) active = null;
    },
  };
};
