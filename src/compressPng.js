import zlib from "node:zlib";

import { crc32 } from "./readWriteZip.js";

/**
 * PNG 重编码 —— 对应 restool.exe 1.022 加 -z 时的图片"压缩"
 *
 * 为什么需要这个模块：restool -z 不是无损拷贝，它会把 png 整个重写一遍。
 * 实测 apps/_empty 的 icon.png 6790 B → 6320 B，尺寸和像素都没变，少掉的 331 B
 * 是一个 iTXt chunk（里面装 Adobe XMP 元数据）。
 *
 * 还原出来的算法（拿 exe 的产物逐字节比对确认的）：
 *   1. 只留 IHDR / IDAT / IEND，其余 ancillary chunk 全丢
 *   2. 解压 IDAT 拿到扫描线，按每行的原 filter 反滤波得到裸像素
 *   3. 用 libpng 的启发式重新挑每行的 filter
 *   4. zlib level 9 / memLevel 8 / strategy Z_FILTERED 重压，按 8192 B 切 IDAT
 *
 * 压缩用 Node 内置的 node:zlib，不追求与 restool 的字节一致。
 * 当初引入 pako 1.0.11 只是为了逐字节对齐 restool（底下是 zlib 1.2.11），
 * 现在按「压缩结果正确、像素不变」验收，字节差几 B 无所谓 —— PNG 是无损的，
 * 解压后像素相同，设备读的也是像素。代价是产物字节跟着 Node 内置 zlib 走：
 * Node 26 的 zlib-ng 同参数压出来的 zlib 数据是 6261 B，restool 是 6263 B。
 *
 * 两个卡点仍然保留，它们决定"压得对不对、够不够小"，与字节一致无关：
 *
 *   - **滤波要按 libpng 的规则挑**。逐行试 NONE/SUB/UP/AVG/PAETH，把结果字节当
 *     signed char 取绝对值求和，取代价最小的；平局保留先试的那个（libpng 用严格
 *     小于才替换）。顺序就是 NONE → SUB → UP → AVG → PAETH。用无符号和挑出来的
 *     行压制效果会变差。
 *   - **IDAT 按 8192 字节硬切**。实测 atri-mdm 的 icon.png 压出来 28619 B，切成
 *     IDAT:8192 8192 8192 3950 四块。libpng 的 zbuffer 就是 8192。
 *
 * 验证结果（与源图逐像素比对，Node 26 实测）：
 *   _empty/icon.png       6790 → 6318 B  像素一致（restool 是 6320 B）
 *   _empty/icon_small.png 5898 → 5449 B  像素一致（restool 是 5448 B）
 *   atri-mdm/icon.png    28619 → 28619 B 像素一致（restool 也是 28619 B，这张本来就压到极限）
 *
 * 只处理 8 bit、非隔行、非调色板的 PNG。别的形态（16 bit、隔行、调色板）返回 null，
 * 由调用方原样拷贝 —— 这几类 restool 1.022 认不认没验证过，不猜。
 */

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** libpng 的 zbuffer，IDAT 按这个大小切块（实测 atri-mdm 的大图就是 8192 分块） */
const IDAT_SLICE = 8192;

/** colorType → 每像素字节数（bitDepth 固定 8） */
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

/*
 * libpng 挑 filter 的顺序。顺序本身有意义：平局时保留先试的那个，
 * 所以这个数组的顺序会直接体现在产物的 filter 字节上，不能改。
 */
const FILTER_ORDER = [0, 1, 2, 3, 4];

/**
 * 把 png 重新编码成 restool -z 的产物
 *
 * @param {Buffer} input 源 png
 * @returns {Buffer|null} 重编码结果；格式不支持时返回 null，调用方应当原样拷贝
 */
