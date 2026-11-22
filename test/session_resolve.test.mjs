import test from 'node:test';
import assert from 'node:assert/strict';
import { pickSession, resolveSessionFromUmo } from '../src/session.ts';

test('群 umo 解析为 persona 前缀', () => {
  assert.equal(
    resolveSessionFromUmo('aiocqhttp:GroupMessage:123456789', '测试人格'),
    '测试人格:GroupMessage:123456789',
  );
});

test('私聊 umo 解析为 persona 前缀', () => {
  assert.equal(
    resolveSessionFromUmo('aiocqhttp:FriendMessage:100000001', '测试人格'),
    '测试人格:FriendMessage:100000001',
  );
});

test('非法 umo 返回 null', () => {
  for (const umo of ['', 'aiocqhttp:GroupMessage', 'aiocqhttp:Notice:1', 'aiocqhttp:GroupMessage:']) {
    assert.equal(resolveSessionFromUmo(umo, '测试人格'), null);
  }
});

test('umo 优先于显式 session', () => {
  assert.equal(
    pickSession('custom:GroupMessage:1', 'aiocqhttp:GroupMessage:123456789', '测试人格'),
    '测试人格:GroupMessage:123456789',
  );
});

test('无 umo 时使用显式 session', () => {
  assert.equal(pickSession('custom:GroupMessage:1', '', '测试人格'), 'custom:GroupMessage:1');
});

// 模式：键存在就尊重用户值，键不存在且旧桥 pet_only 才沿用
import { resolveMemoryMode } from '../src/session.ts';
assert.equal(resolveMemoryMode(false, '与 AstrBot 共享', 'pet_only'), 'pet_only');
assert.equal(resolveMemoryMode(true, '与 AstrBot 共享', 'pet_only'), 'shared');
assert.equal(resolveMemoryMode(false, '与 AstrBot 共享', 'shared'), 'shared');
