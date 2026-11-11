# Store Listing & Submission Guide — Salesforce Cross-Org Data Seeder

> Last Updated: 2026-08-24

This document contains everything needed to publish the **Salesforce Cross-Org Data Seeder** extension to the **Chrome Web Store** and **Microsoft Edge Add-ons Store**.

---

## 1. Store Listing Metadata

**Extension Name**
```text
Salesforce Cross-Org Data Seeder
```

**Short Description** (Max 132 characters)
```text
Migrate relational Salesforce records cross-org with schema pre-validation, parent-child linking, and predictive storage sizing.
```

**Detailed Description** (Formatted for Store Listing)
```text
Salesforce Cross-Org Data Seeder is a native developer and QA tool that migrates complex relational data between Salesforce environments (Production, Stage, Developer Sandboxes, and Scratch Orgs) without CSV exports or external servers.

KEY FEATURES:
• 3-Tier Relational Integrity: Automatically migrates upstream parent lookups, root objects, and downstream child trees in single atomic Composite Graph transactions.
• Predictive Storage Sizing: Calculates real-time storage footprint (~2 KB per record) against your 200 MB sandbox quota to prevent accidental limit breaches.
• Target Schema Pre-Validation: Introspects source and target schemas, automatically identifying and omitting missing custom fields to prevent insertion failures.
• Parent Deduplication & External ID Upsert: Deduplicates shared lookup records in memory and performs intelligent PATCH upserts to avoid duplicate key errors.
• In-Browser Privacy: All API calls travel directly between your browser and Salesforce REST endpoints using official Salesforce APIs. Zero data is sent to third-party servers.

HOW TO USE:
1. Open your Source Salesforce Org in any browser tab.
2. Click the Salesforce Data Seeder extension icon to open the Side Panel.
3. Connect your Target Sandbox using direct login or OAuth.
4. Select your Root SObject, set SOQL filters and record limits.
5. Review the predictive storage footprint and click 'Start Seeding' to watch real-time graph execution.

PERMISSIONS & SECURITY:
This extension interacts only with authenticated Salesforce instances (*.salesforce.com and *.force.com) and stores credentials strictly inside your browser's encrypted sandbox storage.
```

**Category**
```text
Developer Tools
```

**Single Purpose**
```text
Seeds and migrates relational Salesforce data between sandboxes with real-time storage sizing.
```

**Primary Language**
```text
English
```

---

## 2. Permissions Justification (For Store Reviewers)

| Permission | Type | Plain-English Justification for Reviewer |
|---|---|---|
| `storage` | permissions | Required to store user preferences, cached SObject describe schemas, and target sandbox credentials locally in browser storage. |
| `cookies` | permissions | Required to detect the active Salesforce session cookie (`sid`) from the user's active Salesforce tab to authenticate REST API calls without asking for credentials again. |
| `identity` | permissions | Required to initiate the OAuth 2.0 Web Authentication flow when authenticating with external Salesforce sandboxes. |
| `tabs` | permissions | Required to inspect active tab URLs and automatically identify when the user is logged into a Salesforce instance. |
| `sidePanel` | permissions | Required to render the multi-step seeding wizard in the browser's side panel for side-by-side workflow while using Salesforce. |
| `https://*.salesforce.com/*` | host_permissions | Required to send Salesforce REST and Composite Graph API requests to execute metadata describe and data seeding calls. |
| `https://*.force.com/*` | host_permissions | Required to communicate with Salesforce Lightning instances. |
| `https://*.my.salesforce.com/*` | host_permissions | Required to interact with MyDomain Salesforce REST API endpoints. |
| `https://*.lightning.force.com/*` | host_permissions | Required to detect active Lightning UI browser sessions. |

---

## 3. Privacy & Data Use Disclosures

* **Data Collection**: No personal data, health data, financial data, or web history is collected, sold, or transmitted off-device.
* **Third-Party Telemetry**: Zero external analytics or tracking libraries are included.
* **Data Transfer**: Payloads travel 100% directly between the user's browser and Salesforce's official REST API endpoints.

---

## 4. How to Package the Extension for Upload

To create the clean ZIP bundle for store upload (excluding dev tools and test files):

### On Windows (PowerShell):
```powershell
Compress-Archive -Path manifest.json, background.js, authManager.js, apiClient.js, schemaEngine.js, graphBuilder.js, app.js, index.html, styles.css, icons -DestinationPath salesforce-data-seeder-v1.0.0.zip -Force
```

---

## 5. Step-by-Step Publishing Portals

### A. Publishing to Chrome Web Store:
1. Go to the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Pay the one-time $5 registration fee (if new developer account).
3. Click **Add new item** and upload `salesforce-data-seeder-v1.0.0.zip`.
4. Fill in the listing details from Section 1 above.
5. In the **Privacy tab**, paste the justifications from Section 2.
6. Click **Submit for Review** (approval typically takes 1–3 business days).

### B. Publishing to Microsoft Edge Add-ons (Free):
1. Go to the [Microsoft Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview).
2. Sign in with your Microsoft account (Registration is 100% free).
3. Click **Create new extension** and upload `salesforce-data-seeder-v1.0.0.zip`.
4. Paste the metadata from Section 1 and submit for review (approval takes 1–2 business days).
