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
  "https://*.force.com/*"
]
```

* [x] **Scoped Domain Access:** Network permissions are strictly limited to authenticated Salesforce domain spaces. No broad `<all_urls>` or `http://*` permissions are requested.
* [x] **Zero Third-Party Telemetry:** No external tracking, third-party analytics, or off-site telemetry servers are contacted. All payloads travel directly and exclusively between the browser and Salesforce REST endpoints.

---

## 3. Authentication Model & Credential Storage

The extension does **not** use OAuth or PKCE. It supports two ways of obtaining a Salesforce session:

1. **Active tab session:** the background service worker reads the `sid` cookie for the *exact* org domain of the Salesforce tab (the org's `*.my.salesforce.com` API host or the tab's own host). It never falls back to a `sid` cookie from a different org; if no exact match exists, an error is returned to the UI.
2. **Direct Login (SOAP username-password):** the user enters username, password (plus security token if required) and the extension calls the Salesforce SOAP `login()` endpoint (`/services/Soap/u/61.0`). The returned `sessionId` is used as the bearer token for REST calls.

| Item | Storage | Lifecycle |
|---|---|---|
| **Password** | Not stored. Held only in memory for the single SOAP login request. | Discarded after the request. Credentials cached by older versions are cleared on next login. |
| **Source org session (`sid` cookie or SOAP `sessionId`)** | `chrome.storage.session` (`activeSalesforceSession`) | In memory; cleared when the browser closes. |
| **Target org session (`sessionId`) + org metadata** | `chrome.storage.local` | Persists until the org is disconnected or "clear all" is used. The token expires per the org's session timeout policy. |

When a session expires the extension does **not** re-login silently. The user is prompted to refresh the Salesforce tab or log in again via Direct Login.

---

## 4. Cross-Org Composite Graph Data Sanitization

* [x] **Audit Field Stripping:** System audit fields (`CreatedDate`, `CreatedById`, `LastModifiedDate`, `SystemModstamp`, `IsDeleted`) and standard record `Id`s are stripped prior to constructing payload bodies.
* [x] **Person Account Field Quarantine:** `__pc` Contact custom fields are automatically excluded when seeding standard Business Accounts (`IsPersonAccount: false`), eliminating `bad field names on insert/update call` API faults.
* [x] **Target Schema Pre-Validation:** Source fields that do not exist in the target sandbox schema are identified during pre-flight describe audits and omitted before payload serialization.