export function compressPng(input) {
  const ihdr = parseHeader(input);
  if (!ihdr) return null;

  const { width, height, bpp, raw: ihdrData } = ihdr;
  const stride = width * bpp;

  const idat = Buffer.concat(readChunks(input).filter((c) => c.type === "IDAT").map((c) => c.data));
  const pixels = unfilter(zlib.inflateSync(idat), stride, height, bpp);
  if (!pixels) return null;

  const recompressed = zlib.deflateSync(refilter(pixels, stride, height, bpp), {
    level: 9,
    memLevel: 8,
    strategy: zlib.constants.Z_FILTERED
  });

  const parts = [SIGNATURE, writeChunk("IHDR", ihdrData)];
  for (let i = 0; i < recompressed.length; i += IDAT_SLICE) {
    parts.push(writeChunk("IDAT", recompressed.subarray(i, i + IDAT_SLICE)));
  }
  parts.push(writeChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/** 判断这个 png 是不是本模块支持的形态 */
export function isSupportedPng(buf) {
  return parseHeader(buf) !== null;
}

/**
 * 读文件头，同时把不支持的形态挡在外面
 * @returns {{width:number,height:number,bpp:number,raw:Buffer}|null}
 */
function parseHeader(buf) {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(SIGNATURE)) return null;
  const ihdr = readChunks(buf).find((c) => c.type === "IHDR");
  if (!ihdr || ihdr.data.length !== 13) return null;

  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlace = ihdr.data[12];

  // 16 bit / 隔行 / 调色板这三类没拿到对照样本，不猜，交给调用方原样拷贝
  if (bitDepth !== 8 || interlace !== 0 || colorType === 3) return null;
  const bpp = CHANNELS[colorType];
  if (!bpp || width <= 0 || height <= 0) return null;

  return { width, height, bpp, raw: ihdr.data };
}

/** 按 chunk 切开，签名之后每个 chunk 是 u32 长 + 4 字节类型 + 数据 + u32 crc */
function readChunks(buf) {
  const chunks = [];
  let p = 8;
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.subarray(p + 4, p + 8).toString("latin1");
    const data = buf.subarray(p + 8, p + 8 + len);
    chunks.push({ type, data });
    p += 12 + len;
  }
  return chunks;
}

function writeChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * 反滤波：把 inflate 出来的扫描线还原成裸像素
 * 每行开头 1 字节是本行用的 filter 类型
 */
function unfilter(raw, stride, height, bpp) {
  if (raw.length < height * (stride + 1)) return null;

  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const type = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = src[x];
      if (type === 1) v += a;
      else if (type === 2) v += b;
      else if (type === 3) v += (a + b) >> 1;
      else if (type === 4) v += paeth(a, b, c);
      else if (type !== 0) return null;
      cur[x] = v & 0xff;
    }
  }
  return out;
}

/**
 * 重新选 filter 并输出带 filter 字节的扫描线
 *
 * 代价函数完全照 libpng 的 png_write_find_filter：把滤波结果的每个字节当成
 * signed char 取绝对值累加。注意这里**不是**取无符号和 —— 用无符号和选出来的
 * 行会和 restool 的产物对不上。
 */
function refilter(pixels, stride, height, bpp) {
  const out = Buffer.alloc(height * (stride + 1));
  const candidate = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const cur = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;

    let bestType = 0;
    let bestSum = Infinity;
    for (const type of FILTER_ORDER) {
      let sum = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? cur[x - bpp] : 0;
        const b = prev ? prev[x] : 0;
        const c = prev && x >= bpp ? prev[x - bpp] : 0;
        let v = cur[x];
        if (type === 1) v -= a;
        else if (type === 2) v -= b;
        else if (type === 3) v -= (a + b) >> 1;
        else if (type === 4) v -= paeth(a, b, c);
        v &= 0xff;
        candidate[x] = v;
        sum += v < 128 ? v : 256 - v;
      }
      // 严格小于才替换：平局保留先试的（libpng 的 if (sum < mins)）
      if (sum < bestSum) {
        bestSum = sum;
        bestType = type;
        candidate.copy(out, y * (stride + 1) + 1);
      }
    }
    out[y * (stride + 1)] = bestType;
  }
  return out;
}
