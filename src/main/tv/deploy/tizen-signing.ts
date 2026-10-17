import { createHash, generateKeyPairSync, randomBytes, sign, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import forge from 'node-forge';
import { zipSync } from 'fflate';
import { AppError } from '@shared/errors';

const CERT_ROOT = 'data/tools/certificate-generator/certificates/';
const DS = 'http://www.w3.org/2000/09/xmldsig#';
const DSP = 'http://www.w3.org/2009/xmldsig-properties';
const C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#';
const hash = (data: Uint8Array | string) => createHash('sha256').update(data).digest('base64');
const cert64 = (cert: forge.pki.Certificate) =>
  forge.util.encode64(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes());

interface Identity {
  key: string;
  certificates: string[];
}

/** W3C widget signatures, as used by Samsung's webIDE packageSigner. No SDK or shell required. */
function signature(files: Record<string, Uint8Array>, identity: Identity, author: boolean): string {
  const id = author ? 'AuthorSignature' : 'DistributorSignature';
  const role = author ? 'author' : 'distributor';
  const properties =
    `<SignatureProperties xmlns:dsp="${DSP}">` +
    `<SignatureProperty Id="profile" Target="#${id}"><dsp:Profile URI="http://www.w3.org/ns/widgets-digsig#profile"></dsp:Profile></SignatureProperty>` +
    `<SignatureProperty Id="role" Target="#${id}"><dsp:Role URI="http://www.w3.org/ns/widgets-digsig#role-${role}"></dsp:Role></SignatureProperty>` +
    `<SignatureProperty Id="identifier" Target="#${id}"><dsp:Identifier></dsp:Identifier></SignatureProperty></SignatureProperties>`;
  const object = `<Object Id="prop">${properties}</Object>`;
  // Canonical XML 1.1 of this fixed Object (no external XML is accepted).
  const canonicalObject = `<Object xmlns="${DS}" Id="prop">${properties}</Object>`;
  const reference = (uri: string, digest: string, transform = '') =>
    `<Reference URI="${uri}">${transform}<DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></DigestMethod><DigestValue>${digest}</DigestValue></Reference>`;
  const references =
    Object.keys(files)
      .sort()
      .map((path) => reference(encodeURIComponent(path), hash(files[path]!)))
      .join('') +
    reference(
      '#prop',
      hash(canonicalObject),
      '<Transforms><Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"></Transform></Transforms>',
    );
  const info =
    `<SignedInfo><CanonicalizationMethod Algorithm="${C14N}"></CanonicalizationMethod>` +
    `<SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"></SignatureMethod>${references}</SignedInfo>`;
  const canonicalInfo = info.replace('<SignedInfo>', `<SignedInfo xmlns="${DS}">`);
  const value = sign('RSA-SHA256', Buffer.from(canonicalInfo), identity.key).toString('base64');
  return (
    `<Signature xmlns="${DS}" Id="${id}">${info}<SignatureValue>${value}</SignatureValue><KeyInfo><X509Data>` +
    identity.certificates.map((c) => `<X509Certificate>${c}</X509Certificate>`).join('') +
    `</X509Data></KeyInfo>${object}</Signature>`
  );
}

/** Per-PC author identity is retained outside staging: upgrades must keep the same author key. */
function authorIdentity(path: string, archive: Record<string, Uint8Array>): Identity {
  if (existsSync(path)) {
    try {
      const identity = JSON.parse(readFileSync(path, 'utf8')) as Identity;
      if (!identity.key || !identity.certificates.length) throw new Error('Incomplete author identity');
      for (const encoded of identity.certificates) {
        const cert = new X509Certificate(Buffer.from(encoded, 'base64'));
        if (Date.parse(cert.validFrom) > Date.now() || Date.parse(cert.validTo) <= Date.now())
          throw new Error('Expired author certificate');
      }
      return identity;
    } catch {
      throw new AppError(
        'DEPLOY_CERTIFICATE',
        'Saved author identity is invalid or expired. Keep author.json for renewal; do not delete it.',
      );
    }
  }
  const get = (name: string) => Buffer.from(archive[CERT_ROOT + name]!).toString('utf8');
  const ca = forge.pki.certificateFromPem(get('developer/tizen-developer-ca.cer'));
  const caKey = forge.pki.decryptRsaPrivateKey(
    get('developer/tizen-developer-ca-privatekey.pem'),
    'tizencertificatefordevelopercaroqkfwk',
  );
  if (!caKey || ca.validity.notAfter <= new Date())
    throw new AppError('DEPLOY_CERTIFICATE', 'Tizen developer CA expired');
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(keys.publicKey.export({ type: 'spki', format: 'pem' }).toString());
  cert.serialNumber = `01${randomBytes(15).toString('hex')}`;
  cert.validity.notBefore = new Date(Date.now() - 86400_000);
  cert.validity.notAfter = ca.validity.notAfter;
  cert.setSubject([
    { name: 'commonName', value: 'Adrenaline TV Developer' },
    { name: 'organizationName', value: 'Adrenaline' },
  ]);
  cert.setIssuer(ca.subject.attributes);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true },
    { name: 'extKeyUsage', codeSigning: true },
  ]);
  cert.sign(caKey, forge.md.sha256.create());
  const identity = { key, certificates: [cert64(cert), cert64(ca)] };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(identity), { mode: 0o600, flag: 'wx' });
  return identity;
}

function distributorIdentity(archive: Record<string, Uint8Array>, legacy: boolean): Identity {
  // The old signer in the SDK expired; use its replacement (valid until October 2032).
  // Some Samsung firmware trusts only the legacy SDK root (confirmed on QE65Q77BATXXH).
  // Its certificates expired in 2022; only use it after an explicit chain rejection of the new root.
  const data = archive[`${CERT_ROOT}distributor/sdk-public/tizen-distributor-signer${legacy ? '' : '-new'}.p12`]!;
  const p12 = forge.pkcs12.pkcs12FromAsn1(
    forge.asn1.fromDer(Buffer.from(data).toString('binary')),
    'tizenpkcs12passfordsigner',
  );
  const keyOid = forge.pki.oids.pkcs8ShroudedKeyBag!;
  const certOid = forge.pki.oids.certBag!;
  const key = p12.getBags({ bagType: keyOid })[keyOid]?.[0]?.key;
  const certs = p12.getBags({ bagType: certOid })[certOid]?.flatMap((b) => (b.cert ? [b.cert] : [])) ?? [];
  if (!key || !certs.length) throw new AppError('DEPLOY_CERTIFICATE');
  return { key: forge.pki.privateKeyToPem(key), certificates: certs.map(cert64) };
}

export function packageTizen(
  stage: string,
  output: string,
  authorPath: string,
  certificates: Record<string, Uint8Array>,
  legacyDistributor = false,
): void {
  const files: Record<string, Uint8Array> = {};
  const walk = (dir: string, prefix = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), `${name}/`);
      else if (entry.isFile() && !/^(author-signature|signature\d+)\.xml$/.test(name))
        files[name] = readFileSync(join(dir, entry.name));
    }
  };
  walk(stage);
  files['author-signature.xml'] = Buffer.from(signature(files, authorIdentity(authorPath, certificates), true));
  files['signature1.xml'] = Buffer.from(signature(files, distributorIdentity(certificates, legacyDistributor), false));
  writeFileSync(output, zipSync(files));
}
