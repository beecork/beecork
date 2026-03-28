import { describe, it, expect, vi } from 'vitest';
import { ApprovalManager } from '../../src/session/approval.js';
import { makeToolUse } from '../fixtures/mock-config.js';

describe('ApprovalManager', () => {
  it('should auto-approve everything in yolo mode', async () => {
    const mgr = new ApprovalManager('yolo', 'test', null);
    expect(await mgr.shouldApprove(makeToolUse('Write', { file: '/etc/passwd' }))).toBe(true);
    expect(await mgr.shouldApprove(makeToolUse('Bash', { command: 'rm -rf /' }))).toBe(true);
  });

  it('should auto-approve safe tools in auto-safe mode', async () => {
    const mgr = new ApprovalManager('auto-safe', 'test', null);
    expect(await mgr.shouldApprove(makeToolUse('Read', { path: '/file' }))).toBe(true);
    expect(await mgr.shouldApprove(makeToolUse('Glob', { pattern: '*.ts' }))).toBe(true);
  });

  it('should request approval for dangerous tools in auto-safe mode', async () => {
    const callback = vi.fn().mockResolvedValue(true);
    const mgr = new ApprovalManager('auto-safe', 'test', callback);
    const result = await mgr.shouldApprove(makeToolUse('Write', { file: '/test' }));
    expect(callback).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('should reject when callback returns false', async () => {
    const callback = vi.fn().mockResolvedValue(false);
    const mgr = new ApprovalManager('ask', 'test', callback);
    expect(await mgr.shouldApprove(makeToolUse('Read', {}))).toBe(false);
  });

  it('should reject on approval timeout', async () => {
    const callback = vi.fn(() => new Promise<boolean>(() => {})); // never resolves
    const mgr = new ApprovalManager('ask', 'test', callback, 100); // 100ms timeout
    expect(await mgr.shouldApprove(makeToolUse('Read', {}))).toBe(false);
  });

  it('should reject when no callback set for non-yolo mode', async () => {
    const mgr = new ApprovalManager('ask', 'test', null);
    expect(await mgr.shouldApprove(makeToolUse('Read', {}))).toBe(false);
  });
});
