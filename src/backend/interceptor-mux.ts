import type {
  InterceptorContextDTO,
  InterceptorDisposer,
  InterceptorHandler,
  InterceptorResultDTO,
  LlmMessageDTO,
  SpindleAPI,
} from "lumiverse-spindle-types";

function isInterceptorResultObject(
  value: LlmMessageDTO[] | InterceptorResultDTO,
): value is InterceptorResultDTO {
  return Boolean(value) && !Array.isArray(value) && typeof value === "object";
}

/**
 * Owns the single worker-level `spindle.registerInterceptor(...)` slot so
 * multiple backend subsystems (`GuidedGenerationRunner` dryRun captures and
 * `GuidedSceneManager` steering/dryRun) can register and dispose independently
 * without colliding or unregistering each other.
 *
 * Preserves strict zero-footprint dormancy:
 * - Registers with the host ONLY on the `0 -> 1` active sub-handler transition.
 * - Immediately disposes the host registration on the `1 -> 0` transition.
 */
export class InterceptorMux {
  private readonly handlers = new Map<symbol, InterceptorHandler>();
  private hostDisposer: InterceptorDisposer | null = null;
  private disposed = false;

  constructor(private readonly spindle: SpindleAPI) {}

  isRegistered(): boolean {
    return this.hostDisposer !== null;
  }

  get activeCount(): number {
    return this.handlers.size;
  }

  register(handler: InterceptorHandler): InterceptorDisposer {
    if (this.disposed) {
      return () => {};
    }

    const token = Symbol("gg_interceptor_sub");
    this.handlers.set(token, handler);
    this.ensureHostRegistered();

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.handlers.delete(token);
      if (this.handlers.size === 0) {
        this.disposeHost();
      }
    };
  }

  syncPermissions(): void {
    if (this.disposed || !this.spindle.permissions?.has?.("interceptor")) {
      this.disposeHost();
      return;
    }
    if (this.handlers.size > 0) {
      this.ensureHostRegistered();
    } else {
      this.disposeHost();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.handlers.clear();
    this.disposeHost();
  }

  private ensureHostRegistered(): void {
    if (this.disposed || this.hostDisposer) return;
    if (!this.spindle.permissions?.has?.("interceptor")) {
      this.disposeHost();
      return;
    }
    if (typeof this.spindle.registerInterceptor !== "function") return;

    try {
      this.hostDisposer = this.spindle.registerInterceptor(
        async (messages: LlmMessageDTO[], context: InterceptorContextDTO) => {
          if (this.disposed) return messages;
          if (this.spindle.permissions?.has && !this.spindle.permissions.has("interceptor")) {
            return messages;
          }

          let currentMessages = messages;
          let mergedResult: Partial<InterceptorResultDTO> | null = null;

          for (const subHandler of [...this.handlers.values()]) {
            try {
              const output = await subHandler(currentMessages, context);
              if (isInterceptorResultObject(output)) {
                currentMessages = output.messages;
                if (
                  output.parameters !== undefined ||
                  output.breakdown !== undefined ||
                  output.deferredGuidance !== undefined ||
                  output.finalResponse !== undefined
                ) {
                  mergedResult ??= {};
                  if (output.parameters !== undefined) {
                    mergedResult.parameters = {
                      ...(mergedResult.parameters ?? {}),
                      ...output.parameters,
                    };
                  }
                  if (output.breakdown !== undefined) {
                    mergedResult.breakdown = [
                      ...(mergedResult.breakdown ?? []),
                      ...output.breakdown,
                    ];
                  }
                  if (output.deferredGuidance !== undefined) {
                    mergedResult.deferredGuidance = [
                      ...(mergedResult.deferredGuidance ?? []),
                      ...output.deferredGuidance,
                    ];
                  }
                  if (output.finalResponse !== undefined) {
                    mergedResult.finalResponse = output.finalResponse;
                  }
                }
              } else if (Array.isArray(output)) {
                currentMessages = output;
              }
            } catch (err) {
              this.spindle.log?.warn?.(
                `[GuidedGenerations] Interceptor sub-handler failed: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
            }
          }

          if (mergedResult) {
            return {
              ...mergedResult,
              messages: currentMessages,
            };
          }
          return currentMessages;
        },
      );
    } catch {
      this.hostDisposer = null;
    }
  }

  private disposeHost(): void {
    if (!this.hostDisposer) return;
    try {
      this.hostDisposer();
    } finally {
      this.hostDisposer = null;
    }
  }
}
