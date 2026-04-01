# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Beecork, please report it responsibly.

**Email:** [security@beecork.com](mailto:security@beecork.com)

Please include:

- A description of the vulnerability
- Steps to reproduce the issue
- The potential impact
- Any suggested fixes (optional)

## Response Timeline

- **Acknowledgment:** Within 48 hours
- **Initial assessment:** Within 1 week
- **Fix and disclosure:** As soon as a patch is ready, typically within 2 weeks

## Scope

This policy covers the `beecork` npm package and the code in this repository.

## What Qualifies

- Remote code execution
- Command injection
- Authentication bypass
- Privilege escalation
- Data exposure (config files, API keys leaking)
- XSS in the dashboard

## What Doesn't Qualify

- Issues requiring physical access to the machine running Beecork
- Social engineering
- Denial of service (Beecork runs locally, not as a public service)
- Vulnerabilities in dependencies (report those upstream, but let us know too)

## Disclosure

We follow coordinated disclosure. We'll credit you in the release notes unless you prefer to remain anonymous.
