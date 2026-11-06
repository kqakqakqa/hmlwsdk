import crypto from "crypto";
import jsrsasign from "jsrsasign";

/**
 * 生成 CMS SignedData（ContentInfo 包装后的 DER）
 *
 * .bin 的签名尾巴和 hap 签名块里的第二段 CMS 用的是同一套结构，都是
 * ContentInfo(signedData) 里装一份带三个签名属性的 SignerInfo。
 *
 * 算法和属性照抄 hap-sign-utils/sign-app-to-hap.js 的 generateSignedData()：
 *   sha256 + SHA256withECDSA
 *   签名属性固定三个：signingTime / contentType(1.2.840.113549.1.7.1) / messageDigest
 * 这三个属性决定了设备验签能不能过，别删也别加。
 *
 * @param {Buffer} econtent 被签名的内容
 * @param {string[]} certPems 证书 PEM，顺序随意 —— 内部会按链排好
 * @param {string} keyPem PKCS#8 私钥 PEM
 * @param {string} signTime "YYYYMMDDHHMMSSZ"，取 p7b 的 not-before
 * @returns {Buffer}
 */
export function buildSignedData({ econtent, certPems, keyPem, signTime }) {
  const certs = sortCertChain(certPems);

  const sd = new jsrsasign.KJUR.asn1.cms.SignedData({
    version: 1,
    hashalgs: ["sha256"],
    econtent: { type: "data", content: { hex: econtent.toString("hex") } },
    certs,
    revinfos: { array: [] },
    sinfos: [
      {
        version: 1,
        id: { type: "isssn", cert: certs[0] },
        hashalg: "sha256",
        sattrs: {
          array: [
            { attr: "signingTime", type: new jsrsasign.KJUR.asn1.cms.SigningTime(signTime) },
            { attr: "contentType", type: "1.2.840.113549.1.7.1" },
            { attr: "messageDigest", hex: crypto.createHash("sha256").update(econtent).digest("hex") }
          ]
        },
        sigalg: "SHA256withECDSA",
        signkey: keyPem
      }
    ]
  });

  return Buffer.from(sd.getContentInfoEncodedHex(), "hex");
}

/**
 * 把证书排成 叶子 → 中间 → 根
 *
 * 叶子 = 它的 subject 不作为任何一张证书的 issuer 出现的那张。
 * 然后顺着 issuer 往上找，直到自签名的根。
 * 照抄 hap-sign-utils 的 sortCerts()，CMS 里 certs 的顺序会影响设备建链。
 */
export function sortCertChain(certPems) {
  const parsed = certPems.map((pem) => {
    const c = new jsrsasign.X509();
    c.readCertPEM(pem);
    return { pem, subject: c.getSubjectString(), issuer: c.getIssuerString() };
  });

  const leaf = parsed.find((c) => !parsed.some((x) => x.issuer === c.subject));
  if (!leaf) throw new Error("no leaf certificate in the chain (they may all be self-signed)");

  const ordered = [];
  let cur = leaf;
  while (cur) {
    ordered.push(cur.pem);
    if (cur.subject === cur.issuer) break;
    cur = parsed.find((x) => x.subject === cur.issuer);
  }
  return ordered;
}
