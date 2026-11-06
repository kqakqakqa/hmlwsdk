import crypto from "crypto";

/**
 * 解 PKCS#12（.p12 / .pfx）取出私钥的 PKCS#8 PEM —— 纯 Node 内置，不引第三方库
 *
 * 为什么需要它：PEM 是私钥明文，crypto.createPrivateKey 直接读；而 PKCS#12 是
 * **加密容器**，私钥锁在里面。DevEco / AGC 导出的签名材料都是后者。
 *
 * 为什么不用现成的库：
 *   - Node 直到 26.10 才有 crypto.parsePKCS12()，更早的版本没有任何官方 API。
 *   - 试过 node-forge：它的 pkcs12 模块只认老式 PBE-SHA1-3DES，而华为 DevEco
 *     和 openssl 3 导出的 p12 都是 PBES2 + PBKDF2(HMAC-SHA256) + AES-256-CBC。
 *     实测 forge 能过 MAC 校验、却解不出内容（getBags 返回空对象）。
 *   - jsrsasign 只有 PKCS#8 层面的解析，没有 PFX 外层。
 *
 * 所以只自己写「解开外层 SafeContents」这一段 —— PBES2 用的就是标准 PBKDF2 +
 * AES-CBC，Node 内置足够；里面那个 EncryptedPrivateKeyInfo 直接交给
 * crypto.createPrivateKey({ format: "der", type: "pkcs8", passphrase })，
 * Node 本来就支持解 PKCS#8 的加密，不用自己碰。
 *
 * 实测对照（openssl 3.5 生成的 p12，密码 signing）：自解出的私钥导出成 PKCS#8 PEM，
 * 与 `openssl pkcs12 -nocerts -nodes` 的结果逐字节相同。华为的真实样本
 * （hap-sign-utils/cer/default.p12）结构完全一致，同样走这条路径。
 *
 * 结构（RFC 7292）：
 *   PFX               ::= SEQ { version, authSafe ContentInfo, macData }
 *   AuthenticatedSafe ::= SEQ OF ContentInfo
 *   ContentInfo       ::= SEQ { OID, [0] { ... } }      data 或 encryptedData
 *   SafeContents      ::= SEQ OF SafeBag
 *   SafeBag           ::= SEQ { bagId OID, [0] { value } }
 *     keyBag              1.2.840.113549.1.12.10.1.1  → PrivateKeyInfo（明文）
 *     pkcs8ShroudedKeyBag 1.2.840.113549.1.12.10.1.2  → EncryptedPrivateKeyInfo
 *
 * 实际文件里通常有两个 ContentInfo：私钥在 encryptedData 里，证书在另一个里。
 * 两个都扫，只管找私钥。
 */

const OID = {
  data: "1.2.840.113549.1.7.1",
  encryptedData: "1.2.840.113549.1.7.6",
  keyBag: "1.2.840.113549.1.12.10.1.1",
  shroudedKeyBag: "1.2.840.113549.1.12.10.1.2",
  pbes2: "1.2.840.113549.1.5.13",
  pbkdf2: "1.2.840.113549.1.5.12"
};

/** PBKDF2 的伪随机函数，OID → node 的 digest 名 */
const PRF = {
  "1.2.840.113549.2.7": "sha1",
  "1.2.840.113549.2.8": "sha224",
  "1.2.840.113549.2.9": "sha256",
  "1.2.840.113549.2.10": "sha384",
  "1.2.840.113549.2.11": "sha512"
};

/** 对称加密算法，OID → [node cipher 名, 密钥字节数] */
const CIPHER = {
  "2.16.840.1.101.3.4.1.2": ["aes-128-cbc", 16],
  "2.16.840.1.101.3.4.1.22": ["aes-192-cbc", 24],
  "2.16.840.1.101.3.4.1.42": ["aes-256-cbc", 32],
  "1.2.840.113549.3.7": ["des-ede3-cbc", 24]
};

/**
 * @param {Buffer} buf       .p12 / .pfx 文件内容
 * @param {string} password  私钥库密码
 * @returns {string} PKCS#8 的 PEM
 */
