#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <queue>
#include <string>
#include <vector>

struct LogoColor {
    double sumF = 0;
    double sumB = 0;
    double sumF2 = 0;
    double sumB2 = 0;
    double sumFB = 0;

    void add(int f, int b) {
        sumF += f;
        sumB += b;
        sumF2 += double(f) * f;
        sumB2 += double(b) * b;
        sumFB += double(f) * b;
    }

    bool getAB(int n, float& A, float& B) const {
        auto line = [](int n, double sx, double sy,
                       double sx2, double sxy,
                       double& a, double& b) {
            double d = double(n) * sx2 - sx * sx;
            if (std::abs(d) < 1e-12) {
                a = b = NAN;
                return;
            }
            a = (double(n) * sxy - sx * sy) / d;
            b = (sx2 * sy - sx * sxy) / d;
        };

        // Amatsukaze LogoColor::Normalize(255) 相当
        double sf  = sumF  / 255.0;
        double sb  = sumB  / 255.0;
        double sf2 = sumF2 / (255.0 * 255.0);
        double sb2 = sumB2 / (255.0 * 255.0);
        double sfb = sumFB / (255.0 * 255.0);

        double a1, b1, a2, b2;
        line(n, sf, sb, sf2, sfb, a1, b1);
        line(n, sb, sf, sb2, sfb, a2, b2);

        if (!std::isfinite(a1) || !std::isfinite(a2) ||
            !std::isfinite(b1) || !std::isfinite(b2) ||
            std::abs(a2) < 1e-12) {
            return false;
        }

        A = float((a1 + 1.0 / a2) / 2.0);
        B = float((b1 - b2 / a2) / 2.0);

        return std::isfinite(A) && std::isfinite(B) &&
               std::abs(A) > 1e-12;
    }
};

static float calcLogoDist(float a, float b)
{
    // Amatsukaze LogoScan::calcDist
    return (1.0f / 3.0f) * (a - 1.0f) * (a - 1.0f)
         + (a - 1.0f) * b
         + b * b;
}


static void debugLogoABDist(
    const std::vector<float>& ay,
    const std::vector<float>& byi,
    const std::vector<float>& au,
    const std::vector<float>& bui,
    const std::vector<float>& av,
    const std::vector<float>& bvi,
    int w,
    int h,
    int uw)
{
    double minA = 1e100;
    double maxA = -1e100;
    double sumA = 0.0;

    double minB = 1e100;
    double maxB = -1e100;
    double sumB = 0.0;

    size_t valid = 0;

    size_t lt099 = 0;
    size_t lt095 = 0;
    size_t lt090 = 0;

    size_t d_lt_03 = 0;
    size_t d_03_1  = 0;
    size_t d_1_3   = 0;
    size_t d_3_10  = 0;
    size_t d_10_30 = 0;
    size_t d_ge_30 = 0;

    for (int y = 0; y < h; ++y) {
        for (int x = 0; x < w; ++x) {
            const size_t yo =
                size_t(x) + size_t(y) * size_t(w);

            const size_t uo =
                size_t(x / 2) + size_t(y / 2) * size_t(uw);

            const float A = ay[yo];
            const float B = byi[yo];

            if (std::isfinite(A) && std::isfinite(B)) {
                minA = std::min(minA, double(A));
                maxA = std::max(maxA, double(A));
                sumA += A;

                minB = std::min(minB, double(B));
                maxB = std::max(maxB, double(B));
                sumB += B;

                ++valid;

                if (A < 0.99f) ++lt099;
                if (A < 0.95f) ++lt095;
                if (A < 0.90f) ++lt090;
            }

            float dist =
                calcLogoDist(ay[yo], byi[yo]) +
                calcLogoDist(au[uo], bui[uo]) +
                calcLogoDist(av[uo], bvi[uo]);

            dist *= 1000.0f;

            if (dist < 0.3f) {
                ++d_lt_03;
            } else if (dist < 1.0f) {
                ++d_03_1;
            } else if (dist < 3.0f) {
                ++d_1_3;
            } else if (dist < 10.0f) {
                ++d_3_10;
            } else if (dist < 30.0f) {
                ++d_10_30;
            } else {
                ++d_ge_30;
            }
        }
    }

    std::cerr << "===== remake regression before clean =====\n";

    std::cerr
        << "Y A min/max/avg: "
        << minA << " / "
        << maxA << " / "
        << (valid ? sumA / valid : 0.0)
        << "\n";

    std::cerr
        << "Y B min/max/avg: "
        << minB << " / "
        << maxB << " / "
        << (valid ? sumB / valid : 0.0)
        << "\n";

    std::cerr
        << "Y A <0.99: " << lt099
        << " / " << valid << "\n";

    std::cerr
        << "Y A <0.95: " << lt095
        << " / " << valid << "\n";

    std::cerr
        << "Y A <0.90: " << lt090
        << " / " << valid << "\n";

    std::cerr << "dist histogram:\n";
    std::cerr << "  <0.3   : " << d_lt_03 << "\n";
    std::cerr << "  0.3-1  : " << d_03_1  << "\n";
    std::cerr << "  1-3    : " << d_1_3   << "\n";
    std::cerr << "  3-10   : " << d_3_10  << "\n";
    std::cerr << "  10-30  : " << d_10_30 << "\n";
    std::cerr << "  >=30   : " << d_ge_30 << "\n";

    std::cerr
        << "clean target: "
        << d_lt_03
        << " / "
        << size_t(w) * size_t(h)
        << "\n";
}

static void cleanLogo(
    std::vector<float>& ay,
    std::vector<float>& byi,
    std::vector<float>& au,
    std::vector<float>& bui,
    std::vector<float>& av,
    std::vector<float>& bvi,
    int w,
    int h,
    int uw)
{
    // Amatsukaze LogoScan::GetLogo(true) 相当。
    //
    // 本家と同じく、
    //   1. 全Y画素について dist を先に計算
    //   2. その dist を使って A/B を clean
    // の2段階で処理する。
    //
    // YUV420では1つのUV画素を4つのY画素が共有するため、
    // dist計算中にUVを書き換えてはいけない。

    const size_t ySize =
        size_t(w) * size_t(h);

    std::vector<float> dist(ySize);

    // phase 1:
    // 元のA/Bだけを使って全distを確定する。
    for (int y = 0; y < h; ++y) {
        for (int x = 0; x < w; ++x) {
            const size_t yo =
                size_t(x) + size_t(y) * size_t(w);

            const size_t uo =
                size_t(x / 2) + size_t(y / 2) * size_t(uw);

            dist[yo] =
                calcLogoDist(ay[yo], byi[yo]) +
                calcLogoDist(au[uo], bui[uo]) +
                calcLogoDist(av[uo], bvi[uo]);

            dist[yo] *= 1000.0f;
        }
    }

    // 本家にはここで maxfilter(dist, work, ...) が3回あるが、
    // clean判定では work ではなく dist を参照しているため、
    // 出力結果には影響しない。

    // phase 2:
    // 確定済みdistを使ってcleanする。
    for (int y = 0; y < h; ++y) {
        for (int x = 0; x < w; ++x) {
            const size_t yo =
                size_t(x) + size_t(y) * size_t(w);

            const size_t uo =
                size_t(x / 2) + size_t(y / 2) * size_t(uw);

            if (dist[yo] < 0.3f) {
                ay[yo] = 1.0f;
                byi[yo] = 0.0f;

                au[uo] = 1.0f;
                bui[uo] = 0.0f;

                av[uo] = 1.0f;
                bvi[uo] = 0.0f;
            }
        }
    }
}

