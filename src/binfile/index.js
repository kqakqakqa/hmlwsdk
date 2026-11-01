import fs from "fs";

export { readBin, isSignedBin, stripSignature, SIGN_HEAD_ASCII } from "./read.js";
export { writeBin, attachSignHeadTail } from "./write.js";

/**
 * 从 .bin 提取成 { 相对路径 -> Buffer } 的映射，路径拼接规则与 hmlw.pages.dev 一致
 */
export function binToTree(buf) {
  const { bundleName, entries } = readBin(buf);
  const map = new Map();
  for (const e of entries) {
    const p = e.relPath === "" ? e.fileName : e.relPath.replace(/^\//, "") + "/" + e.fileName;
    map.set(p, e.content);
  }
  return { bundleName, files: map };
}
