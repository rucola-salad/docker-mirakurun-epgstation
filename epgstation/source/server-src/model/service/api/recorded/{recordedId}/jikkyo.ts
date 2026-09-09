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
    const resultMatch = stdout.match(
      /JIKKYO RESULT comments=(\d+) updated=(\d+) preserved=(\d+)/
    );

    if (!resultMatch) {
      throw new Error(
        `jikkyo XML result was not found: recordedId=${recordedId}\n${stdout}`
      );
    }

    const comments = parseInt(resultMatch[1], 10);
    const updated = parseInt(resultMatch[2], 10);
    const preserved = parseInt(resultMatch[3], 10);
    const status: "created" | "exists" = updated > 0 ? "created" : "exists";

    api.responseJSON(res, 200, {
      code: 200,
      status,
      comments,
      updated,
      preserved,
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
  description: "指定した録画の実況コメント XML を再取得して生成する",
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