#pragma pack(push, 1)

struct LogoFileHeader {
    char magic[28];
    uint32_t countBE;
};

struct LogoHeader {
    char name[32];
    int16_t x;
    int16_t y;
    int16_t h;
    int16_t w;
    int16_t fi;
    int16_t fo;
    int16_t st;
    int16_t ed;
};

struct LogoPixel {
    int16_t dp_y;
    int16_t y;
    int16_t dp_cb;
    int16_t cb;
    int16_t dp_cr;
    int16_t cr;
};

#pragma pack(pop)

static_assert(sizeof(LogoFileHeader) == 32);
static_assert(sizeof(LogoHeader) == 48);
static_assert(sizeof(LogoPixel) == 12);

static uint32_t be32(uint32_t v) {
    return ((v & 0x000000ffU) << 24) |
           ((v & 0x0000ff00U) << 8)  |
           ((v & 0x00ff0000U) >> 8)  |
           ((v & 0xff000000U) >> 24);
}

static bool rangeOK(
    const std::vector<int>& v,
    int threshold)
{
    if (v.empty())
        return false;

    auto mm = std::minmax_element(v.begin(), v.end());
    return (*mm.second - *mm.first) <= threshold;
}

static int medianMiddle(std::vector<int>& v) {
    std::sort(v.begin(), v.end());

    size_t a = v.size() / 4;
    size_t b = v.size() - v.size() / 4;

    long long sum = 0;
    int count = 0;

    for (size_t i = a; i < b; ++i) {
        sum += v[i];
        ++count;
    }

    return count ? int((sum + count / 2) / count) : 0;
}

static int16_t clamp16(double v) {
    if (v < -32768.0) return -32768;
    if (v > 32767.0) return 32767;
    return int16_t(std::lround(v));
}

static void convertY(float A, float B, int16_t& dp, int16_t& value) {
    // AMTLogo.hpp ToYC48ABY 相当
    auto yv12 = [](double x) {
        return ((((int(x) * 219 + 383) >> 12) + 16) / 255.0);
    };

    auto yc48 = [](double y) {
        return double(((int(y * 255.0) * 1197) >> 6) - 299);
    };

    double x0 = 0;
    double x1 = 2048;

    double yy0 = (yv12(x0) - B) / A;
    double yy1 = (yv12(x1) - B) / A;

    yy0 = yc48(yy0);
    yy1 = yc48(yy1);

    B = float(yy0);
    A = float((yy1 - yy0) / 2048.0);

    if (std::abs(A - 1.0f) < 1e-9) {
        dp = value = 0;
        return;
    }

    double color = B / (1.0 - A) + 0.5;
    double alpha = (1.0 - A) * 1000.0 + 0.5;

    if (!std::isfinite(color) || !std::isfinite(alpha) ||
        std::abs(color) >= 32767 ||
        std::abs(alpha) > 16383 ||
        int16_t(alpha) == 0) {
        dp = value = 0;
        return;
    }

    value = clamp16(color);
    dp = clamp16(alpha);
}

static void convertC(float A, float B, int16_t& dp, int16_t& value) {
    auto yv12 = [](double x) {
        return (((((int(x) + 2048) * 7 + 66) >> 7) + 16) / 255.0);
    };

    auto yc48 = [](double u) {
        return double(((int(u * 255.0) - 128) * 4681 + 164) >> 8);
    };

    double x0 = 0;
    double x1 = 2048;

    double yy0 = (yv12(x0) - B) / A;
    double yy1 = (yv12(x1) - B) / A;

    yy0 = yc48(yy0);
    yy1 = yc48(yy1);

    B = float(yy0);
    A = float((yy1 - yy0) / 2048.0);

    if (std::abs(A - 1.0f) < 1e-9) {
        dp = value = 0;
        return;
    }

    double color = B / (1.0 - A) + 0.5;
    double alpha = (1.0 - A) * 1000.0 + 0.5;

    if (!std::isfinite(color) || !std::isfinite(alpha) ||
        std::abs(color) >= 32767 ||
        std::abs(alpha) > 16383 ||
        int16_t(alpha) == 0) {
        dp = value = 0;
        return;
    }

    value = clamp16(color);
    dp = clamp16(alpha);
}


struct LogoEvaluator {
    static constexpr int KS = 5;
    static constexpr int KR = 2;
    static constexpr int KLEN = KS * KS;

    static constexpr int CSHIFT = 3;
    static constexpr int CLEN = 256 >> CSHIFT;

    struct ScaleLimit {
        float scale = 0;
        float scale2 = 0;
    };

    int w;
    int h;

    std::vector<float> A;
    std::vector<float> B;

    /*
     * 本家 LogoDataParam::CreateLogoMask() 相当。
     *
     * mask は画像全体と同じサイズ。
     * kernels は mask == 1 の画素について走査順に25要素ずつ保持する。
     * scales も同じ走査順で、各特徴点について背景輝度32段階分を保持する。
     */
    std::vector<uint8_t> mask;
    std::vector<float> kernels;
    std::vector<ScaleLimit> scales;

    float blackScore = 1.0f;
    size_t maskPixels = 0;

    explicit LogoEvaluator(
        int width,
        int height,
        const std::vector<float>& srcA,
        const std::vector<float>& srcB
    )
        : w(width),
          h(height),
          A(srcA.size()),
          B(srcB.size())
    {
        /*
         * Amatsukaze DeintLogo() 相当。
         * 評価対象フレームだけでなく、評価用ロゴ A/B も
         * (prev + 2*cur + next) / 4 で縦方向に平滑化する。
         */
        for (int x = 0; x < w; ++x) {
            A[size_t(x)] = srcA[size_t(x)];
            B[size_t(x)] = srcB[size_t(x)];

            size_t last =
                size_t(x) + size_t(h - 1) * w;

            A[last] = srcA[last];
            B[last] = srcB[last];
        }

        for (int y = 1; y < h - 1; ++y) {
            for (int x = 0; x < w; ++x) {
                size_t off =
                    size_t(x) + size_t(y) * w;

                size_t up =
                    size_t(x) + size_t(y - 1) * w;

                size_t dn =
                    size_t(x) + size_t(y + 1) * w;

                A[off] =
                    (
                        srcA[up] +
                        2.0f * srcA[off] +
                        srcA[dn]
                    ) / 4.0f;

                B[off] =
                    (
                        srcB[up] +
                        2.0f * srcB[off] +
                        srcB[dn]
                    ) / 4.0f;
            }
        }

        createMask(0.10f);
    }

