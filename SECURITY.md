# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.x     | ✅ Current          |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT** open a public GitHub issue
2. Email: gotexis@users.noreply.github.com
3. Include a description and steps to reproduce

We will respond within 48 hours and work on a fix.

## Security Considerations

- agentfile stores Trello API credentials in environment variables (`TRELLO_KEY`, `TRELLO_TOKEN`)
- Credentials are never logged or transmitted except to configured vendor APIs
- The `.agentfile/managed.yaml` file contains record IDs — treat it as non-sensitive metadata
- Always use HTTPS endpoints (Trello API uses HTTPS by default)
- For markdown vendor, data is stored as local files with your system's file permissions