export function parseP12(buf, password) {
  const safeContents = [];

  // ── PFX → AuthenticatedSafe ──
  const pfx = readTlv(buf, 0);
  const authSafe = children(buf, pfx)[1];
  const asiOctet = children(buf, children(buf, authSafe)[1])[0];
  const asi = valueOf(buf, asiOctet);

  // ── 每个 ContentInfo 各解出一个 SafeContents ──
  for (const ci of children(asi, readTlv(asi, 0))) {
    const parts = children(asi, ci);
    const type = oidOf(asi, parts[0]);

    if (type === OID.data) {
      safeContents.push(valueOf(asi, children(asi, parts[1])[0]));
    } else if (type === OID.encryptedData) {
      safeContents.push(decryptContentInfo(asi, parts[1], password));
    }
  }

  // ── SafeContents 里找私钥 ──
  for (const contents of safeContents) {
    const root = readTlv(contents, 0);
    for (const bag of children(contents, root)) {
      const parts = children(contents, bag);
      const bagId = oidOf(contents, parts[0]);
      const bagValue = children(contents, parts[1])[0];
      const der = contents.subarray(bagValue.start, bagValue.end);

      if (bagId === OID.shroudedKeyBag) {
        return toPem(crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8", passphrase: password }));
      }
      if (bagId === OID.keyBag) {
        // 明文 PKCS#8，少见但规范允许
        return toPem(crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" }));
      }
    }
  }

  throw new Error("the bundle contains no private key (only certificates?)");
}

/**
 * 解开一个 encryptedData 类型的 ContentInfo，返回里面的 SafeContents
 *
 * 只认 PBES2：DevEco、openssl 3、Java 11+ 都用它。遇到老式的
 * PKCS#12 PBE（1.2.840.113549.1.12.1.x，3DES + 自己那套 KDF）直接报错说明原因，
 * 让用户转成 PEM —— 那套 KDF 要另写一遍，而现有样本里一次都没出现过。
 */
function decryptContentInfo(asi, wrapped, password) {
  const encData = children(asi, wrapped)[0];
  const eci = children(asi, encData)[1];
  const parts = children(asi, eci);
  const algId = children(asi, parts[1]);
  const algOid = oidOf(asi, algId[0]);

  if (algOid !== OID.pbes2) {
    throw new Error(
      `unsupported PKCS#12 encryption algorithm ${algOid} — only PBES2 is handled ` +
        "(DevEco / openssl 3 / Java 11+ all use PBES2). " +
        "convert it once with: openssl pkcs12 -in x.p12 -nocerts -nodes -out signing.pem"
    );
  }

  const pbes2 = children(asi, algId[1]);

  // PBKDF2 参数：salt、iterationCount、[keyLength]、[prf]
  const kdf = children(asi, pbes2[0]);
  const kdfParams = children(asi, kdf[1]);
  const salt = Buffer.from(valueOf(asi, kdfParams[0]));
  const iterations = valueOf(asi, kdfParams[1]).readUIntBE(0, valueOf(asi, kdfParams[1]).length);
  const prfNode = kdfParams.find((n) => n.tag === 0x30);
  const prf = prfNode ? PRF[oidOf(asi, children(asi, prfNode)[0])] : "sha1";

  // 加密算法与 IV
  const scheme = children(asi, pbes2[1]);
  const cipherOid = oidOf(asi, scheme[0]);
  const cipher = CIPHER[cipherOid];
  if (!cipher) {
    throw new Error(`unsupported PKCS#12 cipher ${cipherOid}, convert the .p12 to a .pem instead`);
  }
  const [algorithm, keyLen] = cipher;
  const iv = Buffer.from(valueOf(asi, scheme[1]));

  const key = crypto.pbkdf2Sync(Buffer.from(password, "utf8"), salt, iterations, keyLen, prf);

  try {
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    return Buffer.concat([decipher.update(valueOf(asi, parts[2])), decipher.final()]);
  } catch {
    // 密码只影响 PBKDF2 派生出的密钥，错了就解不出合法明文
    throw new Error("cannot decrypt the bundle — the password is most likely wrong");
  }
}

const toPem = (key) => key.export({ type: "pkcs8", format: "pem" });

/** 读一个 DER TLV 头，返回内容区间（只认单字节 tag + 定长编码，PKCS#12 里够用） */
function readTlv(buf, offset) {
  const tag = buf[offset];
  let len = buf[offset + 1];
  let headerLen = 2;

  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[offset + 2 + i];
    headerLen = 2 + n;
  }

  return { tag, start: offset, contentStart: offset + headerLen, len, end: offset + headerLen + len };
}

/** 把一棵 TLV 的直接子节点平铺出来 */
function children(buf, node) {
  const out = [];
  for (let p = node.contentStart; p < node.end; ) {
    const child = readTlv(buf, p);
    out.push(child);
    p = child.end;
  }
  return out;
}

const valueOf = (buf, node) => buf.subarray(node.contentStart, node.end);

/** 整数段用基数 128 的变长编码，第一字节里 40*x+y 合并了前两段 */
function oidOf(buf, node) {
  const bytes = valueOf(buf, node);
  const parts = [Math.floor(bytes[0] / 40), bytes[0] % 40];

  let acc = 0;
  for (let i = 1; i < bytes.length; i++) {
    acc = acc * 128 + (bytes[i] & 0x7f);
    if (!(bytes[i] & 0x80)) {
      parts.push(acc);
      acc = 0;
    }
  }

  return parts.join(".");
}
