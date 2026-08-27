export type StudioImageOperation<T extends Record<string, unknown>> = Readonly<{
  id: number;
  context: Readonly<T>;
  controller: AbortController;
}>;

export type StudioImageOperationCoordinator = {
  begin<T extends Record<string, unknown>>(context: T): StudioImageOperation<T>;
  cancel(): void;
  isActive(operation: StudioImageOperation<Record<string, unknown>>): boolean;
  complete<T extends Record<string, unknown>>(operation: StudioImageOperation<T>, apply: (context: Readonly<T>) => boolean): boolean;
  finish(operation: StudioImageOperation<Record<string, unknown>>): void;
};

export const createStudioImageOperationCoordinator: () => StudioImageOperationCoordinator;
