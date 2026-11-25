# Release Provenance & Code Signing Policy

> **Current Status**: Official release binaries for **AI Quota Dashboard** are currently distributed as **unsigned** open-source builds compiled exclusively on GitHub Actions. This document defines our build provenance, privacy commitments, and governance standards should digital code signing be adopted in the future.

## 1. Purpose & Scope
This policy governs the digital code signing of official Windows release binaries for **AI Quota Dashboard** (`https://github.com/dong1121/ai-quota-dashboard`).

Signed artifacts are strictly limited to binaries built directly from this repository's official source code:
- `AI-Quota-Dashboard-Setup-*.exe` (Windows NSIS installer)
- `AI-Quota-Dashboard-Portable-*-win-x64.exe` (Windows portable executable)
- Internal Electron application executable (`AI Quota Dashboard.exe`) built during the release pipeline

No third-party or unrelated binaries are submitted under this signing identity.

## 2. Team Roles & Access Control
All team members with write access to the repository or signing approval permissions must have **Multi-Factor Authentication (MFA)** enabled on both GitHub and SignPath.

- **Committer / Maintainer**: `@dong1121`
- **Reviewer**: `@dong1121`
- **Signing Approver**: `@dong1121`

## 3. Build & Release Provenance
- All signed binaries are built exclusively on **GitHub-hosted runners** via `.github/workflows/release.yml` triggered by annotated/pushed version tags (`v*`) on the `main` branch.
- Pull requests from forks and local developer builds are never eligible for release signing.
- Every release pipeline runs automated build, strict TypeScript typechecking, and unit/integration test suites (`npm run build && npm run typecheck && npm test`) prior to packaging and signing.

## 4. Privacy Policy
**AI Quota Dashboard** is strictly **Local-First**:
- All user data (account identifiers, quota metrics, usage history, and subscription preferences) is stored exclusively on the user's local machine (`%APPDATA%/AIQuotaDashboard/` on Windows or `~/Library/Application Support/AIQuotaDashboard/` on macOS).
- The application does **not** transmit personal data, credentials, cookies, or telemetry to any developer-operated or third-party server.
- Network requests made by the desktop application are limited to:
  1. Local loopback (`127.0.0.1`) communication with the user's own browser extension authenticated via a locally generated random Pairing Token.
  2. Read-only checks against GitHub Releases (`github.com/dong1121/ai-quota-dashboard`) for optional software updates.

## 5. Incident Response & Revocation
If any maintainer account, GitHub token, or SignPath API credential is suspected of compromise, all signing pipelines will be halted immediately, credentials rotated, and SignPath Foundation notified promptly for certificate review or revocation.

---

> **繁體中文摘要**：本專案所有正式版安裝檔皆僅透過 GitHub Actions 官方雲端環境自公開原始碼建置（目前為未簽章開源發行版）；維護者帳號全程啟用雙重驗證（MFA）；本工具採純本機 Local-First 運作，絕不上傳任何帳號密碼、Cookie 或個人使用數據至雲端。
