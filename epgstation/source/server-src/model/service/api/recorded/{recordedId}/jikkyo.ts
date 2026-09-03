import { execFile } from "child_process";
import { promisify } from "util";
import { Operation } from "express-openapi";
import * as api from "../../../api";

const execFileAsync = promisify(execFile);

export const post: Operation = async (req, res) => {
  const recordedId = parseInt(req.params.recordedId, 10);

  if (Number.isNaN(recordedId)) {
    api.responseError(res, {
      code: 400,
      message: "invalid recorded id",
    });
    return;
  }

  try {
    const result = await execFileAsync(
      "/bin/bash",
      ["/app/config/jikkyo-fetch.sh", recordedId.toString(10)],
      {
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    const stdout = result.stdout;

    let status: "created" | "exists";

    if (stdout.includes("CREATE XML:")) {
      status = "created";
    } else if (stdout.includes("SKIP XML exists:")) {
      status = "exists";
    } else {
      throw new Error(
        `jikkyo XML was not created: recordedId=${recordedId}\n${stdout}`
      );
    }

    api.responseJSON(res, 200, {
      code: 200,
      status,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  } catch (err: any) {
    api.responseServerError(res, err.message);
  }
};

post.apiDoc = {
  summary: "実況コメント XML 生成",
  tags: ["recorded"],
  description: "指定した録画の実況コメント XML を生成する",
  parameters: [
    {
      $ref: "#/components/parameters/PathRecordedId",
    },
  ],
  responses: {
    200: {
      description: "実況コメント XML を生成しました",
    },
    400: {
      description: "recorded id が不正です",
    },
    default: {
      description: "予期しないエラー",
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/Error",
          },
        },
      },
    },
  },
};
