export type JsonRpcId = string | number;

export type JsonRpcRequest<TParams = unknown> = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: TParams;
};

export type JsonRpcSuccess<TResult = unknown> = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: TResult;
};

export type JsonRpcError = {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export type JsonRpcResponse<TResult = unknown> =
  | JsonRpcSuccess<TResult>
  | JsonRpcError;

export type PingResult = {
  ok: true;
  version: string;
};

export type PingRequest = JsonRpcRequest;

export type HelperEvent =
  | {
      event: 'scanProgress';
      stats: {
        scanned: number;
        total?: number;
      };
    }
  | {
      event: 'error';
      code: string;
      message: string;
      context?: unknown;
    };

export type FontServiceMethods = 'ping';
