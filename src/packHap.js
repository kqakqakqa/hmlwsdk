import { writeZip } from "./readWriteZip.js";

/**
 * 把 .bin 打成 hap
 *
 * 实测依据（apps/_empty/_empty 与 apps/_inactive/stock）：
 *   hap 是标准 zip，里面只放一个 .bin，且用 stored（不压缩）。
 *
 * @param {Buffer} binBuf       .bin 内容
 * @param {string} binFileName  放进 zip 里的文件名，例如 entry-debug-unsigned.bin
 * @returns {Buffer} hap
 */
export function packHap(binBuf, binFileName) {
  if (!binFileName) throw new Error("the file name of the .bin inside the hap is required");
  return writeZip([{ name: binFileName, content: binBuf }], { compress: false });
}
