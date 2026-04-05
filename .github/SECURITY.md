# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Reporting a Vulnerability

Please report security vulnerabilities **privately** by opening a GitHub Security Advisory (not a public issue).

1. Go to the **Security** tab of this repository
2. Click **Advisories** → **New draft security advisory**
3. Describe the vulnerability and your proposed fix

Response times:
- **Critical** (e.g., exposed credentials, RCE): within 24 hours
- **High** (e.g., auth bypass, XSS): within 48 hours
- **Medium/Low**: within 1 week

## Security Best Practices for Contributors

1. Never commit `.env` files or credentials to the repository
2. Use placeholder values in documentation (`<username>`, `<password>`)
3. Run `npm audit` before submitting pull requests
4. Keep dependencies up to date -- review and merge Dependabot PRs promptly
5. Use the provided `.env.example` as a template; never populate with real credentials
6. Enable two-factor authentication on your GitHub account before contributing

## What We Monitor

- GitHub Secret Scanning alerts
- Dependabot vulnerability alerts
- CodeQL code scanning alerts
- npm audit results in CI
