import { writeZip, readZip } from "../zip/index.js";

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
  if (!binFileName) throw new Error("必须指定 .bin 在包内的文件名");
  return writeZip([{ name: binFileName, content: binBuf }], { compress: false });
}

/**
 * 从 hap 里取出 .bin
 * @param {Buffer} hapBuf
 * @returns {{ binFileName:string, binBuf:Buffer, entries:Array }}
 */
export function unpackHap(hapBuf) {
  const entries = readZip(hapBuf);
  const bin = entries.find((e) => !e.name.endsWith("/") && e.name.toLowerCase().endsWith(".bin"));
  if (!bin) {
    throw new Error(
      `hap 里没有 .bin，实际有 ${entries.length} 个条目：${entries.slice(0, 6).map((e) => e.name).join(", ")}` +
        "（这是文件目录形态的 hap，用 readZip 直接读）"
    );
  }
  return { binFileName: bin.name, binBuf: bin.content, entries };
}

/**
 * 判断 hap 是哪种形态
 * @returns {"bin" | "tree"}
 */
export function hapForm(hapBuf) {
  const entries = readZip(hapBuf);
  const has = entries.some((e) => e.name.toLowerCase().endsWith(".bin"));
  return has && entries.length === 1 ? "bin" : "tree";
}
