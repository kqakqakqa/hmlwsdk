"use strict";
/**
 * JS 源码 → JRRY v24 字节码快照（真机 `.bc`）
 *
 * 为什么走 wasm 而不是调 jerry-snapshot.exe：
 *   exe 只有 Windows 版，而且属于 HarmonyOS SDK 的二进制。这里用 jerryscript v2.1.0 的原始
 *   源码、还原原本的编译开关编成 WebAssembly（构建命令见项目根 AGENTS.md），同一份 C 代码
 *   跑出来的快照与原生 exe 逐字节一致（devdemo 22 个真实 bundle 实测），
 *   但 Windows / macOS / Linux 都能跑，也不用 exec 起进程。
 *
 * 铁律：每次快照必须新建 emscripten 实例。
 *   同一实例上重复 callMain（＝反复 jerry_init / jerry_cleanup）时 jerry 内部堆不会清零，
 *   某些输入会污染后续快照的字面量表字节。实测来源：22 个页面 bundle 用同一实例顺序生成，
 *   前 2 个与原生一致、第 3 个起全部漂移（长度相同但 20 多个单字节不同）；每个文件新建
 *   实例后 22/22 逐字节一致。
 *   wasm 二进制只 fetch / 读盘一次，之后每个文件新建实例复用同一份字节。
 */
import fs from "node:fs";
import path from "node:path";
import createJerrySnapshot from "./jerry-snapshot.wasm.js";

const WASM_PATH = path.join(import.meta.dirname, "jerry-snapshot.wasm");

// wasm 字节只读一次，之后每个文件新建实例复用同一份（413 KB，不值得反复读盘）
let wasmBinaryCache = null;

function loadWasmBinary() {
  if (wasmBinaryCache === null) wasmBinaryCache = fs.readFileSync(WASM_PATH);
  return wasmBinaryCache;
}

/**
 * 把一段 JS 源码编成 `.bc`
 * @param {string} jsText JS 源码（webpack bundle 或页面 js 都行）
 * @returns {Promise<Buffer>} `.bc` 字节
 */
async function snapshotJs(jsText) {
  // 每次新建实例，实例之间堆和 FS 完全隔离。
  // print 静音：jerry-snapshot 会把 "Input file ... loaded." / "Created snapshot file ..."
  // 打到 stdout，那是给 CLI 看的，混进调用方输出里很吵。printErr 保留 —— 语法错误走它。
  const module = await createJerrySnapshot({ wasmBinary: loadWasmBinary(), print: () => {} });

  module.FS.writeFile("/in.js", jsText);
  let rc;
  try {
    // 与 ace-loader 的调用方式一致：jerry-snapshot generate -o <out> <in>
    rc = module.callMain(["generate", "-o", "/out.bc", "/in.js"]);
  } finally {
    try { module.FS.unlink("/in.js"); } catch (e) { /* 实例马上丢弃，删不掉也无所谓 */ }
  }
  if (rc !== 0) throw new Error("jerry-snapshot wasm 退出码 " + rc);

  const bc = Buffer.from(module.FS.readFile("/out.bc"));
  try { module.FS.unlink("/out.bc"); } catch (e) { /* 同上 */ }
  // 工具返回 0 不代表产物可用，出门前统一过一遍版本校验
  return checkSnapshot(bc);
}

/**
 * 校验 `.bc` 是不是设备认的 JRRY v24 快照
 *
 * 设备只认 version = 24（开头 `4a 52 52 59` + `18 00 00 00`），版本不对直接判死。
 *
 * @param {Buffer|Uint8Array} bc
 * @returns {Buffer} 原样返回，方便链式调用
 */
function checkSnapshot(bc) {
  if (!bc || bc.length < 8) throw new Error(".bc 太短，读不出头");
  const buf = Buffer.isBuffer(bc) ? bc : Buffer.from(bc);
  if (buf.readUInt32BE(0) !== 0x4a525259) {
    throw new Error(".bc 缺 JRRY 魔数，开头是 " + buf.subarray(0, 4).toString("hex"));
  }
  const version = buf.readUInt32LE(4);
  if (version !== 24) throw new Error(".bc 版本为 v" + version + "，设备只认 v24");
  return buf;
}

export { snapshotJs, checkSnapshot };
