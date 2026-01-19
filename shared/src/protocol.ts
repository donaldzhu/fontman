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
      event: 'sourceChanged';
      changes: {
        path: string;
        flags?: string[];
      }[];
    }
  | {
      event: 'fileMissing';
      path: string;
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

export type WatchSourcesParams = {
  paths: string[];
};

export type WatchSourcesResult = {
  watching: boolean;
  paths: string[];
};

export type UnregisterFontParams = {
  path: string;
};

export type UnregisterFontResult = {
  ok: boolean;
};

export type RegisterFontParams = {
  path: string;
};

export type RegisterFontResult = {
  ok: boolean;
};

export type IsFontRegisteredParams = {
  path: string;
};

export type IsFontRegisteredResult = {
  registered: boolean;
};

export type FontServiceMethods =
  | 'ping'
  | 'scanFile'
  | 'watchSources'
  | 'registerFont'
  | 'unregisterFont'
  | 'isFontRegistered';

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
  activated: boolean;
};

export type LibraryFamily = {
  id: number;
  familyName: string;
  faces: LibraryFace[];
  facetValueIds: number[];
};

export type FacetColumnType = 'single' | 'multi' | 'boolean';

export type FacetValue = {
  id: number;
  columnId: number;
  valueKey: string;
  displayName: string;
};

export type FacetColumn = {
  id: number;
  key: string;
  displayName: string;
  type: FacetColumnType;
  values: FacetValue[];
};

export type FamilyFacetValue = {
  familyId: number;
  valueId: number;
};