    /*
     * 単色背景 src に推定ロゴを重ねる。
     *
     * 回帰式:
     *
     *     background = A * foreground + B * maxv
     *
     * なので
     *
     *     foreground = (background - B * maxv) / A
     */
    void addLogo(std::vector<float>& y, float maxv) const {
        for (size_t i = 0; i < y.size(); ++i) {
            float a = A[i];
            float b = B[i];

            if (a > 0.0f)
                y[i] = (y[i] - b * maxv) / a;
        }
    }

    /*
     * 本家 pCalcCorrelation5x5() 相当。
     *
     * kernel は平均0の5x5ロゴ特徴カーネル。
     * work側も5x5平均を引いて相関を取る。
     *
     * avgにはwork側5x5平均を返す。
     */
    static float calcCorrelation5x5(
        const float* kernel,
        const float* work,
        int x,
        int y,
        int pitch,
        float* avgOut
    ) {
        float avg = 0.0f;

        for (int ky = -KR; ky <= KR; ++ky) {
            for (int kx = -KR; kx <= KR; ++kx) {
                avg += work[
                    size_t(x + kx) +
                    size_t(y + ky) * pitch
                ];
            }
        }

        avg /= float(KLEN);

        float sum = 0.0f;
        int k = 0;

        for (int ky = -KR; ky <= KR; ++ky) {
            for (int kx = -KR; kx <= KR; ++kx, ++k) {
                float v =
                    work[
                        size_t(x + kx) +
                        size_t(y + ky) * pitch
                    ] - avg;

                sum += kernel[k] * v;
            }
        }

        if (avgOut)
            *avgOut = avg;

        return sum;
    }

    /*
     * mask上の全特徴点について本家相当の正規化相関を合計する。
     */
    float correlationScore(
        const std::vector<float>& work,
        float maxv
    ) const {
        size_t count = 0;
        float result = 0.0f;

        for (int y = KR; y < h - KR; ++y) {
            for (int x = KR; x < w - KR; ++x) {
                size_t off = size_t(x) + size_t(y) * w;

                if (!mask[off])
                    continue;

                const float* k =
                    &kernels[count * KLEN];

                float avg = 0.0f;

                float sum = calcCorrelation5x5(
                    k,
                    work.data(),
                    x,
                    y,
                    w,
                    &avg
                );

                int avgi =
                    std::max(
                        0,
                        std::min(255, int(avg))
                    );

                int ci = avgi >> CSHIFT;

                const ScaleLimit& sl =
                    scales[count * CLEN + size_t(ci)];

                float normalized =
                    std::max(
                        -1.0f,
                        std::min(
                            1.0f,
                            sum * sl.scale
                        )
                    );

                float score =
                    normalized * sl.scale2;

                result += score;
                ++count;
            }
        }

        return result;
    }

    void createMask(float ratio) {
        const int ySize = w * h;
        const float corrLowerLimit = 0.2f;

        mask.assign(size_t(ySize), 0);

        /*
         * Amatsukaze CreateLogoMask() と同じく、
         * 32段階の単色背景へロゴを合成した画像を先に作る。
         */
        std::vector<float> memWork(
            size_t(ySize) * size_t(CLEN)
        );

        for (int c = 0; c < CLEN; ++c) {
            float* slice =
                memWork.data() +
                size_t(c) * size_t(ySize);

            std::fill_n(
                slice,
                ySize,
                float(c << CSHIFT)
            );

            for (int i = 0; i < ySize; ++i) {
                float a = A[size_t(i)];
                float b = B[size_t(i)];

                if (a > 0.0f)
                    slice[i] =
                        (slice[i] - b * 255.0f) / a;
            }
        }

        auto makeKernel = [&](float* k,
                              const float* y,
                              int x,
                              int yy) {
            int n = 0;

            for (int ky = -KR; ky <= KR; ++ky) {
                for (int kx = -KR; kx <= KR; ++kx) {
                    k[n++] =
                        y[
                            size_t(x + kx) +
                            size_t(yy + ky) * size_t(w)
                        ];
                }
            }

            float avg = 0.0f;

            for (int i = 0; i < KLEN; ++i)
                avg += k[i];

            avg /= float(KLEN);

            for (int i = 0; i < KLEN; ++i)
                k[i] -= avg;
        };

        /*
         * 本家と同じくYSize全画素ぶん確保する。
         * 5x5を置けない外周は score=0 のまま。
         *
         * std::pair<float,int> を std::greater<> で降順にするので、
         * score同値なら index も降順。
         */
        std::vector<std::pair<float, int>> variance{
            size_t(ySize)
        };

        const float* middle =
            memWork.data() +
            size_t(CLEN >> 1) * size_t(ySize);

        for (int yy = KR; yy < h - KR; ++yy) {
            for (int x = KR; x < w - KR; ++x) {
                float k[KLEN];

                makeKernel(k, middle, x, yy);

                float score = 0.0f;

                for (int i = 0; i < KLEN; ++i)
                    score += k[i] * k[i];

                variance[
                    size_t(x) +
                    size_t(yy) * size_t(w)
                ].first = score;
            }
        }

        for (int i = 0; i < ySize; ++i)
            variance[size_t(i)].second = i;

        std::sort(
            variance.begin(),
            variance.end(),
            std::greater<std::pair<float, int>>()
        );

        maskPixels = size_t(
            std::min(
                ySize,
                int(float(ySize) * ratio)
            )
        );

        for (size_t i = 0; i < maskPixels; ++i)
            mask[
                size_t(variance[i].second)
            ] = 1;

        /*
         * kernel生成も本家どおり背景0のsliceを使う。
         */
        kernels.assign(
            maskPixels * KLEN,
            0.0f
        );

        scales.assign(
            maskPixels * CLEN,
            ScaleLimit {}
        );

        size_t count = 0;
        float avgCorr = 0.0f;

        for (int yy = KR; yy < h - KR; ++yy) {
            for (int x = KR; x < w - KR; ++x) {
                const size_t off =
                    size_t(x) +
                    size_t(yy) * size_t(w);

                if (!mask[off])
                    continue;

                float* k =
                    &kernels[count * KLEN];

                ScaleLimit* sl =
                    &scales[count * CLEN];

                makeKernel(
                    k,
                    memWork.data(),
                    x,
                    yy
                );

                for (int ci = 0; ci < CLEN; ++ci) {
                    const float* slice =
                        memWork.data() +
                        size_t(ci) * size_t(ySize);

                    float corr =
                        std::abs(
                            calcCorrelation5x5(
                                k,
                                slice,
                                x,
                                yy,
                                w,
                                nullptr
                            )
                        );

                    sl[ci].scale = corr;
                    avgCorr += corr;
                }

                ++count;
            }
        }

        avgCorr /=
            float(maskPixels * CLEN);

        const float limitCorr =
            avgCorr * corrLowerLimit;

        for (size_t i = 0;
             i < maskPixels * CLEN;
             ++i) {

            const float corr =
                scales[i].scale;

            scales[i].scale =
                (corr > 0.0f)
                    ? (1.0f / corr)
                    : 0.0f;

            scales[i].scale2 =
                std::min(
                    1.0f,
                    corr / limitCorr
                );
        }

        /*
         * 本家:
         * memWork[(16 >> CSHIFT) * YSize]
         */
        std::vector<float> black(
            memWork.begin() +
                size_t(16 >> CSHIFT) *
                size_t(ySize),
            memWork.begin() +
                size_t((16 >> CSHIFT) + 1) *
                size_t(ySize)
        );

        blackScore =
            correlationScore(
                black,
                255.0f
            );

        std::cerr
            << "logo evaluator mask: "
            << maskPixels
            << " pixels"
            << ", blackScore="
            << blackScore
            << "\n";
    }

