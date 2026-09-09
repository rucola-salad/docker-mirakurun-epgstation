import { Operation } from "express-openapi";
import { requestCmAnalyzer } from "../../../CmAnalyzerProxy";
import * as api from "../../../api";

const getRecordedId = (req: any): string | null => {
  const recordedId = String(req.params.recordedId || "");

  return /^\d+$/.test(recordedId) ? recordedId : null;
};

export const post: Operation = async (req, res) => {
  const recordedId = getRecordedId(req);

  if (recordedId === null) {
    api.responseError(res, {
      code: 400,
      message: "invalid recordedId",
    });
    return;
  }

  try {
    const result = await requestCmAnalyzer(
      `analysis/${recordedId}`,
      "POST",
      req.body
    );

    let body: any = {};

    try {
      body = JSON.parse(result.body.toString("utf8"));
    } catch (_err) {
      // handled below
    }

    if (result.statusCode !== 200) {
      api.responseError(res, {
        code:
          result.statusCode >= 400 && result.statusCode < 500
            ? result.statusCode
            : 502,
        message: body.error || "CM analyzer manual timeline save failed",
      });
      return;
    }

    api.responseJSON(res, 200, body);
  } catch (err: any) {
    api.responseError(res, {
      code: 502,
      message: err.message || "CM analyzer request failed",
    });
  }
};

export const del: Operation = async (req, res) => {
  const recordedId = getRecordedId(req);

  if (recordedId === null) {
    api.responseError(res, {
      code: 400,
      message: "invalid recordedId",
    });
    return;
  }

  try {
    const result = await requestCmAnalyzer(`analysis/${recordedId}`, "DELETE");

    if (result.statusCode !== 200) {
      api.responseError(res, {
        code: 502,
        message: "CM analyzer manual timeline reset failed",
      });
      return;
    }

    let body: any;

    try {
      body = JSON.parse(result.body.toString("utf8"));
    } catch (_err) {
      api.responseError(res, {
        code: 502,
        message: "CM analyzer returned invalid JSON",
      });
      return;
    }

    api.responseJSON(res, 200, body);
  } catch (err: any) {
    api.responseError(res, {
      code: 502,
      message: err.message || "CM analyzer request failed",
    });
  }
};

export const get: Operation = async (req, res) => {
  const recordedId = String(req.params.recordedId || "");

  if (!/^\d+$/.test(recordedId)) {
    api.responseError(res, {
      code: 400,
      message: "invalid recordedId",
    });
    return;
  }

  try {
    const result = await requestCmAnalyzer(`analysis/${recordedId}`);

    if (result.statusCode === 404) {
      api.responseError(res, {
        code: 404,
        message: "CM analysis is not found",
      });
      return;
    }

    if (result.statusCode !== 200) {
      api.responseError(res, {
        code: 502,
        message: "CM analyzer analysis request failed",
      });
      return;
    }

    let body: any;

    try {
      body = JSON.parse(result.body.toString("utf8"));
    } catch (_err) {
      api.responseError(res, {
        code: 502,
        message: "CM analyzer returned invalid JSON",
      });
      return;
    }

    api.responseJSON(res, 200, body);
  } catch (err: any) {
    api.responseError(res, {
      code: 502,
      message: err.message || "CM analyzer request failed",
    });
  }
};

get.apiDoc = {
  summary: "CM解析結果取得",
  tags: ["cm-analyzer"],
  description: "録画IDに対応するCM解析結果を取得する",
  parameters: [
    {
      in: "path",
      name: "recordedId",
      required: true,
      schema: {
        type: "integer",
        minimum: 1,
      },
    },
  ],
  responses: {
    200: {
      description: "CM解析結果を取得しました",
    },
    400: {
      description: "recordedId が不正です",
    },
    404: {
      description: "CM解析結果がありません",
    },
    default: {
      description: "予期しないエラー",
    },
  },
};

post.apiDoc = {
  summary: "手動チャプター編集保存",
  tags: ["cm-analyzer"],
  parameters: [
    {
      in: "path",
      name: "recordedId",
      required: true,
      schema: {
        type: "integer",
        minimum: 1,
      },
    },
  ],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["frameRate", "duration", "pins"],
          properties: {
            frameRate: {
              type: "number",
              exclusiveMinimum: 0,
            },
            duration: {
              type: "number",
              exclusiveMinimum: 0,
            },
            pins: {
              type: "array",
              items: {
                type: "object",
                required: ["frame", "type"],
                properties: {
                  frame: {
                    type: "integer",
                    minimum: 0,
                  },
                  type: {
                    type: "string",
                    enum: [
                      "chapter",
                      "main-start",
                      "cm-start",
                      "cm-end",
                      "main-end",
                    ],
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  responses: {
    200: { description: "手動タイムラインを保存しました" },
    400: { description: "手動タイムラインが不正です" },
    default: { description: "予期しないエラー" },
  },
};

del.apiDoc = {
  summary: "手動チャプター編集解除",
  tags: ["cm-analyzer"],
  parameters: [
    {
      in: "path",
      name: "recordedId",
      required: true,
      schema: {
        type: "integer",
        minimum: 1,
      },
    },
  ],
  responses: {
    200: { description: "自動解析へ戻しました" },
    default: { description: "予期しないエラー" },
  },
};
