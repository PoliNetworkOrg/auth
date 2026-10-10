// Test-only: runs the app's real server functions in Vitest, where the Start plugins that
// normally compile them are disabled. Never import this from application code.
//
// A test file opts in with:
//
//   vi.mock("@tanstack/react-start", async (importOriginal) =>
//     (await import("./server-fn-harness")).mockReactStart(await importOriginal()),
//   );
//   vi.mock("@tanstack/react-start/server", async () =>
//     (await import("./server-fn-harness")).startServerMock,
//   );
//
// and then calls a server function with `callServerFn(fn, { headers, data })`. The call runs
// what a browser request would: the request middleware from `src/start.ts` (the CSRF check),
// then the function's own middleware (session and permission checks, error mapping), its
// validator, and its handler. Only the HTTP transport and serialization are left out.
import { AsyncLocalStorage } from "node:async_hooks";
import { ActionError } from "@/lib/action-error";

type StartModule = typeof import("@tanstack/react-start");
type Context = { [key: string]: unknown; data?: unknown; context: Record<string, unknown> };
type Next = (more?: Partial<Context>) => Promise<unknown>;
type Middleware = {
  options: {
    middleware?: readonly Middleware[];
    validator?: unknown;
    inputValidator?: unknown;
    server?: (ctx: Context & { next: Next }) => unknown;
  };
};
type Call = {
  request: Request;
  /** The global function middleware from `src/start.ts`, which runs before a function's own. */
  functionMiddleware: readonly Middleware[];
  responseHeaders: Headers;
  status?: number;
};

const calls = new AsyncLocalStorage<Call>();
let start: StartModule | undefined;

function current(): Call {
  const call = calls.getStore();
  if (!call) throw new Error("Call server functions through callServerFn in tests.");
  return call;
}

/** Stands in for `@tanstack/react-start/server`, answering for the current test request. */
export const startServerMock = {
  getRequest: () => current().request,
  setResponseHeader: (name: string, value: string) => current().responseHeaders.set(name, value),
  setResponseStatus: (status: number) => {
    current().status = status;
  },
  getResponseStatus: () => current().status ?? 200,
  // Better Auth's TanStack Start plugin forwards session cookies here; tests read the database.
  setCookie: () => {},
};

/** Runs middleware the way Start does on the server: validator first, then `server`. */
async function runChain(middleware: readonly Middleware[], ctx: Context): Promise<Context> {
  if (!start) throw new Error("Mock @tanstack/react-start with mockReactStart first.");
  const queue = start.flattenMiddlewares(middleware as never) as unknown as Middleware[];
  const { execValidator } = start;
  const step = async (ctx: Context): Promise<Context> => {
    const next = queue.shift();
    if (!next) return ctx;
    const validator = next.options.inputValidator ?? next.options.validator;
    if (validator) ctx = { ...ctx, data: await execValidator(validator as never, ctx.data) };
    if (!next.options.server) return step(ctx);
    // Safety: every middleware in this app returns what `next()` resolved with.
    return (await next.options.server({
      ...ctx,
      next: (more = {}) =>
        step({ ...ctx, ...more, context: { ...ctx.context, ...more.context } } as Context),
    })) as Context;
  };
  return step(ctx);
}

type Builder = {
  method: "GET" | "POST";
  middleware: readonly Middleware[];
  validator?: unknown;
};

function serverFnBuilder(state: Builder) {
  const withValidator = (validator: unknown) => serverFnBuilder({ ...state, validator });
  return {
    middleware: (middleware: readonly Middleware[]) =>
      serverFnBuilder({ ...state, middleware: [...state.middleware, ...middleware] }),
    validator: withValidator,
    inputValidator: withValidator,
    handler: (handler: (ctx: Context) => unknown) =>
      Object.assign(
        async (opts?: { data?: unknown }) => {
          const handlerAsMiddleware: Middleware = {
            options: {
              inputValidator: state.validator,
              server: async ({ next, ...ctx }) => next({ result: await handler(ctx) }),
            },
          };
          const { request, functionMiddleware } = current();
          const middleware = [...functionMiddleware, ...state.middleware, handlerAsMiddleware];
          const done = await runChain(middleware, {
            data: opts?.data,
            context: {},
            method: state.method,
            request,
            serverFnMeta: { name: "serverFn" },
          });
          return done.result;
        },
        { method: state.method },
      ),
  };
}

/** `@tanstack/react-start`, with `createServerFn` building functions this harness can run. */
export function mockReactStart(actual: StartModule) {
  start = actual;
  return {
    ...actual,
    createServerFn: (options?: { method?: "GET" | "POST" }) =>
      serverFnBuilder({ method: options?.method ?? "GET", middleware: [] }),
  };
}

export type ServerFnCall<TResult> = {
  status: number;
  result?: TResult;
  error?: ActionError;
  /** The response headers the function set, such as Cache-Control. */
  headers: Headers;
};

/**
 * Calls a server function as a browser request with these headers would. A refusal becomes
 * its status (CSRF refusals included), success is 200, and anything else is thrown.
 */
export async function callServerFn<TData, TResult>(
  fn: (opts: { data: TData }) => Promise<TResult>,
  { headers, data }: { headers?: HeadersInit; data: TData },
): Promise<ServerFnCall<TResult>> {
  const { startInstance } = await import("@/start");
  const { requestMiddleware = [], functionMiddleware = [] } = await startInstance.getOptions();
  const method = (fn as unknown as { method: string }).method;
  const call: Call = {
    request: new Request("http://localhost/_serverFn/test", { method, headers }),
    functionMiddleware: functionMiddleware as unknown as Middleware[],
    responseHeaders: new Headers(),
  };
  // After the request middleware, the request reaches the server function.
  const serverFn: Middleware = {
    options: { server: async () => ({ result: await fn({ data }) }) },
  };
  try {
    const done: unknown = await calls.run(call, () =>
      runChain([...(requestMiddleware as unknown as Middleware[]), serverFn], {
        context: {},
        handlerType: "serverFn",
        request: call.request,
      }),
    );
    // A request middleware that answers by itself, as the CSRF check does when it refuses.
    if (done instanceof Response) return { status: done.status, headers: call.responseHeaders };
    return {
      status: 200,
      result: (done as { result: TResult }).result,
      headers: call.responseHeaders,
    };
  } catch (cause) {
    if (cause instanceof ActionError)
      return { status: cause.status, error: cause, headers: call.responseHeaders };
    throw cause;
  }
}
