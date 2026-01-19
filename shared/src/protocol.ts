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

export type ScanFileParams = {
  path: string;
};

export type ScanFileFace = {
  index: number;
  familyName: string;
  fullName: string;
  postScriptName: string;
  styleName: string;
  weight?: number;
  width?: number;
  slant?: number;
  isItalic: boolean;
  isVariable: boolean;
};

export type ScanFileResult = {
  path: string;
  faces: ScanFileFace[];
};

export type FontServiceMethods = 'ping' | 'scanFile';

export type LibrarySource = {
  id: number;
  path: string;
  isEnabled: boolean;
  createdAt: string;
};

export type LibraryFace = {
  id: number;
  familyId: number;
  fileId: number;
  filePath: string;
  indexInCollection: number;
  postscriptName: string;
  fullName: string;
  styleName: string;
  weight?: number | null;
  width?: number | null;
  slant?: number | null;
  isItalic: boolean;
  isVariable: boolean;
  previewSupported: boolean;
  installSupported: boolean;
};

export type LibraryFamily = {
  id: number;
  familyName: string;
  faces: LibraryFace[];
};
