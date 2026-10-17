import { createHash, verify, X509Certificate } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import forge from 'node-forge';
import { unzipSync } from 'fflate';
import { DOMParser } from '@xmldom/xmldom';
import { C14nCanonicalization, ExclusiveCanonicalization } from 'xml-crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { packageTizen } from './tizen-signing';
import { prepareAutomaticTizen, TIZEN_PACKAGES } from './tizen-tools';
import { runProcess } from './process-runner';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'adr-sign-'));
  dirs.push(dir);
  return dir;
};

function certificates(): Record<string, Uint8Array> {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const ca = forge.pki.createCertificate();
  ca.publicKey = keys.publicKey;
  ca.serialNumber = '01';
  ca.validity.notBefore = new Date('2020-01-01');
  ca.validity.notAfter = new Date('2040-01-01');
  const subject = [{ name: 'commonName', value: 'Test CA' }];
  ca.setSubject(subject);
  ca.setIssuer(subject);
  ca.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [ca], 'tizenpkcs12passfordsigner');
  const root = 'data/tools/certificate-generator/certificates/';
  return {
    [root + 'developer/tizen-developer-ca.cer']: Buffer.from(forge.pki.certificateToPem(ca)),
    [root + 'developer/tizen-developer-ca-privatekey.pem']: Buffer.from(
      forge.pki.encryptRsaPrivateKey(keys.privateKey, 'tizencertificatefordevelopercaroqkfwk'),
    ),
    [root + 'distributor/sdk-public/tizen-distributor-signer-new.p12']: Buffer.from(
      forge.asn1.toDer(p12).getBytes(),
      'binary',
    ),
  };
}

function verifyWidget(path: string): string {
  const files = unzipSync(readFileSync(path));
  let author = '';
  for (const name of ['author-signature.xml', 'signature1.xml']) {
    const doc = new DOMParser().parseFromString(Buffer.from(files[name]!).toString('utf8'), 'application/xml');
    const get = (tag: string) => doc.getElementsByTagName(tag).item(0)!;
    const info = new ExclusiveCanonicalization().process(get('SignedInfo'), {});
    const cert = new X509Certificate(Buffer.from(get('X509Certificate').textContent, 'base64'));
    expect(
      verify('RSA-SHA256', Buffer.from(info), cert.publicKey, Buffer.from(get('SignatureValue').textContent, 'base64')),
    ).toBe(true);
    const refs = doc.getElementsByTagName('Reference');
    for (let i = 0; i < refs.length; i++) {
      const ref = refs.item(i)!;
      const uri = ref.getAttribute('URI')!;
      const data =
        uri === '#prop' ? new C14nCanonicalization().process(get('Object'), {}) : files[decodeURIComponent(uri)]!;
      expect(createHash('sha256').update(data).digest('base64'), uri).toBe(
        ref.getElementsByTagName('DigestValue').item(0)!.textContent,
      );
    }
    if (name === 'author-signature.xml') author = cert.fingerprint256;
  }
  return author;
}

function buildAndVerify(certs: Record<string, Uint8Array>, legacy = false) {
  const dir = temp();
  const stage = join(dir, 'web');
  mkdirSync(stage);
  writeFileSync(join(stage, 'index.html'), '<h1>Adrenaline</h1>');
  writeFileSync(join(stage, 'config.xml'), '<widget/>');
  writeFileSync(join(stage, 'server.json'), '{"server":"http://192.168.1.2:18790"}');
  const output = join(dir, 'app.wgt');
  const author = join(dir, 'author.json');
  packageTizen(stage, output, author, certs, legacy);
  const first = verifyWidget(output);
  writeFileSync(join(stage, 'index.html'), '<h1>Updated app</h1>');
  packageTizen(stage, output, author, certs, legacy);
  expect(verifyWidget(output)).toBe(first);
}

describe('Automatic Tizen installation', () => {
  it('refuses an expired saved author without replacing its key', () => {
    const dir = temp();
    const stage = join(dir, 'web');
    mkdirSync(stage);
    const author = join(dir, 'author.json');
    const certs = certificates();
    packageTizen(stage, join(dir, 'app.wgt'), author, certs);
    const saved = readFileSync(author, 'utf8');
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2041-01-01'));
      expect(() => packageTizen(stage, join(dir, 'app.wgt'), author, certs)).toThrow(/expired/);
      expect(readFileSync(author, 'utf8')).toBe(saved);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels before downloading tools', async () => {
    const download = vi.fn<typeof fetch>();
    await expect(prepareAutomaticTizen(temp(), AbortSignal.abort(), download)).rejects.toThrow();
    expect(download).not.toHaveBeenCalled();
  });

  it.skipIf(process.env['TIZEN_LIVE_CHECK'] !== '1')(
    'downloads official tools, reuses cache and signs the real TV build',
    async () => {
      const dir = temp();
      const signal = new AbortController().signal;
      const tools = await prepareAutomaticTizen(join(dir, 'tools'), signal);
      const offline = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
      const cached = await prepareAutomaticTizen(join(dir, 'tools'), signal, offline);
      expect(cached.sdb).toBe(tools.sdb);
      expect(offline).not.toHaveBeenCalled();
      const version = await runProcess(tools.sdb, ['version'], { timeoutMs: 10_000 });
      expect(version.code).toBe(0);
      expect(version.stdout).toMatch(/4\.2\.36/);
      const stage = join(dir, 'web');
      cpSync('resources/tv/tizen/web', stage, { recursive: true });
      writeFileSync(join(stage, 'server.json'), '{"server":"http://192.168.1.2:18790"}');
      const output = join(dir, 'app.wgt');
      const author = join(dir, 'author.json');
      packageTizen(stage, output, author, tools.certificates);
      const first = verifyWidget(output);
      packageTizen(stage, output, author, cached.certificates);
      expect(verifyWidget(output)).toBe(first);
    },
    180_000,
  );

  it('creates independently verifiable WGT signatures and keeps the author for updates', () =>
    buildAndVerify(certificates()));

  it('rejects a substituted tool download before extracting or executing it', async () => {
    const dir = temp();
    await expect(
      prepareAutomaticTizen(dir, new AbortController().signal, () => Promise.resolve(new Response('wrong archive'))),
    ).rejects.toMatchObject({ code: 'DEPLOY_PACKAGE_MISSING' });
    expect(existsSync(join(dir, 'sdb.exe'))).toBe(false);
  });

  it.skipIf(!existsSync('vendor/tizen-certificates.zip'))(
    'signs with the actual official SDK certificate chain',
    () => {
      const bytes = readFileSync('vendor/tizen-certificates.zip');
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(TIZEN_PACKAGES.certificates.sha256);
      buildAndVerify(unzipSync(bytes));
      buildAndVerify(unzipSync(bytes), true);
    },
  );
});
