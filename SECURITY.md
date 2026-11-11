# Chrome Extension Security & Compliance Audit

## 1. Manifest V3 Content Security Policy (CSP) Compliance

* [x] **No Remote Code Execution:** The extension loads 100% locally bundled scripts (`script-src 'self'`). No external CDNs, Google Fonts scripts, or remote script injections are used.
* [x] **No `eval()` or Function Constructors:** All dynamic JSON deserialization uses native `JSON.parse()`. No string-to-code evaluations exist.
* [x] **Zero Inline Handlers:** All DOM events in the UI utilize declarative React JSX handlers (`onClick`, `onSubmit`) and standard `addEventListener` calls. No inline `onclick=""` or `<script>...</script>` tags exist in HTML documents.

---

## 2. Host Permissions & Network Boundaries

```json
"host_permissions": [
  "https://*.salesforce.com/*",
  "https://*.force.com/*",
  "https://*.my.salesforce.com/*",
  "https://*.lightning.force.com/*"
]
```

* [x] **Scoped Domain Access:** Network permissions are strictly limited to authenticated Salesforce domain spaces. No broad `<all_urls>` or `http://*` permissions are requested.
* [x] **Zero Third-Party Telemetry:** No external tracking, third-party analytics, or off-site telemetry servers are contacted. All payloads travel directly and exclusively between the browser and Salesforce REST endpoints.

---

## 3. Credential & Token Storage Architecture

| Token Type | Storage Medium | Lifecycle | Security Rationale |
|---|---|---|---|
| **Active Tab Session (`sid`)** | `chrome.storage.session` | Memory only (destroyed on browser close) | Prevents long-term disk persistence of active user UI sessions. |
| **Target Sandbox Refresh Token** | `chrome.storage.local` | Sandboxed per Extension ID | Encrypted and isolated by Chrome's sandbox; revoked via `/services/oauth2/revoke` on disconnect. |
| **PKCE Verifier & Challenge** | Memory / Ephemeral | Single OAuth exchange lifecycle | Generated using `crypto.subtle` (SHA-256) and discarded immediately after code exchange. |

---

## 4. Cross-Org Composite Graph Data Sanitization

* [x] **Audit Field Stripping:** System audit fields (`CreatedDate`, `CreatedById`, `LastModifiedDate`, `SystemModstamp`, `IsDeleted`) and standard record `Id`s are stripped prior to constructing payload bodies.
* [x] **Person Account Field Quarantine:** `__pc` Contact custom fields are automatically excluded when seeding standard Business Accounts (`IsPersonAccount: false`), eliminating `bad field names on insert/update call` API faults.
* [x] **Target Schema Pre-Validation:** Source fields that do not exist in the target sandbox schema are identified during pre-flight describe audits and omitted before payload serialization.
