import { describe, it, expect, beforeEach } from 'vitest';
import {
  getOrCreateUUID, getShortUUID, getMyNickname, setMyNickname,
  getContacts, saveContact, deleteContact, resolveUUID,
  getHistory, addToHistory, deleteFromHistory, clearHistory,
} from './store.js';

beforeEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------
describe('UUID', () => {
  it('generates a valid UUID v4 on first call', () => {
    const uuid = getOrCreateUUID();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('returns the same UUID on subsequent calls', () => {
    expect(getOrCreateUUID()).toBe(getOrCreateUUID());
  });

  it('persists the UUID to localStorage', () => {
    const uuid = getOrCreateUUID();
    expect(localStorage.getItem('whale_uuid')).toBe(uuid);
  });

  it('getShortUUID returns the first 8 characters', () => {
    const full = getOrCreateUUID();
    expect(getShortUUID()).toBe(full.slice(0, 8));
  });
});

describe('nickname', () => {
  it('returns null when no nickname is set', () => {
    expect(getMyNickname()).toBeNull();
  });

  it('saves and retrieves a nickname', () => {
    setMyNickname('Alice');
    expect(getMyNickname()).toBe('Alice');
  });

  it('trims whitespace from nickname', () => {
    setMyNickname('  Bob  ');
    expect(getMyNickname()).toBe('Bob');
  });
});

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------
describe('contacts', () => {
  it('starts empty', () => {
    expect(getContacts()).toEqual({});
  });

  it('saves a contact', () => {
    saveContact('a3d7f1c2', 'Alice');
    expect(getContacts()['a3d7f1c2']).toBe('Alice');
  });

  it('overwrites an existing contact', () => {
    saveContact('a3d7f1c2', 'Alice');
    saveContact('a3d7f1c2', 'Alice Smith');
    expect(getContacts()['a3d7f1c2']).toBe('Alice Smith');
  });

  it('saves multiple contacts independently', () => {
    saveContact('a3d7f1c2', 'Alice');
    saveContact('b4e8f2d3', 'Bob');
    const contacts = getContacts();
    expect(contacts['a3d7f1c2']).toBe('Alice');
    expect(contacts['b4e8f2d3']).toBe('Bob');
  });

  it('deletes a contact', () => {
    saveContact('a3d7f1c2', 'Alice');
    deleteContact('a3d7f1c2');
    expect(getContacts()['a3d7f1c2']).toBeUndefined();
  });

  it('delete does not affect other contacts', () => {
    saveContact('a3d7f1c2', 'Alice');
    saveContact('b4e8f2d3', 'Bob');
    deleteContact('a3d7f1c2');
    expect(getContacts()['b4e8f2d3']).toBe('Bob');
  });

  it('resolveUUID returns nickname when known', () => {
    saveContact('a3d7f1c2', 'Alice');
    expect(resolveUUID('a3d7f1c2')).toBe('Alice');
  });

  it('resolveUUID returns first 8 chars of UUID when unknown', () => {
    expect(resolveUUID('a3d7f1c2ef456789')).toBe('a3d7f1c2');
  });
});

// ---------------------------------------------------------------------------
// Message history
// ---------------------------------------------------------------------------
describe('history', () => {
  const msg = () => ({ sender: 'a3d7f1c2', content: 'Hello', mode: 'broadcast', crcStatus: 'clean' });

  it('starts empty', () => {
    expect(getHistory()).toEqual([]);
  });

  it('adds a message with id and timestamp', () => {
    addToHistory(msg());
    const [entry] = getHistory();
    expect(entry.id).toBeDefined();
    expect(entry.timestamp).toBeDefined();
    expect(entry.content).toBe('Hello');
  });

  it('newest messages appear first', () => {
    addToHistory({ ...msg(), content: 'First' });
    addToHistory({ ...msg(), content: 'Second' });
    const history = getHistory();
    expect(history[0].content).toBe('Second');
    expect(history[1].content).toBe('First');
  });

  it('deletes a message by id', () => {
    addToHistory(msg());
    const [entry] = getHistory();
    deleteFromHistory(entry.id);
    expect(getHistory()).toHaveLength(0);
  });

  it('delete does not affect other messages', () => {
    addToHistory({ ...msg(), content: 'A' });
    addToHistory({ ...msg(), content: 'B' });
    const [b] = getHistory(); // newest first
    deleteFromHistory(b.id);
    expect(getHistory()).toHaveLength(1);
    expect(getHistory()[0].content).toBe('A');
  });

  it('clearHistory removes all messages', () => {
    addToHistory(msg());
    addToHistory(msg());
    clearHistory();
    expect(getHistory()).toHaveLength(0);
  });
});
