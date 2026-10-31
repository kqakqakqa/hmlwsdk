import { SIGN_HEAD_ASCII } from "./read.js";

/**
 * 序列化为 .bin（未签名）
 * @param {{magic?:number, bundleName:string, entries:Array<{fileName:string, relPath:string, content:Buffer}>}} model
 * @returns {Buffer}
 */
export function writeBin(model) {
  const magic = model.magic ?? 0xbe;
  const bundleName = Buffer.from(model.bundleName, "utf8");

  const parts = [];

  const head = Buffer.allocUnsafe(5);
  head[0] = magic;
  head.writeInt32BE(bundleName.length, 1);
  parts.push(head);
  parts.push(bundleName);

  for (const e of model.entries) {
    const fileName = Buffer.from(e.fileName, "utf8");
    const relPath = Buffer.from(e.relPath ?? "", "utf8");
    const content = Buffer.isBuffer(e.content) ? e.content : Buffer.from(e.content);

    const nameLen = Buffer.allocUnsafe(4);
    nameLen.writeInt32BE(fileName.length, 0);
    parts.push(nameLen, fileName);

    const pathLen = Buffer.allocUnsafe(4);
    pathLen.writeInt32BE(relPath.length, 0);
    parts.push(pathLen, relPath);

    const sizeLen = Buffer.allocUnsafe(8);
    sizeLen.writeBigUInt64BE(BigInt(content.length), 0);
    parts.push(sizeLen, content);
  }

  return Buffer.concat(parts);
}

/**
 * 给 .bin 追加签名尾巴。
 *
 * 注意：这里只追加 signHead 标记，不生成真实证书签名块。
 * 真机安装需要完整签名，这一层目前未实现。
 */
export function attachSignHeadTail(buf) {
  const head = Buffer.alloc(32, 0);
  head.write(SIGN_HEAD_ASCII, 0, "ascii");
  return Buffer.concat([buf, head]);
}
