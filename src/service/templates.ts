import os from 'node:os';

export function getLaunchdPlist(nodePath: string, daemonPath: string): string {
  const home = os.homedir();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.beecork.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${daemonPath}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${home}/.beecork/logs/daemon.stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${home}/.beecork/logs/daemon.stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:${home}/.local/bin:${home}/.nvm/versions/node/current/bin</string>
        <key>HOME</key>
        <string>${home}</string>
    </dict>
</dict>
</plist>`;
}

export function getSystemdUnit(nodePath: string, daemonPath: string): string {
  return `[Unit]
Description=Beecork - Claude Code always-on infrastructure
After=network.target

[Service]
ExecStart=${nodePath} ${daemonPath}
Restart=always
RestartSec=5
Environment=PATH=/usr/local/bin:/usr/bin:/bin:%h/.local/bin

[Install]
WantedBy=default.target`;
}

export function getLaunchdPlistPath(): string {
  return `${os.homedir()}/Library/LaunchAgents/com.beecork.daemon.plist`;
}

export function getSystemdUnitPath(): string {
  return `${os.homedir()}/.config/systemd/user/beecork.service`;
}
