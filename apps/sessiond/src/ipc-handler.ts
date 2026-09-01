import type {
  IpcMethod,
  IpcMethodResult
} from "@pi-web/protocol";

export type ServerIpcMethod = Exclude<IpcMethod, "protocol.handshake">;

export type IpcHandlerMap<Method extends ServerIpcMethod = ServerIpcMethod> = {
  [M in Method]: (
    raw: unknown
  ) => IpcMethodResult<M> | Promise<IpcMethodResult<M>>;
};
