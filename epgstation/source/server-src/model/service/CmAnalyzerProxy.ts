import * as http from 'http';
import { URL } from 'url';

export interface ICmAnalyzerResponse {
    statusCode: number;
    headers: http.IncomingHttpHeaders;
    body: Buffer;
}

const CM_ANALYZER_URL =
    process.env.CM_ANALYZER_URL ||
    'http://cm-analyzer:8080';

export const requestCmAnalyzer = (
    pathname: string,
    method: 'GET' | 'DELETE' = 'GET',
): Promise<ICmAnalyzerResponse> => {
    return new Promise((resolve, reject) => {
        const baseUrl =
            CM_ANALYZER_URL.endsWith('/')
                ? CM_ANALYZER_URL
                : `${CM_ANALYZER_URL}/`;

        const target =
            new URL(pathname, baseUrl);

        if (target.protocol !== 'http:') {
            reject(
                new Error(
                    `unsupported CM analyzer protocol: ${target.protocol}`,
                ),
            );
            return;
        }

        const request =
            http.request(
                target,
                {
                    method,
                },
                response => {
                    const chunks: Buffer[] = [];

                    response.on('data', chunk => {
                        chunks.push(
                            Buffer.isBuffer(chunk)
                                ? chunk
                                : Buffer.from(chunk),
                        );
                    });

                    response.on('end', () => {
                        resolve({
                            statusCode:
                                response.statusCode || 500,
                            headers:
                                response.headers,
                            body:
                                Buffer.concat(chunks),
                        });
                    });
                },
            );

        request.end();

        request.setTimeout(
            10000,
            () => {
                request.destroy(
                    new Error(
                        'CM analyzer request timeout',
                    ),
                );
            },
        );

        request.on(
            'error',
            reject,
        );
    });
};
