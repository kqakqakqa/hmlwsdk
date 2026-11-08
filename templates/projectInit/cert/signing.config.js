/**
 * Shipped by hmlwsdk together with cert/default.p12 — the private key is already here, so only a profile is missing.
 * Add the .p7b issued for your bundle name in AppGallery Connect and set `p7b` below; then buildSignedApp works as is.
 * `p7b` is left out on purpose: a declared-but-absent file is an error, and this template has no profile yet.
 * Paths are relative to the cert/ directory. This file holds a plaintext password; cert/.gitignore
 * ignores the whole directory, so it never reaches version control.
 */
export default {
  p12: "default.p12",
  password: "default"
};