    static void deintY(
        std::vector<float>& dst,
        const uint8_t* src,
        int w,
        int h
    ) {
        dst.resize(size_t(w) * h);

        for (int x = 0; x < w; ++x) {
            dst[x] = src[x];

            dst[
                size_t(x) +
                size_t(h - 1) * w
            ] =
                src[
                    size_t(x) +
                    size_t(h - 1) * w
                ];
        }

        for (int y = 1; y < h - 1; ++y) {
            for (int x = 0; x < w; ++x) {
                dst[
                    size_t(x) +
                    size_t(y) * w
                ] =
                    (
                        src[
                            size_t(x) +
                            size_t(y - 1) * w
                        ] +
                        2.0f *
                        src[
                            size_t(x) +
                            size_t(y) * w
                        ] +
                        src[
                            size_t(x) +
                            size_t(y + 1) * w
                        ] +
                        2.0f
                    ) / 4.0f;
            }
        }
    }

    double evaluate(
        const std::vector<float>& src,
        double fade
    ) const {
        std::vector<float> work(src);

        /*
         * 本家 EvaluateLogo():
         *
         * bg = A * src + B * maxv
         * dst = fade * bg + (1-fade) * src
         */
        for (size_t i = 0; i < work.size(); ++i) {
            float bg =
                A[i] * src[i] +
                B[i] * 255.0f;

            work[i] =
                float(
                    fade * bg +
                    (1.0 - fade) * src[i]
                );
        }

        return
            correlationScore(work, 255.0f) /
            blackScore;
    }
};

