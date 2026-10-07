import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import { DomainError } from '../domain/tree.js';

const N = 131072;
const r = 8;
const p = 1;
const maxmem = 256 * 1024 * 1024;
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N, r, p, maxmem }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}
function sessionHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
async function passwordHash(password: string): Promise<string> {
  if (password.length < 12 || password.length > 1024)
    throw new DomainError(
      'INVALID_PASSWORD',
      'Пароль должен содержать от 12 до 1024 символов.',
    );
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return ['scrypt', N, r, p, salt.toString('hex'), key.toString('hex')].join(
    ':',
  );
}
export class Auth {
  private readonly attempts = new Map<
    string,
    { count: number; until: number }
  >();
  private activeLogins = 0;
  private readonly dummySalt = randomBytes(16);
  private readonly dummyHash = randomBytes(64);
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => number = Date.now,
  ) {}
  hasAccount(): boolean {
    return Boolean(this.db.prepare('SELECT id FROM account WHERE id=1').get());
  }
  async setup(password: string): Promise<void> {
    if (this.hasAccount())
      throw new DomainError(
        'ACCOUNT_EXISTS',
        'Локальная учётная запись уже настроена.',
        409,
      );
    const encoded = await passwordHash(password);
    this.db
      .transaction(() => {
        if (this.hasAccount())
          throw new DomainError(
            'ACCOUNT_EXISTS',
            'Локальная учётная запись уже настроена.',
            409,
          );
        this.db
          .prepare('INSERT INTO account(id,passwordHash) VALUES (1,?)')
          .run(encoded);
      })
      .immediate();
  }
  async resetPassword(password: string): Promise<void> {
    if (!this.hasAccount())
      throw new DomainError(
        'ACCOUNT_NOT_FOUND',
        'Сначала создайте локальную учётную запись.',
        409,
      );
    const encoded = await passwordHash(password);
    this.db
      .transaction(() => {
        const updated = this.db
          .prepare('UPDATE account SET passwordHash=? WHERE id=1')
          .run(encoded);
        if (updated.changes !== 1)
          throw new DomainError(
            'ACCOUNT_NOT_FOUND',
            'Сначала создайте локальную учётную запись.',
            409,
          );
        this.db.prepare('DELETE FROM sessions').run();
        this.db.prepare('DELETE FROM undo_snapshots').run();
      })
      .immediate();
  }
  async login(password: string, ip: string): Promise<string> {
    const timestamp = this.now();
    for (const [address, attempt] of this.attempts)
      if (attempt.until <= timestamp) this.attempts.delete(address);
    const attempt = this.attempts.get(ip) ?? {
      count: 0,
      until: timestamp + 60000,
    };
    if (
      attempt.count >= 5 ||
      this.activeLogins >= 2 ||
      (!this.attempts.has(ip) && this.attempts.size >= 1000)
    )
      throw new DomainError(
        'LOGIN_RATE_LIMIT',
        'Слишком много попыток входа. Повторите позже.',
        429,
      );
    attempt.count++;
    this.attempts.set(ip, attempt);
    this.activeLogins++;
    try {
      const account = this.db
        .prepare('SELECT passwordHash FROM account WHERE id=1')
        .get() as { passwordHash: string } | undefined;
      let salt = this.dummySalt;
      let expected = this.dummyHash;
      if (account) {
        const fields = account.passwordHash.split(':');
        if (
          fields.length !== 6 ||
          fields[0] !== 'scrypt' ||
          Number(fields[1]) !== N ||
          Number(fields[2]) !== r ||
          Number(fields[3]) !== p
        )
          throw new Error('Unsupported password hash');
        salt = Buffer.from(fields[4]!, 'hex');
        expected = Buffer.from(fields[5]!, 'hex');
      }
      const actual = await derive(password, salt);
      if (
        !account ||
        expected.length !== actual.length ||
        !timingSafeEqual(expected, actual)
      )
        throw new DomainError('INVALID_LOGIN', 'Не удалось войти.', 401);
      const token = randomBytes(32).toString('base64url');
      this.db
        .transaction(() => {
          // A reset in another process must also invalidate a login that was
          // already deriving the old password when the reset committed.
          const current = this.db
            .prepare('SELECT passwordHash FROM account WHERE id=1')
            .get() as { passwordHash: string } | undefined;
          if (current?.passwordHash !== account.passwordHash)
            throw new DomainError('INVALID_LOGIN', 'Не удалось войти.', 401);
          this.db
            .prepare('DELETE FROM sessions WHERE expiresAt<=?')
            .run(timestamp);
          this.db
            .prepare('INSERT INTO sessions(id,expiresAt) VALUES (?,?)')
            .run(sessionHash(token), timestamp + SESSION_SECONDS * 1000);
        })
        .immediate();
      return token;
    } finally {
      this.activeLogins--;
    }
  }
  session(token: string | undefined): string | undefined {
    if (!token || !this.hasAccount() || !/^[A-Za-z0-9_-]{43}$/.test(token))
      return;
    const id = sessionHash(token);
    const row = this.db
      .prepare('SELECT expiresAt FROM sessions WHERE id=?')
      .get(id) as { expiresAt: number } | undefined;
    if (!row || row.expiresAt <= this.now()) return;
    return id;
  }
  logout(token: string | undefined): void {
    if (!token) return;
    const id = sessionHash(token);
    this.db
      .transaction(() => {
        this.db.prepare('DELETE FROM sessions WHERE id=?').run(id);
        this.db.prepare('DELETE FROM undo_snapshots WHERE sessionId=?').run(id);
      })
      .immediate();
  }
}
