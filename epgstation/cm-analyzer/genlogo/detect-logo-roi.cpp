#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <queue>
#include <sstream>
#include <string>
#include <vector>

static std::string shellQuote(const std::string& s)
{
    std::string r = "'";
    for (char c : s) {
        if (c == '\'')
            r += "'\\''";
        else
            r += c;
    }
    r += "'";
    return r;
}

static bool getVideoSize(
    const std::string& input,
    int& width,
    int& height)
{
    std::string cmd =
        "ffprobe -v error "
        "-select_streams v:0 "
        "-show_entries stream=width,height "
        "-of csv=p=0:s=x " +
        shellQuote(input);

    FILE* fp = popen(cmd.c_str(), "r");
    if (!fp)
        return false;

    char buf[256] {};
    std::string result;

    if (fgets(buf, sizeof(buf), fp))
        result = buf;

    pclose(fp);

    if (std::sscanf(
            result.c_str(),
            "%dx%d",
            &width,
            &height) != 2)
        return false;

    return width > 0 && height > 0;
}

struct Component
{
    int minX;
    int minY;
    int maxX;
    int maxY;
    int pixels;
    double persistenceSum;
};

int main(int argc, char** argv)
{
    std::string input;

    double fps = 0.05;
    int maxFrames = 120;

    /*
     * edgeThreshold:
     * 各フレームで「エッジがある」とみなす強度。
     *
     * persistence:
     * 全フレーム中何割以上で同じ場所にエッジが
     * 存在すれば固定物とみなすか。
     */
    int edgeThreshold = 10;
    double persistence = 0.45;

    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];

        auto next = [&]() -> std::string {
            if (++i >= argc) {
                std::cerr
                    << "missing value after "
                    << a << "\n";
                std::exit(2);
            }
            return argv[i];
        };

        if (a == "-i")
            input = next();
        else if (a == "--fps")
            fps = std::stod(next());
        else if (a == "--max-frames")
            maxFrames = std::stoi(next());
        else if (a == "--edge-threshold")
            edgeThreshold = std::stoi(next());
        else if (a == "--persistence")
            persistence = std::stod(next());
        else {
            std::cerr
                << "unknown option: "
                << a << "\n";
            return 2;
        }
    }

    if (input.empty()) {
        std::cerr
            << "usage: detect-logo-roi -i INPUT "
            << "[--fps 0.05] "
            << "[--max-frames 120] "
            << "[--edge-threshold 10] "
            << "[--persistence 0.45]\n";
        return 2;
    }

    int sourceW = 0;
    int sourceH = 0;

    if (!getVideoSize(input, sourceW, sourceH)) {
        std::cerr
            << "cannot determine video size\n";
        return 3;
    }

    /*
     * 検出解像度。
     *
     * 1440x1080なら 1/2、
     * 1920x1080でも十分細かくROIを取れる。
     */
    const int W = 720;
    const int H = 540;

    const size_t frameSize =
        size_t(W) * size_t(H);

    std::vector<uint8_t> frame(frameSize);

    /*
     * 同じ位置に何フレームでエッジが出たか。
     */
    std::vector<unsigned short>
        edgeCount(frameSize, 0);

    char fpsbuf[64];

    std::snprintf(
        fpsbuf,
        sizeof(fpsbuf),
        "%.8f",
        fps
    );

    std::string filter =
        "fps=" +
        std::string(fpsbuf) +
        ",scale=" +
        std::to_string(W) +
        ":" +
        std::to_string(H);

    std::string cmd =
        "ffmpeg "
        "-hide_banner "
        "-loglevel error "
        "-i " +
        shellQuote(input) +
        " -an -sn -dn "
        "-vf " +
        shellQuote(filter) +
        " -frames:v " +
        std::to_string(maxFrames) +
        " -pix_fmt gray "
        "-f rawvideo -";

    std::cerr
        << "source: "
        << sourceW << "x" << sourceH
        << "\n";

    std::cerr
        << "analysis: "
        << W << "x" << H
        << ", fps=" << fps
        << ", maxFrames=" << maxFrames
        << "\n";

    FILE* fp = popen(cmd.c_str(), "r");

    if (!fp) {
        perror("popen");
        return 1;
    }

    int frames = 0;

    while (frames < maxFrames) {

        size_t got =
            fread(
                frame.data(),
                1,
                frameSize,
                fp
            );

        if (got == 0)
            break;

        if (got != frameSize) {
            std::cerr
                << "short raw frame\n";
            break;
        }

        /*
         * Sobelほど重くする必要はない。
         * 水平・垂直差分の合計で固定エッジを見る。
         */
        for (int y = 1; y < H - 1; ++y) {
            for (int x = 1; x < W - 1; ++x) {

                size_t o =
                    size_t(x) +
                    size_t(y) * W;

                int gx =
                    std::abs(
                        int(frame[o + 1]) -
                        int(frame[o - 1])
                    );

                int gy =
                    std::abs(
                        int(frame[o + W]) -
                        int(frame[o - W])
                    );

                if (gx + gy >= edgeThreshold)
                    ++edgeCount[o];
            }
        }

        ++frames;
    }

    int status = pclose(fp);
    (void)status;

    if (frames < 10) {
        std::cerr
            << "not enough frames: "
            << frames << "\n";
        return 4;
    }

    /*
     * 日本のテレビ局ウォーターマークを主対象として、
     * 右上 35% x 上 30% を探索。
     *
     * 1440x1080のCX正解:
     *   x=1360 y=30 w=56 h=72
     *
     * は完全にこの範囲に入る。
     */
    const int searchX0 =
        int(W * 0.65);

    const int searchX1 =
        W - 2;

    const int searchY0 =
        2;

    const int searchY1 =
        int(H * 0.30);

    const int minCount =
        std::max(
            3,
            int(
                std::ceil(
                    frames * persistence
                )
            )
        );

    std::vector<uint8_t>
        fixed(frameSize, 0);

    int fixedPixels = 0;

    for (int y = searchY0;
         y <= searchY1;
         ++y) {

        for (int x = searchX0;
             x <= searchX1;
             ++x) {

            size_t o =
                size_t(x) +
                size_t(y) * W;

            if (edgeCount[o] >= minCount) {
                fixed[o] = 1;
                ++fixedPixels;
            }
        }
    }

    std::cerr
        << "frames=" << frames
        << " fixedPixels="
        << fixedPixels
        << " minCount="
        << minCount
        << "\n";

    /*
     * 少し離れたロゴ文字を同一成分にするため、
     * 近傍を軽く膨張。
     */
    std::vector<uint8_t> dilated = fixed;

    const int radius = 3;

    for (int y = searchY0;
         y <= searchY1;
         ++y) {

        for (int x = searchX0;
             x <= searchX1;
             ++x) {

            size_t o =
                size_t(x) +
                size_t(y) * W;

            if (!fixed[o])
                continue;

            for (int dy = -radius;
                 dy <= radius;
                 ++dy) {

                int yy = y + dy;

                if (yy < searchY0 ||
                    yy > searchY1)
                    continue;

                for (int dx = -radius;
                     dx <= radius;
                     ++dx) {

                    int xx = x + dx;

                    if (xx < searchX0 ||
                        xx > searchX1)
                        continue;

                    dilated[
                        size_t(xx) +
                        size_t(yy) * W
                    ] = 1;
                }
            }
        }
    }

    std::vector<uint8_t>
        visited(frameSize, 0);

    Component best {};
    bool haveBest = false;
    double bestScore = -1.0;

    const int dirs[4][2] = {
        { 1, 0 },
        {-1, 0 },
        { 0, 1 },
        { 0,-1 }
    };

    for (int sy = searchY0;
         sy <= searchY1;
         ++sy) {

        for (int sx = searchX0;
             sx <= searchX1;
             ++sx) {

            size_t so =
                size_t(sx) +
                size_t(sy) * W;

            if (!dilated[so] ||
                visited[so])
                continue;

            std::queue<std::pair<int,int>> q;

            q.push({sx, sy});
            visited[so] = 1;

            Component c {
                sx, sy,
                sx, sy,
                0,
                0.0
            };

            while (!q.empty()) {

                auto [x, y] = q.front();
                q.pop();

                c.minX =
                    std::min(c.minX, x);

                c.maxX =
                    std::max(c.maxX, x);

                c.minY =
                    std::min(c.minY, y);

                c.maxY =
                    std::max(c.maxY, y);

                size_t o =
                    size_t(x) +
                    size_t(y) * W;

                if (fixed[o]) {
                    ++c.pixels;

                    c.persistenceSum +=
                        double(edgeCount[o]) /
                        frames;
                }

                for (const auto& d : dirs) {

                    int nx = x + d[0];
                    int ny = y + d[1];

                    if (nx < searchX0 ||
                        nx > searchX1 ||
                        ny < searchY0 ||
                        ny > searchY1)
                        continue;

                    size_t no =
                        size_t(nx) +
                        size_t(ny) * W;

                    if (visited[no] ||
                        !dilated[no])
                        continue;

                    visited[no] = 1;
                    q.push({nx, ny});
                }
            }

            if (c.pixels < 4)
                continue;

            int cw =
                c.maxX - c.minX + 1;

            int ch =
                c.maxY - c.minY + 1;

            /*
             * ノイズや画面端の長い線を除外。
             */
            if (cw < 4 || ch < 4)
                continue;

            if (cw > W * 0.25 ||
                ch > H * 0.18)
                continue;

            double avgPersistence =
                c.persistenceSum /
                c.pixels;

            /*
             * 右上に近いほど少しだけ優先。
             * 主評価は固定エッジ画素数と継続率。
             */
            double rightBonus =
                1.0 +
                0.25 *
                double(c.maxX) / W;

            double topBonus =
                1.0 +
                0.15 *
                (1.0 -
                 double(c.minY) / H);

            double score =
                c.pixels *
                avgPersistence *
                rightBonus *
                topBonus;

            if (score > bestScore) {
                bestScore = score;
                best = c;
                haveBest = true;
            }
        }
    }

    if (!haveBest) {
        std::cerr
            << "logo candidate not found\n";
        return 5;
    }

    /*
     * dilation分を戻しつつ、
     * genlogoの背景推定用余白を追加。
     */
    int lx =
        std::max(
            searchX0,
            best.minX + radius - 5
        );

    int ly =
        std::max(
            searchY0,
            best.minY + radius - 5
        );

    int rx =
        std::min(
            W - 1,
            best.maxX - radius + 5
        );

    int by =
        std::min(
            H - 1,
            best.maxY - radius + 5
        );

    /*
     * 検出解像度 → 元解像度。
     */
    double scaleX =
        double(sourceW) / W;

    double scaleY =
        double(sourceH) / H;

    int x =
        int(std::floor(lx * scaleX));

    int y =
        int(std::floor(ly * scaleY));

    int w =
        int(std::ceil(
            (rx - lx + 1) * scaleX
        ));

    int h =
        int(std::ceil(
            (by - ly + 1) * scaleY
        ));

    /*
     * YUV420用に偶数化。
     */
    x &= ~1;
    y &= ~1;

    w = (w + 1) & ~1;
    h = (h + 1) & ~1;

    /*
     * ソース外へ出さない。
     */
    if (x + w > sourceW)
        w = (sourceW - x) & ~1;

    if (y + h > sourceH)
        h = (sourceH - y) & ~1;

    std::cerr
        << "candidate score="
        << bestScore
        << " detector=("
        << best.minX << ","
        << best.minY << ")-("
        << best.maxX << ","
        << best.maxY << ")"
        << "\n";

    std::cout
        << "x=" << x << "\n"
        << "y=" << y << "\n"
        << "w=" << w << "\n"
        << "h=" << h << "\n";

    return 0;
}