static std::string shellQuote(const std::string& s) {
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

struct AutoRoiComponent {
    int minX;
    int minY;
    int maxX;
    int maxY;
    int pixels;
    double persistenceSum;
};

struct AutoRoiResult {
    int x = -1;
    int y = -1;
    int w = -1;
    int h = -1;
    double score = 0.0;
};

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

static bool getVideoDuration(
    const std::string& input,
    double& duration)
{
    std::string cmd =
        "ffprobe -v error "
        "-show_entries format=duration "
        "-of default=noprint_wrappers=1:nokey=1 " +
        shellQuote(input);

    FILE* fp = popen(cmd.c_str(), "r");
    if (!fp)
        return false;

    char buf[256] {};
    std::string result;

    if (fgets(buf, sizeof(buf), fp))
        result = buf;

    pclose(fp);

    try {
        duration = std::stod(result);
    } catch (...) {
        return false;
    }

    return std::isfinite(duration) && duration > 0.0;
}

static bool detectLogoRoi(
    const std::string& input,
    double fps,
    int maxFrames,
    int edgeThreshold,
    double persistence,
    AutoRoiResult& result)
{
    int sourceW = 0;
    int sourceH = 0;

    if (!getVideoSize(input, sourceW, sourceH)) {
        std::cerr << "auto-roi: cannot determine video size\n";
        return false;
    }

    // detect-logo-roi.cpp で検証済みの解析解像度。
    const int W = 720;
    const int H = 540;
    const size_t frameSize = size_t(W) * size_t(H);

    std::vector<uint8_t> frame(frameSize);
    std::vector<unsigned short> edgeCount(frameSize, 0);

    char fpsbuf[64];
    std::snprintf(fpsbuf, sizeof(fpsbuf), "%.8f", fps);

    std::string filter =
        "fps=" + std::string(fpsbuf) +
        ",scale=" + std::to_string(W) + ":" + std::to_string(H);

    std::string cmd =
        "ffmpeg -hide_banner -loglevel error -i " +
        shellQuote(input) +
        " -an -sn -dn -vf " +
        shellQuote(filter) +
        " -frames:v " + std::to_string(maxFrames) +
        " -pix_fmt gray -f rawvideo -";

    std::cerr
        << "auto-roi source: " << sourceW << "x" << sourceH << "\n"
        << "auto-roi analysis: " << W << "x" << H
        << ", fps=" << fps
        << ", maxFrames=" << maxFrames << "\n";

    FILE* fp = popen(cmd.c_str(), "r");
    if (!fp) {
        perror("popen");
        return false;
    }

    int frames = 0;

    while (frames < maxFrames) {
        size_t got = fread(frame.data(), 1, frameSize, fp);
        if (got == 0)
            break;
        if (got != frameSize) {
            std::cerr << "auto-roi: short raw frame\n";
            break;
        }

        for (int yy = 1; yy < H - 1; ++yy) {
            for (int xx = 1; xx < W - 1; ++xx) {
                size_t o = size_t(xx) + size_t(yy) * W;
                int gx = std::abs(int(frame[o + 1]) - int(frame[o - 1]));
                int gy = std::abs(int(frame[o + W]) - int(frame[o - W]));
                if (gx + gy >= edgeThreshold)
                    ++edgeCount[o];
            }
        }

        ++frames;
    }

    pclose(fp);

    if (frames < 10) {
        std::cerr << "auto-roi: not enough frames: " << frames << "\n";
        return false;
    }

    // 日本のテレビ局ウォーターマークを主対象として右上を探索。
    const int searchX0 = int(W * 0.65);
    const int searchX1 = W - 2;
    const int searchY0 = 2;
    const int searchY1 = int(H * 0.30);

    const int minCount = std::max(
        3,
        int(std::ceil(frames * persistence))
    );

    std::vector<uint8_t> fixed(frameSize, 0);
    int fixedPixels = 0;

    for (int yy = searchY0; yy <= searchY1; ++yy) {
        for (int xx = searchX0; xx <= searchX1; ++xx) {
            size_t o = size_t(xx) + size_t(yy) * W;
            if (edgeCount[o] >= minCount) {
                fixed[o] = 1;
                ++fixedPixels;
            }
        }
    }

    std::cerr
        << "auto-roi frames=" << frames
        << " fixedPixels=" << fixedPixels
        << " minCount=" << minCount << "\n";

    std::vector<uint8_t> dilated = fixed;
    const int radius = 3;

    for (int yy = searchY0; yy <= searchY1; ++yy) {
        for (int xx = searchX0; xx <= searchX1; ++xx) {
            size_t o = size_t(xx) + size_t(yy) * W;
            if (!fixed[o])
                continue;

            for (int dy = -radius; dy <= radius; ++dy) {
                int y2 = yy + dy;
                if (y2 < searchY0 || y2 > searchY1)
                    continue;

                for (int dx = -radius; dx <= radius; ++dx) {
                    int x2 = xx + dx;
                    if (x2 < searchX0 || x2 > searchX1)
                        continue;
                    dilated[size_t(x2) + size_t(y2) * W] = 1;
                }
            }
        }
    }

    std::vector<uint8_t> visited(frameSize, 0);
    AutoRoiComponent best {};
    bool haveBest = false;
    double bestScore = -1.0;

    const int dirs[4][2] = {
        { 1, 0 }, {-1, 0}, { 0, 1 }, { 0,-1 }
    };

    for (int sy = searchY0; sy <= searchY1; ++sy) {
        for (int sx = searchX0; sx <= searchX1; ++sx) {
            size_t so = size_t(sx) + size_t(sy) * W;
            if (!dilated[so] || visited[so])
                continue;

            std::queue<std::pair<int,int>> q;
            q.push({sx, sy});
            visited[so] = 1;

            AutoRoiComponent c {sx, sy, sx, sy, 0, 0.0};

            while (!q.empty()) {
                auto [xx, yy] = q.front();
                q.pop();

                c.minX = std::min(c.minX, xx);
                c.maxX = std::max(c.maxX, xx);
                c.minY = std::min(c.minY, yy);
                c.maxY = std::max(c.maxY, yy);

                size_t o = size_t(xx) + size_t(yy) * W;
                if (fixed[o]) {
                    ++c.pixels;
                    c.persistenceSum += double(edgeCount[o]) / frames;
                }

                for (const auto& d : dirs) {
                    int nx = xx + d[0];
                    int ny = yy + d[1];
                    if (nx < searchX0 || nx > searchX1 ||
                        ny < searchY0 || ny > searchY1)
                        continue;

                    size_t no = size_t(nx) + size_t(ny) * W;
                    if (visited[no] || !dilated[no])
                        continue;

                    visited[no] = 1;
                    q.push({nx, ny});
                }
            }

            if (c.pixels < 4)
                continue;

            int cw = c.maxX - c.minX + 1;
            int ch = c.maxY - c.minY + 1;

            if (cw < 4 || ch < 4)
                continue;
            if (cw > W * 0.25 || ch > H * 0.18)
                continue;

            double avgPersistence = c.persistenceSum / c.pixels;
            double rightBonus = 1.0 + 0.25 * double(c.maxX) / W;
            double topBonus = 1.0 + 0.15 * (1.0 - double(c.minY) / H);
            double score =
                c.pixels * avgPersistence * rightBonus * topBonus;

            if (score > bestScore) {
                bestScore = score;
                best = c;
                haveBest = true;
            }
        }
    }

    if (!haveBest) {
        std::cerr << "auto-roi: logo candidate not found\n";
        return false;
    }

    int lx = std::max(searchX0, best.minX + radius - 5);
    int ly = std::max(searchY0, best.minY + radius - 5);
    int rx = std::min(W - 1, best.maxX - radius + 5);
    int by = std::min(H - 1, best.maxY - radius + 5);

    double scaleX = double(sourceW) / W;
    double scaleY = double(sourceH) / H;

    int x = int(std::floor(lx * scaleX));
    int y = int(std::floor(ly * scaleY));
    int w = int(std::ceil((rx - lx + 1) * scaleX));
    int h = int(std::ceil((by - ly + 1) * scaleY));

    x &= ~1;
    y &= ~1;
    w = (w + 1) & ~1;
    h = (h + 1) & ~1;

    if (x + w > sourceW)
        w = (sourceW - x) & ~1;
    if (y + h > sourceH)
        h = (sourceH - y) & ~1;

    if (x < 0 || y < 0 || w <= 0 || h <= 0) {
        std::cerr << "auto-roi: invalid detected ROI\n";
        return false;
    }

    std::cerr
        << "auto-roi candidate score=" << bestScore
        << " detector=(" << best.minX << "," << best.minY << ")-("
        << best.maxX << "," << best.maxY << ")\n"
        << "auto-roi selected: x=" << x
        << " y=" << y
        << " w=" << w
        << " h=" << h << "\n";

    result.x = x;
    result.y = y;
    result.w = w;
    result.h = h;
    result.score = bestScore;
    return true;
}


static int writeLogoPreview(
    const std::string& input,
    const std::string& output)
{
    std::ifstream ifs(input, std::ios::binary);
    if (!ifs) {
        std::cerr
            << "cannot open logo input: "
            << input << "\n";
        return 1;
    }

    LogoFileHeader fh {};
    LogoHeader lh {};

    ifs.read(
        reinterpret_cast<char*>(&fh),
        sizeof(fh)
    );
    ifs.read(
        reinterpret_cast<char*>(&lh),
        sizeof(lh)
    );

    if (!ifs) {
        std::cerr
            << "invalid logo file: header is too short\n";
        return 1;
    }

    const char magic[] =
        "<logo data file ver0.1>";

    if (std::memcmp(
            fh.magic,
            magic,
            sizeof(magic) - 1) != 0) {
        std::cerr
            << "invalid logo file: bad magic\n";
        return 1;
    }

    const int w = int(lh.w);
    const int h = int(lh.h);

    if (
        w <= 0 ||
        h <= 0 ||
        w > 4096 ||
        h > 4096
    ) {
        std::cerr
            << "invalid logo size: "
            << w << "x" << h << "\n";
        return 1;
    }

    const size_t pixelCount =
        size_t(w) * size_t(h);

    std::vector<LogoPixel> pixels(
        pixelCount
    );

    ifs.read(
        reinterpret_cast<char*>(
            pixels.data()
        ),
        pixels.size() *
            sizeof(LogoPixel)
    );

    if (!ifs) {
        std::cerr
            << "invalid logo file: pixel data is too short\n";
        return 1;
    }

    std::ofstream fileOutput;
    std::ostream* out = nullptr;

    if (output == "-") {
        out = &std::cout;
    } else {
        fileOutput.open(
            output,
            std::ios::binary
        );

        if (!fileOutput) {
            std::cerr
                << "cannot open preview output: "
                << output << "\n";
            return 1;
        }

        out = &fileOutput;
    }

    (*out)
        << "P5\n"
        << w << " " << h << "\n"
        << "255\n";

    for (const LogoPixel& p : pixels) {
        int alpha = int(p.dp_y);

        if (alpha < 0) {
            alpha = 0;
        } else if (alpha > 1000) {
            alpha = 1000;
        }

        const unsigned char gray =
            static_cast<unsigned char>(
                (alpha * 255 + 500) /
                1000
            );

        out->write(
            reinterpret_cast<
                const char*
            >(&gray),
            1
        );
    }

    if (!(*out)) {
        std::cerr
            << "failed to write preview: "
            << output << "\n";
        return 1;
    }

    std::cerr
        << "preview created: "
        << output << "\n";

    std::cerr
        << "logo name: "
        << lh.name << "\n";

    std::cerr
        << "logo position: "
        << lh.x << ","
        << lh.y << "\n";

    std::cerr
        << "logo size: "
        << w << "x" << h << "\n";

    return 0;
}

int main(int argc, char** argv) {
    std::string input;
    std::string output;
    std::string name = "Logo";

    int x = -1, y = -1, w = -1, h = -1;
    int threshold = 12;
    double fps = 0.2;
    int maxFrames = 500;

    bool autoRoi = false;
    bool previewMode = false;
    double roiFps = 0.05;
    int roiMaxFrames = 120;
    int roiEdgeThreshold = 10;
    double roiPersistence = 0.45;

    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];

        auto next = [&]() -> std::string {
            if (++i >= argc) {
                std::cerr << "missing value after " << a << "\n";
                std::exit(2);
            }
            return argv[i];
        };

        if (a == "--preview") {
            previewMode = true;
            input = next();
        }
        else if (a == "-i") input = next();
        else if (a == "-o") output = next();
        else if (a == "--name") name = next();
        else if (a == "--x") x = std::stoi(next());
        else if (a == "--y") y = std::stoi(next());
        else if (a == "--w") w = std::stoi(next());
        else if (a == "--h") h = std::stoi(next());
        else if (a == "--threshold") threshold = std::stoi(next());
        else if (a == "--fps") fps = std::stod(next());
        else if (a == "--max-frames") maxFrames = std::stoi(next());
        else if (a == "--auto-roi") autoRoi = true;
        else if (a == "--roi-fps") roiFps = std::stod(next());
        else if (a == "--roi-max-frames") roiMaxFrames = std::stoi(next());
        else if (a == "--roi-edge-threshold") roiEdgeThreshold = std::stoi(next());
        else if (a == "--roi-persistence") roiPersistence = std::stod(next());
        else {
            std::cerr << "unknown option: " << a << "\n";
            return 2;
        }
    }

    if (input.empty() || output.empty()) {
        std::cerr
            << "usage:\n"
            << "  genlogo --preview INPUT.lgd -o OUTPUT.pgm\n"
            << "  genlogo --preview INPUT.lgd -o -  # PGM to stdout\n"
            << "  genlogo -i INPUT -o OUTPUT --x X --y Y --w W --h H "
            << "[--name CX] [--fps 0.2] [--threshold 12] [--max-frames 500]\n"
            << "  genlogo -i INPUT -o OUTPUT --auto-roi "
            << "[--name CX] [--fps 0.2] [--threshold 12] [--max-frames 500] "
            << "[--roi-fps 0.05] [--roi-max-frames 120] "
            << "[--roi-edge-threshold 10] [--roi-persistence 0.45]\n";
        return 2;
    }

    if (previewMode) {
        return writeLogoPreview(
            input,
            output
        );
    }

    const bool manualRoiSpecified =
        x >= 0 || y >= 0 || w > 0 || h > 0;

    double videoDuration = 0.0;
    if (getVideoDuration(input, videoDuration)) {
        std::cerr
            << "video duration: "
            << videoDuration
            << " sec\n";

        // 短時間録画では固定fpsだと解析フレームが不足するため、
        // 最大60フレーム程度を動画全体から均等に取得する。
        if (videoDuration <= 120.0) {
            const double shortVideoFps =
                std::min(1.0, 60.0 / videoDuration);

            roiFps = std::max(roiFps, shortVideoFps);
            fps = std::max(fps, shortVideoFps);

            std::cerr
                << "short-video sampling: roiFps="
                << roiFps
                << ", fps="
                << fps
                << "\n";
        }
    } else {
        std::cerr
            << "warning: cannot determine video duration; "
            << "using default sampling rates\n";
    }

    if (autoRoi && manualRoiSpecified) {
        std::cerr
            << "--auto-roi cannot be combined with --x/--y/--w/--h\n";
        return 2;
    }

    if (autoRoi) {
        if (roiFps <= 0.0 || roiMaxFrames <= 0 ||
            roiEdgeThreshold < 0 ||
            roiPersistence <= 0.0 || roiPersistence > 1.0) {
            std::cerr << "invalid auto-roi parameters\n";
            return 2;
        }

        AutoRoiResult roi;
        if (!detectLogoRoi(
                input,
                roiFps,
                roiMaxFrames,
                roiEdgeThreshold,
                roiPersistence,
                roi)) {
            std::cerr << "auto-roi detection failed\n";
            return 4;
        }

        x = roi.x;
        y = roi.y;
        w = roi.w;
        h = roi.h;
    } else if (x < 0 || y < 0 || w <= 0 || h <= 0) {
        std::cerr
            << "manual ROI requires --x X --y Y --w W --h H; "
            << "or use --auto-roi\n";
        return 2;
    }

    // YUV420のため偶数にする
    x &= ~1;
    y &= ~1;
    w &= ~1;
    h &= ~1;

    const int uw = w / 2;
    const int uh = h / 2;

    const size_t ySize = size_t(w) * h;
    const size_t uSize = size_t(uw) * uh;
    const size_t frameSize = ySize + uSize * 2;

    std::vector<LogoColor> ly(ySize);
    std::vector<LogoColor> lu(uSize);
    std::vector<LogoColor> lv(uSize);

    std::vector<uint8_t> frame(frameSize);

    // Amatsukaze は初回 LogoScan を通過したフレームを保存し、
    // ReMakeLogo() で同じフレームを再評価する。
    // ROI は小さいので UtVideo を使わず RAM に保持する。
    std::vector<std::vector<uint8_t>> candidateFrames;
    candidateFrames.reserve(maxFrames);

    char fpsbuf[64];
    std::snprintf(fpsbuf, sizeof(fpsbuf), "%.8f", fps);

    std::string cmd =
        "ffmpeg -hide_banner -loglevel error -i " +
        shellQuote(input) +
        " -an -sn -dn -vf " +
        shellQuote(
            "fps=" + std::string(fpsbuf) +
            ",crop=" +
            std::to_string(w) + ":" +
            std::to_string(h) + ":" +
            std::to_string(x) + ":" +
            std::to_string(y)
        ) +
        " -pix_fmt yuv420p -f rawvideo -";

    std::cerr << "decode: " << w << "x" << h
              << " at (" << x << "," << y << ")\n";

    FILE* fp = popen(cmd.c_str(), "r");
    if (!fp) {
        perror("popen");
        return 1;
    }

    int accepted = 0;
    int readFrames = 0;

    while (readFrames < maxFrames) {
        size_t got = fread(frame.data(), 1, frameSize, fp);
        if (got == 0)
            break;
        if (got != frameSize) {
            std::cerr << "short raw frame\n";
            break;
        }

        ++readFrames;

        uint8_t* py = frame.data();
        uint8_t* pu = py + ySize;
        uint8_t* pv = pu + uSize;

        std::vector<int> by;
        std::vector<int> bu;
        std::vector<int> bv;

        by.reserve((w + h) * 2);
        bu.reserve((uw + uh) * 2);
        bv.reserve((uw + uh) * 2);

        for (int xx = 0; xx < w; ++xx) {
            by.push_back(py[xx]);
            by.push_back(py[xx + (h - 1) * w]);
        }
        for (int yy = 1; yy < h - 1; ++yy) {
            by.push_back(py[yy * w]);
            by.push_back(py[w - 1 + yy * w]);
        }

        for (int xx = 0; xx < uw; ++xx) {
            bu.push_back(pu[xx]);
            bu.push_back(pu[xx + (uh - 1) * uw]);
            bv.push_back(pv[xx]);
            bv.push_back(pv[xx + (uh - 1) * uw]);
        }

        for (int yy = 1; yy < uh - 1; ++yy) {
            bu.push_back(pu[yy * uw]);
            bu.push_back(pu[uw - 1 + yy * uw]);
            bv.push_back(pv[yy * uw]);
            bv.push_back(pv[uw - 1 + yy * uw]);
        }

        if (!rangeOK(by, threshold) ||
            !rangeOK(bu, threshold) ||
            !rangeOK(bv, threshold))
            continue;

        int bgY = medianMiddle(by);
        int bgU = medianMiddle(bu);
        int bgV = medianMiddle(bv);

        for (size_t i = 0; i < ySize; ++i)
            ly[i].add(py[i], bgY);

        for (size_t i = 0; i < uSize; ++i) {
            lu[i].add(pu[i], bgU);
            lv[i].add(pv[i], bgV);
        }

        candidateFrames.emplace_back(frame.begin(), frame.end());

        ++accepted;

        if ((accepted % 10) == 0)
            std::cerr << "accepted frames: " << accepted << "\n";
    }

    int status = pclose(fp);
    (void)status;

    std::cerr << "read frames: " << readFrames << "\n";
    std::cerr << "accepted frames: " << accepted << "\n";

    if (accepted < 10) {
        std::cerr
            << "not enough uniform-background frames; "
            << "ROI or threshold needs adjustment\n";
        return 3;
    }

    std::vector<float> ay(ySize), byi(ySize);
    std::vector<float> au(uSize), bui(uSize);
    std::vector<float> av(uSize), bvi(uSize);

    for (size_t i = 0; i < ySize; ++i) {
        if (!ly[i].getAB(accepted, ay[i], byi[i])) {
            ay[i] = 1;
            byi[i] = 0;
        }
    }

    for (size_t i = 0; i < uSize; ++i) {
        if (!lu[i].getAB(accepted, au[i], bui[i])) {
            au[i] = 1;
            bui[i] = 0;
        }
        if (!lv[i].getAB(accepted, av[i], bvi[i])) {
            av[i] = 1;
            bvi[i] = 0;
        }
    }

    {
        double minA = 1e100;
        double maxA = -1e100;
        double sumA = 0.0;
        size_t n = 0;

        size_t lt099 = 0;
        size_t lt095 = 0;
        size_t lt090 = 0;
        size_t lt080 = 0;

        for (float a : ay) {
            if (!std::isfinite(a)) continue;

            minA = std::min(minA, double(a));
            maxA = std::max(maxA, double(a));
            sumA += a;
            ++n;

            if (a < 0.99f) ++lt099;
            if (a < 0.95f) ++lt095;
            if (a < 0.90f) ++lt090;
            if (a < 0.80f) ++lt080;
        }

        std::cerr << "===== regression Y =====\n";
        std::cerr << "A min     : " << minA << "\n";
        std::cerr << "A max     : " << maxA << "\n";
        std::cerr << "A average : " << (n ? sumA / n : 0.0) << "\n";
        std::cerr << "A < 0.99  : " << lt099 << " / " << n << "\n";
        std::cerr << "A < 0.95  : " << lt095 << " / " << n << "\n";
        std::cerr << "A < 0.90  : " << lt090 << " / " << n << "\n";
        std::cerr << "A < 0.80  : " << lt080 << " / " << n << "\n";
    }

    {
        double minA = 1e100;
        double maxA = -1e100;
        double sumA = 0.0;
        size_t n = 0;

        size_t lt099 = 0;
        size_t lt095 = 0;
        size_t lt090 = 0;
        size_t lt080 = 0;

        for (float a : ay) {
            if (!std::isfinite(a)) continue;

            minA = std::min(minA, double(a));
            maxA = std::max(maxA, double(a));
            sumA += a;
            ++n;

            if (a < 0.99f) ++lt099;
            if (a < 0.95f) ++lt095;
            if (a < 0.90f) ++lt090;
            if (a < 0.80f) ++lt080;
        }

        std::cerr << "===== regression Y =====\n";
        std::cerr << "A min     : " << minA << "\n";
        std::cerr << "A max     : " << maxA << "\n";
        std::cerr << "A average : " << (n ? sumA / n : 0.0) << "\n";
        std::cerr << "A < 0.99  : " << lt099 << " / " << n << "\n";
        std::cerr << "A < 0.95  : " << lt095 << " / " << n << "\n";
        std::cerr << "A < 0.90  : " << lt090 << " / " << n << "\n";
        std::cerr << "A < 0.80  : " << lt080 << " / " << n << "\n";
    }


    /*
     * Amatsukaze ReMakeLogo() 相当。
     *
     * 初期ロゴで各 candidate frame の fade を評価し、
     * minFade > 8 のフレームだけを使って回帰を作り直す。
     * 本家同様これを2回行う。
     */
    for (int remakePass = 1; remakePass <= 2; ++remakePass) {
        LogoEvaluator evaluator(w, h, ay, byi);

        std::vector<LogoColor> nly(ySize);
        std::vector<LogoColor> nlu(uSize);
        std::vector<LogoColor> nlv(uSize);

        int selected = 0;

        std::array<int, 20> fadeHistogram {};
        std::vector<float> deint;

        for (const auto& f : candidateFrames) {
            const uint8_t* py = f.data();
            const uint8_t* pu = py + ySize;
            const uint8_t* pv = pu + uSize;

            LogoEvaluator::deintY(deint, py, w, h);

            double bestScore = HUGE_VAL;
            int bestFade = 0;

            for (int fi = 0; fi < 20; ++fi) {
                double fade = fi * 0.1;
                double score = std::abs(
                    evaluator.evaluate(deint, fade)
                );

                if (score < bestScore) {
                    bestScore = score;
                    bestFade = fi;
                }
            }

            ++fadeHistogram[size_t(bestFade)];

            // Amatsukaze: if (minFades[i] > 8)
            if (bestFade <= 8)
                continue;

            /*
             * 元の candidate frame は初回 uniform-background
             * 判定を通過しているため、背景推定方法も初回と揃える。
             */
            std::vector<int> by;
            std::vector<int> bu;
            std::vector<int> bv;

            by.reserve((w + h) * 2);
            bu.reserve((uw + uh) * 2);
            bv.reserve((uw + uh) * 2);

            for (int xx = 0; xx < w; ++xx) {
                by.push_back(py[xx]);
                by.push_back(py[xx + (h - 1) * w]);
            }

            for (int yy = 1; yy < h - 1; ++yy) {
                by.push_back(py[yy * w]);
                by.push_back(py[w - 1 + yy * w]);
            }

            for (int xx = 0; xx < uw; ++xx) {
                bu.push_back(pu[xx]);
                bu.push_back(pu[xx + (uh - 1) * uw]);

                bv.push_back(pv[xx]);
                bv.push_back(pv[xx + (uh - 1) * uw]);
            }

            for (int yy = 1; yy < uh - 1; ++yy) {
                bu.push_back(pu[yy * uw]);
                bu.push_back(pu[uw - 1 + yy * uw]);

                bv.push_back(pv[yy * uw]);
                bv.push_back(pv[uw - 1 + yy * uw]);
            }

            // Amatsukaze LogoScan::AddFrame() と同じく、
            // fade判定を通ったフレームでも外周が単一色でなければ
            // ReMake用の再回帰には追加しない。
            if (!rangeOK(by, threshold) ||
                !rangeOK(bu, threshold) ||
                !rangeOK(bv, threshold))
                continue;

            int bgY = medianMiddle(by);
            int bgU = medianMiddle(bu);
            int bgV = medianMiddle(bv);

            for (size_t i = 0; i < ySize; ++i)
                nly[i].add(py[i], bgY);

            for (size_t i = 0; i < uSize; ++i) {
                nlu[i].add(pu[i], bgU);
                nlv[i].add(pv[i], bgV);
            }

            ++selected;
        }

        std::cerr
            << "===== remake pass "
            << remakePass
            << " =====\n";

        std::cerr << "fade histogram:";
        for (int i = 0; i < 20; ++i)
            std::cerr << " " << i << ":" << fadeHistogram[size_t(i)];
        std::cerr << "\n";

        std::cerr
            << "selected logo frames: "
            << selected
            << " / "
            << candidateFrames.size()
            << "\n";

        if (selected < 10) {
            std::cerr
                << "remake aborted: insufficient logo-on frames\n";
            break;
        }

        for (size_t i = 0; i < ySize; ++i) {
            if (!nly[i].getAB(selected, ay[i], byi[i])) {
                ay[i] = 1;
                byi[i] = 0;
            }
        }

        for (size_t i = 0; i < uSize; ++i) {
            if (!nlu[i].getAB(selected, au[i], bui[i])) {
                au[i] = 1;
                bui[i] = 0;
            }

            if (!nlv[i].getAB(selected, av[i], bvi[i])) {
                av[i] = 1;
                bvi[i] = 0;
            }
        }

        // Amatsukaze:
        //   logoscan.Normalize(255);
        //   logodata = logoscan.GetLogo(true);
        //
        // getAB() 内で Normalize(255) 相当まで済んでいるため、
        // ここでは GetLogo(true) の clean 部分だけを適用する。
        debugLogoABDist(
            ay, byi,
            au, bui,
            av, bvi,
            w, h, uw
        );

        cleanLogo(
            ay, byi,
            au, bui,
            av, bvi,
            w, h, uw
        );
    }

    std::vector<LogoPixel> pixels(ySize);

    for (int yy = 0; yy < h; ++yy) {
        for (int xx = 0; xx < w; ++xx) {
            size_t yo = size_t(xx) + size_t(yy) * w;
            size_t uo = size_t(xx / 2) + size_t(yy / 2) * uw;

            LogoPixel p {};
            convertY(ay[yo], byi[yo], p.dp_y, p.y);
            convertC(au[uo], bui[uo], p.dp_cb, p.cb);
            convertC(av[uo], bvi[uo], p.dp_cr, p.cr);

            pixels[yo] = p;
        }
    }

    std::ofstream ofs(output, std::ios::binary);
    if (!ofs) {
        std::cerr << "cannot open output: " << output << "\n";
        return 1;
    }

    LogoFileHeader fh {};
    const char magic[] = "<logo data file ver0.1>";
    std::memcpy(fh.magic, magic, sizeof(magic) - 1);
    fh.countBE = be32(1);

    LogoHeader lh {};
    std::strncpy(lh.name, name.c_str(), sizeof(lh.name) - 1);
    lh.x = int16_t(x);
    lh.y = int16_t(y);
    lh.h = int16_t(h);
    lh.w = int16_t(w);

    ofs.write(reinterpret_cast<const char*>(&fh), sizeof(fh));
    ofs.write(reinterpret_cast<const char*>(&lh), sizeof(lh));
    ofs.write(reinterpret_cast<const char*>(pixels.data()),
              pixels.size() * sizeof(LogoPixel));

    ofs.close();

    std::cerr << "created: " << output << "\n";
    std::cerr << "size: "
              << (sizeof(LogoFileHeader) +
                  sizeof(LogoHeader) +
                  pixels.size() * sizeof(LogoPixel))
              << " bytes\n";

    return 0;
}
