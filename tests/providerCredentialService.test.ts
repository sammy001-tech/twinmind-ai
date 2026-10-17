import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateSameOriginRequest, resolveProviderCredential, resolveCredentialForVerification } from '../server/services/providerCredentialService.ts';

test('environment credential takes precedence over saved Settings and request values at runtime', () => {
  assert.deepEqual(resolveProviderCredential('env-key', 'saved-key', 'request-key'), { key: 'env-key', source: 'environment' });
});
test('connection test verifies an explicitly supplied key rather than silently using the environment key', () => {
  assert.deepEqual(resolveCredentialForVerification('entered-key', 'env-key', 'saved-key'), { key: 'entered-key', source: 'request' });
});
test('connection test falls back to environment then saved Settings only when no key was entered', () => {
  assert.deepEqual(resolveCredentialForVerification('', 'env-key', 'saved-key'), { key: 'env-key', source: 'environment' });
  assert.deepEqual(resolveCredentialForVerification('', '', 'saved-key'), { key: 'saved-key', source: 'settings' });
  assert.deepEqual(resolveCredentialForVerification('********', '', 'saved-key'), { key: 'saved-key', source: 'settings' });
});
test('saved Settings key is the fallback when environment key is absent', () => {
  assert.deepEqual(resolveProviderCredential('', 'saved-key', 'request-key'), { key: 'saved-key', source: 'settings' });
});
test('request key is used only after environment and Settings are absent', () => {
  assert.deepEqual(resolveProviderCredential('', '', 'request-key'), { key: 'request-key', source: 'request' });
});
test('blank and masked credentials are treated as unavailable', () => {
  assert.equal(resolveProviderCredential('********', 'saved...masked').key, '');
  assert.equal(resolveProviderCredential(' \"env-key\" ', '').key, 'env-key');
});
test('canonical HTTPS origin supports reverse proxies that report HTTP internally', () => {
  assert.deepEqual(evaluateSameOriginRequest({ origin:'https://app.example', host:'app.example', protocol:'http', publicOrigin:'https://app.example/' }), { allowed:true });
});
test('canonical-origin check continues to reject foreign origins', () => {
  assert.deepEqual(evaluateSameOriginRequest({ origin:'https://attacker.example', host:'app.example', protocol:'https', publicOrigin:'https://app.example' }), { allowed:false, code:'INVALID_ORIGIN' });
});
test('origin guard rejects missing and malformed origin data', () => {
  assert.deepEqual(evaluateSameOriginRequest({ origin:null, host:'app.example', protocol:'https' }), { allowed:false, code:'ORIGIN_REQUIRED' });
  assert.deepEqual(evaluateSameOriginRequest({ origin:'https://app.example', host:'app.example', protocol:'https', publicOrigin:'not-a-url' }), { allowed:false, code:'INVALID_PUBLIC_ORIGIN_CONFIGURATION' });
});
test('origin guard uses trusted request protocol and host when no canonical origin is set', () => {
  assert.deepEqual(evaluateSameOriginRequest({ origin:'https://app.example', host:'app.example', protocol:'https' }), { allowed:true });
  assert.deepEqual(evaluateSameOriginRequest({ origin:'https://app.example', host:'app.example', protocol:'http' }), { allowed:false, code:'INVALID_ORIGIN' });
});
