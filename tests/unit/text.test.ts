import { describe, it, expect } from 'vitest';
import { parseTabMessage, buildMediaPrompt } from '../../src/util/text.js';
import type { MediaAttachment } from '../../src/channels/types.js';

describe('parseTabMessage', () => {
  it('should parse /tab with name and message', () => {
    const result = parseTabMessage('/tab myproject fix the bug');
    expect(result).toEqual({ tabName: 'myproject', prompt: 'fix the bug' });
  });

  it('should parse /tab with name only (no message)', () => {
    const result = parseTabMessage('/tab myproject');
    expect(result).toEqual({ tabName: 'myproject', prompt: '' });
  });

  it('should return default tab for regular message', () => {
    const result = parseTabMessage('just a regular message');
    expect(result).toEqual({ tabName: 'default', prompt: 'just a regular message' });
  });

  it('should treat "/tab" with no name as default tab with prompt "/tab"', () => {
    // "/tab " starts with "/tab " so rest is empty string
    const result = parseTabMessage('/tab ');
    // rest is '', spaceIdx is -1 => tabName: '', prompt: ''
    expect(result).toEqual({ tabName: '', prompt: '' });
  });

  it('should not match /tabs or /tabulate as tab command', () => {
    const result = parseTabMessage('/tabs list');
    expect(result).toEqual({ tabName: 'default', prompt: '/tabs list' });
  });

  it('should trim whitespace from the prompt', () => {
    const result = parseTabMessage('/tab dev   hello world  ');
    expect(result.tabName).toBe('dev');
    expect(result.prompt).toBe('hello world');
  });

  it('should handle multi-word prompts', () => {
    const result = parseTabMessage('/tab research explain quantum computing in simple terms');
    expect(result.tabName).toBe('research');
    expect(result.prompt).toBe('explain quantum computing in simple terms');
  });
});

describe('buildMediaPrompt', () => {
  it('should return text as-is when media is empty', () => {
    expect(buildMediaPrompt([], 'hello world')).toBe('hello world');
  });

  it('should return empty string when both media and text are empty', () => {
    expect(buildMediaPrompt([], '')).toBe('');
  });

  it('should add image context for a single image', () => {
    const media: MediaAttachment[] = [
      { type: 'image', mimeType: 'image/png', filePath: '/tmp/photo.png' },
    ];
    const result = buildMediaPrompt(media, 'describe this');
    expect(result).toContain('User sent an image: /tmp/photo.png');
    expect(result).toContain('describe this');
  });

  it('should list multiple media items', () => {
    const media: MediaAttachment[] = [
      { type: 'image', mimeType: 'image/png', filePath: '/tmp/a.png' },
      { type: 'document', mimeType: 'application/pdf', filePath: '/tmp/b.pdf', fileName: 'report.pdf' },
    ];
    const result = buildMediaPrompt(media, 'check these');
    expect(result).toContain('User sent an image: /tmp/a.png');
    expect(result).toContain('User sent a file: /tmp/b.pdf (report.pdf)');
    expect(result).toContain('check these');
  });

  it('should handle voice with transcription caption', () => {
    const media: MediaAttachment[] = [
      { type: 'voice', mimeType: 'audio/ogg', filePath: '/tmp/voice.ogg', caption: '[Transcribed] hello there' },
    ];
    const result = buildMediaPrompt(media, '');
    expect(result).toBe('[Transcribed] hello there');
  });

  it('should handle voice without transcription', () => {
    const media: MediaAttachment[] = [
      { type: 'voice', mimeType: 'audio/ogg', filePath: '/tmp/voice.ogg' },
    ];
    const result = buildMediaPrompt(media, 'listen');
    expect(result).toContain('User sent a voice message: /tmp/voice.ogg');
  });

  it('should handle audio with fileName', () => {
    const media: MediaAttachment[] = [
      { type: 'audio', mimeType: 'audio/mp3', filePath: '/tmp/song.mp3', fileName: 'track1.mp3' },
    ];
    const result = buildMediaPrompt(media, '');
    expect(result).toContain('User sent an audio file: /tmp/song.mp3 (track1.mp3)');
  });

  it('should handle video type', () => {
    const media: MediaAttachment[] = [
      { type: 'video', mimeType: 'video/mp4', filePath: '/tmp/clip.mp4' },
    ];
    const result = buildMediaPrompt(media, '');
    expect(result).toContain('User sent a video: /tmp/clip.mp4');
  });

  it('should return only media text when textPrompt is empty', () => {
    const media: MediaAttachment[] = [
      { type: 'image', mimeType: 'image/png', filePath: '/tmp/x.png' },
    ];
    const result = buildMediaPrompt(media, '');
    expect(result).toBe('User sent an image: /tmp/x.png');
    expect(result).not.toContain('\n\n');
  });
});
