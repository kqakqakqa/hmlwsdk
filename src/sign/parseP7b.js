import jsrsasign from "jsrsasign";

/**
 * 解析 p7b（HarmonyOS profile 文件）
 *
 * p7b 本身就是一段 CMS SignedData，econtent 是一段 JSON。实测字段（photo.p7b）：
 *   version-name / version-code / uuid / validity / type / bundle-info /
 *   baseapp-info / permissions / debug-info / acls / app-privilege-capabilities / issuer
 *
 * bundle-info 里装的是叶子证书，字段名取决于 profile 类型，二选一：
 *   type = debug   → development-certificate
 *   type = release → distribution-certificate
 * 实测：poweroftwo 的 Release p7b 只有 distribution-certificate，
 * palu图阅 的 debug p7b 只有 development-certificate。
 *
 * validity.not-before 是 Unix 秒。注意它**不是** CMS 里的 signingTime ——
 * 实测 Gradle 产物的 signingTime 是签名当时的时刻（样本 20250824065539Z，
 * 同一份 p7b 的 not-before 是 06:55:05，差 34 秒）。
 * hap-sign-utils 拿 not-before 当 signingTime，正好压在证书有效期下边界，
 * BouncyCastle 校验会报 "verifier not valid at signingTime"，别照抄。
 *
 * @param {Buffer} buf p7b 文件内容
 * @returns {{bundleName:string, type:string, leafCertPem:string, notBefore:number, raw:Buffer, json:object}}
 */
export function parseP7b(buf) {
  const parser = new jsrsasign.KJUR.asn1.cms.CMSParser();
  const sd = parser.getCMSSignedData(buf.toString("hex"));
  const json = JSON.parse(Buffer.from(sd.econtent.content.hex, "hex").toString());

  const info = json["bundle-info"];
  if (!info) throw new Error("p7b has no bundle-info, make sure this is a HarmonyOS profile file");

  const leafCertPem = info["development-certificate"] ?? info["distribution-certificate"];
  if (!leafCertPem) {
    throw new Error(
      "bundle-info of the p7b has neither development-certificate nor distribution-certificate"
    );
  }

  const notBefore = json.validity?.["not-before"];
  if (typeof notBefore !== "number") throw new Error("p7b has no validity.not-before");

  return {
    bundleName: info["bundle-name"],
    type: json.type ?? "unknown",
    leafCertPem,
    notBefore,
    raw: buf,
    json
  };
}

/**
 * 当前时刻 → CMS signingTime 用的 "YYYYMMDDHHMMSSZ"
 *
 * 跟官方工具一致：签名时间是「签的这一刻」，不是 profile 的 not-before。
 * 实测样本 20250824065539Z 与它那张证书的 notBefore(06:55:05) 差 34 秒，
 * 正好印证这一点 —— 证书生成完 34 秒后开始构建。
 */
export function nowSignTime(date = new Date()) {
  return date.toISOString().replace(/[-:T]/g, "").split(".")[0] + "Z";
}
